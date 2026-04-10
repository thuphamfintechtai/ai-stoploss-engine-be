import { query, transaction } from '../../config/database.js';

// HOSE/HNX holidays 2026-2027 (hardcode -- khong co API chinh thuc)
const VN_HOLIDAYS = [
  // 2026
  '2026-01-01', // Tet Duong lich
  '2026-01-26', '2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30', // Tet Nguyen Dan
  '2026-04-30', // Giai phong mien Nam
  '2026-05-01', // Quoc te lao dong
  '2026-09-02', // Quoc khanh
  // 2027 -- them khi co lich chinh thuc
  '2027-01-01',
  '2027-02-14', '2027-02-15', '2027-02-16', '2027-02-17', '2027-02-18', // Tet Nguyen Dan 2027
  '2027-04-30',
  '2027-05-01',
  '2027-09-02',
];
// TODO: Cap nhat lich nghi le truoc 2028

/**
 * Tinh ngay lam viec (skip weekends + VN holidays)
 * @param {Date} date - Ngay bat dau
 * @param {number} days - So ngay lam viec can them
 * @returns {Date}
 */
export function addBusinessDays(date, days) {
  let current = new Date(date);
  let added = 0;
  while (added < days) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    const dateStr = current.toISOString().split('T')[0];
    if (day !== 0 && day !== 6 && !VN_HOLIDAYS.includes(dateStr)) {
      added++;
    }
  }
  return current;
}

class CapitalService {
  /**
   * Tru available_cash khi mua (bao gom phi)
   * Dung SELECT FOR UPDATE de tranh race condition
   * @param {string} portfolioId
   * @param {number} totalCost - Tong chi phi mua (gia * so luong + phi)
   */
  static async deductForBuy(portfolioId, totalCost) {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT available_cash FROM financial.portfolios WHERE id = $1 FOR UPDATE`,
        [portfolioId]
      );
      const available = parseFloat(rows[0]?.available_cash);
      if (isNaN(available) || available < totalCost) {
        const err = new Error('Khong du tien mat kha dung');
        err.statusCode = 422;
        throw err;
      }
      await client.query(
        `UPDATE financial.portfolios SET available_cash = available_cash - $2, updated_at = NOW() WHERE id = $1`,
        [portfolioId, totalCost]
      );
    });
  }

  /**
   * Them tien vao pending_settlement_cash va tao settlement_events record
   * Goi khi ban: tien chua kha dung ngay, cho T+2
   * @param {string} portfolioId
   * @param {number} netAmount - So tien thuan sau phi ban
   * @param {Date} settlementDate - Ngay T+2 tinh theo ngay lam viec VN
   */
  static async addPendingSettlement(portfolioId, netAmount, settlementDate) {
    return transaction(async (client) => {
      await client.query(
        `UPDATE financial.portfolios SET pending_settlement_cash = pending_settlement_cash + $2, updated_at = NOW() WHERE id = $1`,
        [portfolioId, netAmount]
      );
      await client.query(
        `INSERT INTO financial.settlement_events (portfolio_id, amount, settlement_date) VALUES ($1, $2, $3)`,
        [portfolioId, netAmount, settlementDate]
      );
    });
  }

  /**
   * Xu ly cac settlement events den han: chuyen tu pending sang available
   * Duoc goi boi settlement worker moi ngay 9AM
   * @returns {number} So settlement da xu ly
   */
  static async processSettlements() {
    // Query pending events where settlement_date <= today
    const { rows: pendingEvents } = await query(
      `SELECT * FROM financial.settlement_events WHERE status = 'PENDING' AND settlement_date <= CURRENT_DATE`
    );
    let processed = 0;
    for (const event of pendingEvents) {
      await transaction(async (client) => {
        await client.query(
          `UPDATE financial.portfolios SET available_cash = available_cash + $2, pending_settlement_cash = pending_settlement_cash - $2, updated_at = NOW() WHERE id = $1`,
          [event.portfolio_id, event.amount]
        );
        await client.query(
          `UPDATE financial.settlement_events SET status = 'SETTLED', settled_at = NOW() WHERE id = $1`,
          [event.id]
        );
      });
      processed++;
    }
    return processed;
  }

  /**
   * Lay so du hien tai cua portfolio
   * @param {string} portfolioId
   * @returns {{ total_balance, available_cash, pending_settlement_cash, deployed_cash } | null}
   */
  static async getBalance(portfolioId) {
    const { rows } = await query(
      `SELECT total_balance, available_cash, pending_settlement_cash FROM financial.portfolios WHERE id = $1`,
      [portfolioId]
    );
    if (!rows[0]) return null;
    const { total_balance, available_cash, pending_settlement_cash } = rows[0];
    return {
      total_balance: parseFloat(total_balance),
      available_cash: parseFloat(available_cash),
      pending_settlement_cash: parseFloat(pending_settlement_cash),
      deployed_cash: parseFloat(total_balance) - parseFloat(available_cash) - parseFloat(pending_settlement_cash),
    };
  }
}

export default CapitalService;
