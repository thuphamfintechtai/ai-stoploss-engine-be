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

/**
 * CapitalService — quan ly dong tien portfolio (MAP-01, MAP-02).
 *
 * Khai niem:
 *   - available_cash       : tien kha dung (co the dung de mua ngay)
 *   - pending_settlement_cash : tien cho T+2 settlement sau khi ban
 *   - pending_buy_lock     : tien dang lock cho pending BUY orders (MAP-01, D-05)
 *   - buying_power         : = available_cash - pending_buy_lock (suc mua thuc te)
 *
 * MAP-05 D-06 LOCKED scope: money math trong file nay dung Math.round(Number(x)).
 * KHONG dung parseFloat cong don — van de precision floating point.
 */
class CapitalService {
  /**
   * Lock/tru tien khi tao BUY order.
   *
   * @param {string} portfolioId
   * @param {number} totalCost - Tong chi phi mua (gia * so luong + phi), VND
   * @param {string} [state='FILLED'] - 'FILLED' (default) tru available_cash;
   *                                    'PENDING' tang pending_buy_lock (chua tru cash).
   * @throws 422 neu khong du tien (hoac khong du buying_power cho PENDING)
   * @throws Error neu state khong hop le
   */
  static async deductForBuy(portfolioId, totalCost, state = 'FILLED') {
    if (state !== 'FILLED' && state !== 'PENDING') {
      throw new Error('Invalid state: ' + state + ' (expected FILLED or PENDING)');
    }
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT available_cash, pending_buy_lock FROM financial.portfolios WHERE id = $1 FOR UPDATE`,
        [portfolioId]
      );
      if (!rows[0]) {
        const err = new Error('Khong du tien mat kha dung');
        err.statusCode = 422;
        throw err;
      }
      const available = Math.round(Number(rows[0].available_cash));
      const pending = Math.round(Number(rows[0].pending_buy_lock));

      if (state === 'FILLED') {
        // DEBUG: Log capital check
        console.log('[CAPITAL DEBUG]', {
          portfolioId,
          state,
          available,
          pending,
          totalCost,
          buyingPower: available - pending,
          sufficient: available >= totalCost
        });
        if (!Number.isFinite(available) || available < totalCost) {
          const err = new Error('Khong du tien mat kha dung');
          err.statusCode = 422;
          throw err;
        }
        await client.query(
          `UPDATE financial.portfolios SET available_cash = available_cash - $2, updated_at = NOW() WHERE id = $1`,
          [portfolioId, totalCost]
        );
      } else {
        // state === 'PENDING'
        const buyingPower = available - pending;
        // DEBUG: Log capital check
        console.log('[CAPITAL DEBUG]', {
          portfolioId,
          state,
          available,
          pending,
          totalCost,
          buyingPower,
          sufficient: buyingPower >= totalCost
        });
        if (!Number.isFinite(buyingPower) || buyingPower < totalCost) {
          const err = new Error('Khong du suc mua (buying_power insufficient)');
          err.statusCode = 422;
          throw err;
        }
        await client.query(
          `UPDATE financial.portfolios SET pending_buy_lock = pending_buy_lock + $2, updated_at = NOW() WHERE id = $1`,
          [portfolioId, totalCost]
        );
      }
    });
  }

  /**
   * Confirm fill cho PENDING BUY order: chuyen tu lock sang spent trong 1 transaction.
   * pending_buy_lock -= lockedAmount; available_cash -= actualCost.
   *
   * @param {string} portfolioId
   * @param {number} actualCost - Chi phi thuc te khi khop (gia thuc * qty + fee thuc)
   * @param {number} lockedAmount - So tien da lock truoc do (tu recordBuyOrder PENDING)
   * @throws 404 neu portfolio khong ton tai
   * @throws 422 neu insufficient lock hoac insufficient available_cash
   */
  static async confirmBuyFill(portfolioId, actualCost, lockedAmount) {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT available_cash, pending_buy_lock FROM financial.portfolios WHERE id = $1 FOR UPDATE`,
        [portfolioId]
      );
      if (!rows[0]) {
        const err = new Error('Portfolio not found');
        err.statusCode = 404;
        throw err;
      }
      const available = Math.round(Number(rows[0].available_cash));
      const locked = Math.round(Number(rows[0].pending_buy_lock));

      if (locked < lockedAmount) {
        const err = new Error('Pending buy lock insufficient');
        err.statusCode = 422;
        throw err;
      }
      if (available < actualCost) {
        const err = new Error('Khong du tien mat kha dung (confirmBuyFill)');
        err.statusCode = 422;
        throw err;
      }

      await client.query(
        `UPDATE financial.portfolios
         SET available_cash = available_cash - $2,
             pending_buy_lock = pending_buy_lock - $3,
             updated_at = NOW()
         WHERE id = $1`,
        [portfolioId, actualCost, lockedAmount]
      );
    });
  }

  /**
   * Release lock khi cancel/expire pending BUY order.
   * pending_buy_lock -= amount (available_cash KHONG doi).
   *
   * @param {string} portfolioId
   * @param {number} amount - So tien can release
   * @throws 404 neu portfolio khong ton tai
   * @throws 422 neu locked < amount
   */
  static async releaseBuyLock(portfolioId, amount) {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT pending_buy_lock FROM financial.portfolios WHERE id = $1 FOR UPDATE`,
        [portfolioId]
      );
      if (!rows[0]) {
        const err = new Error('Portfolio not found');
        err.statusCode = 404;
        throw err;
      }
      const locked = Math.round(Number(rows[0].pending_buy_lock));
      if (locked < amount) {
        const err = new Error('Pending buy lock insufficient for release');
        err.statusCode = 422;
        throw err;
      }
      await client.query(
        `UPDATE financial.portfolios SET pending_buy_lock = pending_buy_lock - $2, updated_at = NOW() WHERE id = $1`,
        [portfolioId, amount]
      );
    });
  }

  /**
   * Them tien vao pending_settlement_cash va tao settlement_events record.
   * Goi khi ban: tien chua kha dung ngay, cho T+2.
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
   * Xu ly cac settlement events den han: chuyen tu pending sang available.
   * Duoc goi boi settlement worker moi ngay 9AM.
   * @returns {number} So settlement da xu ly
   */
  static async processSettlements() {
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
   * Lay so du hien tai cua portfolio.
   *
   * MAP-05 D-06 LOCKED: integer VND math (Math.round(Number(x))) — khong parseFloat cong don.
   *
   * @param {string} portfolioId
   * @returns {{
   *   total_balance: number,
   *   available_cash: number,
   *   pending_settlement_cash: number,
   *   pending_buy_lock: number,
   *   buying_power: number,
   *   deployed_cash: number
   * } | null}
   */
  static async getBalance(portfolioId) {
    const { rows } = await query(
      `SELECT total_balance, available_cash, pending_settlement_cash, pending_buy_lock
       FROM financial.portfolios WHERE id = $1`,
      [portfolioId]
    );
    if (!rows[0]) return null;
    const r = rows[0];
    const total = Math.round(Number(r.total_balance));
    const avail = Math.round(Number(r.available_cash));
    const pendSettle = Math.round(Number(r.pending_settlement_cash));
    const pendLock = Math.round(Number(r.pending_buy_lock));
    return {
      total_balance: total,
      available_cash: avail,
      pending_settlement_cash: pendSettle,
      pending_buy_lock: pendLock,
      buying_power: avail - pendLock,
      deployed_cash: total - avail - pendSettle,
    };
  }
}

export default CapitalService;
