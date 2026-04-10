/**
 * RealPositionService — Đóng vị thế thật và tính P&L.
 *
 * Context: REAL
 * - closePosition: Đóng vị thế thật, tạo sell order record, tính realized P&L với fees
 * - getOpenPositions: Lấy danh sách vị thế đang mở (context='REAL', status='OPEN')
 */

import { calculateFees } from '../shared/feeEngine.js';
import { query, transaction } from '../../config/database.js';
import CapitalService, { addBusinessDays } from './capitalService.js';

class RealPositionService {
  /**
   * Đóng vị thế thật (manual close).
   * Trong transaction:
   * 1. Tìm và verify position (context='REAL', status='OPEN')
   * 2. Tạo sell order record (context='REAL', side='SELL', status='RECORDED')
   * 3. Tính P&L với fees
   * 4. Update position: status='CLOSED_MANUAL', exit_price, closed_at, pnl
   *
   * @param {string} positionId
   * @param {object} params
   * @param {number} params.sellPrice - Giá bán (VND)
   * @param {string|Date} params.sellDate - Ngày bán
   * @param {string} params.portfolioId - Portfolio ID để verify ownership
   * @param {string} [params.notes]
   * @returns {{ position: object, sellOrder: object, pnl: object }}
   */
  static async closePosition(positionId, { sellPrice, sellDate, portfolioId, notes = null }) {
    return transaction(async (client) => {
      // 1. Tìm position, verify context=REAL và status=OPEN
      const posRes = await client.query(
        `SELECT p.*, port.buy_fee_percent, port.sell_fee_percent, port.sell_tax_percent
         FROM financial.positions p
         LEFT JOIN financial.portfolios port ON port.id = p.portfolio_id
         WHERE p.id = $1
           AND p.portfolio_id = $2`,
        [positionId, portfolioId]
      );

      const position = posRes.rows[0];
      if (!position) {
        const error = new Error('Position not found');
        error.statusCode = 404;
        throw error;
      }

      if (position.status !== 'OPEN') {
        const error = new Error(`Cannot close position with status '${position.status}'. Only OPEN positions can be closed.`);
        error.statusCode = 400;
        throw error;
      }

      // Portfolio config để tính phí
      const portfolio = {
        buy_fee_percent: position.buy_fee_percent,
        sell_fee_percent: position.sell_fee_percent,
        sell_tax_percent: position.sell_tax_percent,
      };

      // 2. Tính fees và P&L
      const pnl = calculateFees(
        Number(position.entry_price),
        Number(sellPrice),
        Number(position.quantity),
        portfolio
      );

      // 3. Tạo sell order record
      const sellOrderRes = await client.query(
        `INSERT INTO financial.orders (
          portfolio_id, symbol, exchange, side, order_type,
          limit_price, quantity, simulation_mode,
          context, status, manual_entry, actual_filled_at, notes,
          placed_at
        ) VALUES ($1, $2, $3, 'SELL', 'MANUAL_RECORD', $4, $5, 'MANUAL', 'REAL', 'RECORDED', true, $6, $7, NOW())
        RETURNING *`,
        [
          portfolioId,
          position.symbol,
          position.exchange,
          sellPrice,
          position.quantity,
          sellDate,
          notes,
        ]
      );
      const sellOrder = sellOrderRes.rows[0];

      // 4. Update position: CLOSED_MANUAL + P&L data
      const updatedPosRes = await client.query(
        `UPDATE financial.positions
         SET status = 'CLOSED_MANUAL',
             exit_price = $2,
             closed_at = $3,
             sell_fee_vnd = $4,
             sell_tax_vnd = $5,
             profit_loss_vnd = $6,
             gross_pnl_vnd = $7,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          positionId,
          sellPrice,
          sellDate,
          pnl.sell_fee_vnd,
          pnl.sell_tax_vnd,
          pnl.net_pnl_vnd,
          pnl.gross_pnl_vnd,
        ]
      );

      // Tính tiền thuần nhận được sau khi bán (sau phí + thuế) -> thêm vào pending settlement T+2
      const netSellProceeds = (Number(sellPrice) * Number(position.quantity)) - pnl.sell_fee_vnd - pnl.sell_tax_vnd;
      const settlementDate = addBusinessDays(new Date(sellDate), 2);
      await CapitalService.addPendingSettlement(portfolioId, netSellProceeds, settlementDate);

      return {
        position: updatedPosRes.rows[0],
        sellOrder,
        pnl,
        settlementDate,
      };
    });
  }

  /**
   * Lấy danh sách vị thế đang mở (context='REAL', status='OPEN').
   *
   * @param {string} portfolioId
   * @returns {object[]}
   */
  static async getOpenPositions(portfolioId) {
    const result = await query(
      `SELECT *
       FROM financial.positions
       WHERE portfolio_id = $1
         AND context = 'REAL'
         AND status = 'OPEN'
       ORDER BY opened_at DESC`,
      [portfolioId]
    );
    return result.rows;
  }
}

export default RealPositionService;
