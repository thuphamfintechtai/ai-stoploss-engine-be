/**
 * Paper Capital Service — Quan ly virtual cash balance cho Paper Trading.
 *
 * Reuse addBusinessDays tu capitalService.js (KHONG import CapitalService class).
 * T+2 settlement: tien ban duoc chuyen thanh available sau 2 ngay lam viec.
 *
 * Tables:
 *   - financial.portfolios: virtual_balance, paper_available_cash, paper_pending_settlement
 *   - financial.paper_settlement_events: track cac settlement pending
 */

import { addBusinessDays } from '../portfolio/capitalService.js';
import { query, transaction } from '../../config/database.js';

class PaperCapitalService {
  /**
   * Tru paper_available_cash khi dat lenh mua.
   * Dung SELECT FOR UPDATE de tranh race condition.
   *
   * @param {string} portfolioId
   * @param {number} totalCost - Tong chi phi mua (gia * so luong + phi)
   * @throws {Error} 422 khi khong du so du
   */
  static async deductForBuy(portfolioId, totalCost) {
    return transaction(async (client) => {
      const { rows } = await client.query(
        `SELECT paper_available_cash FROM financial.portfolios WHERE id = $1 FOR UPDATE`,
        [portfolioId]
      );
      const available = parseFloat(rows[0]?.paper_available_cash);
      if (isNaN(available) || available < totalCost) {
        const err = new Error('Khong du so du paper trading');
        err.statusCode = 422;
        throw err;
      }
      await client.query(
        `UPDATE financial.portfolios
         SET paper_available_cash = paper_available_cash - $2, updated_at = NOW()
         WHERE id = $1`,
        [portfolioId, totalCost]
      );
    });
  }

  /**
   * Them tien vao paper_pending_settlement va tao paper_settlement_events record.
   * Goi khi ban: tien chua kha dung ngay, cho T+2.
   *
   * @param {string} portfolioId
   * @param {number} netAmount - So tien thuan sau phi ban
   * @param {string|null} orderId - UUID cua order (optional)
   */
  static async addPendingSettlement(portfolioId, netAmount, orderId = null) {
    const settlementDate = addBusinessDays(new Date(), 2);

    return transaction(async (client) => {
      await client.query(
        `UPDATE financial.portfolios
         SET paper_pending_settlement = paper_pending_settlement + $2, updated_at = NOW()
         WHERE id = $1`,
        [portfolioId, netAmount]
      );
      await client.query(
        `INSERT INTO financial.paper_settlement_events
           (portfolio_id, order_id, amount, settlement_date)
         VALUES ($1, $2, $3, $4)`,
        [portfolioId, orderId, netAmount, settlementDate]
      );
    });
  }

  /**
   * Xu ly cac settlement events den han: chuyen tu paper_pending sang paper_available.
   * Duoc goi boi settlement worker moi ngay 9AM truoc gio mo san.
   *
   * @returns {number} So settlement da xu ly
   */
  static async processSettlements() {
    const { rows: pendingEvents } = await query(
      `SELECT * FROM financial.paper_settlement_events
       WHERE status = 'PENDING' AND settlement_date <= CURRENT_DATE`
    );

    let processed = 0;
    for (const event of pendingEvents) {
      await transaction(async (client) => {
        await client.query(
          `UPDATE financial.portfolios
           SET paper_available_cash = paper_available_cash + $2,
               paper_pending_settlement = paper_pending_settlement - $2,
               updated_at = NOW()
           WHERE id = $1`,
          [event.portfolio_id, event.amount]
        );
        await client.query(
          `UPDATE financial.paper_settlement_events
           SET status = 'SETTLED', settled_at = NOW()
           WHERE id = $1`,
          [event.id]
        );
      });
      processed++;
    }
    return processed;
  }

  /**
   * Lay so du virtual balance hien tai cua portfolio.
   *
   * @param {string} portfolioId
   * @returns {{ virtual_balance, paper_available_cash, paper_pending_settlement, paper_deployed } | null}
   */
  static async getVirtualBalance(portfolioId) {
    const { rows } = await query(
      `SELECT virtual_balance, paper_available_cash, paper_pending_settlement
       FROM financial.portfolios
       WHERE id = $1`,
      [portfolioId]
    );
    if (!rows[0]) return null;

    const { virtual_balance, paper_available_cash, paper_pending_settlement } = rows[0];
    const vb = parseFloat(virtual_balance);
    const available = parseFloat(paper_available_cash);
    const pending = parseFloat(paper_pending_settlement);

    return {
      virtual_balance: vb,
      paper_available_cash: available,
      paper_pending_settlement: pending,
      paper_deployed: vb - available - pending,
    };
  }

  /**
   * Cong lai paper_available_cash khi cancel order.
   * Dam bao khong mat tien khi huy lenh.
   *
   * @param {string} portfolioId
   * @param {number} amount - So tien can hoan lai
   */
  static async refundForCancel(portfolioId, amount) {
    await query(
      `UPDATE financial.portfolios
       SET paper_available_cash = paper_available_cash + $2, updated_at = NOW()
       WHERE id = $1`,
      [portfolioId, amount]
    );
  }
}

export default PaperCapitalService;
