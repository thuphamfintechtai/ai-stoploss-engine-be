/**
 * RealOrderService — Ghi nhận lệnh thật đã đặt trên sàn.
 *
 * Context: REAL (không phải paper trading simulation)
 * - recordBuyOrder: Tạo order + position với context='REAL', KHÔNG gọi fillEngine
 * - getTransactionHistory: Lấy lịch sử giao dịch thật (context='REAL')
 */

import { calculateBuyFee } from '../shared/feeEngine.js';
import { query } from '../../config/database.js';
import Order from '../../models/Order.js';
import Position from '../../models/Position.js';
import CapitalService from './capitalService.js';
// KHONG import fillEngine -- per D-03: real orders không cần matching engine

class RealOrderService {
  /**
   * Ghi nhận lệnh mua thật đã khớp trên sàn.
   * Tạo order record (context='REAL', status='RECORDED') + position (context='REAL', status='OPEN').
   *
   * @param {string} portfolioId
   * @param {object} params
   * @param {string} params.symbol - Mã chứng khoán (vd: VNM)
   * @param {string} params.exchange - Sàn giao dịch (HOSE, HNX, UPCOM)
   * @param {number} params.quantity - Số lượng CP
   * @param {number} params.filledPrice - Giá khớp (VND)
   * @param {string|Date} params.filledDate - Ngày khớp lệnh
   * @param {string} [params.notes] - Ghi chú
   * @returns {{ order: object, position: object }}
   */
  static async recordBuyOrder(portfolioId, { symbol, exchange, quantity, filledPrice, filledDate, notes = null }) {
    // Lấy portfolio để tính phí (nếu có custom fee config)
    let portfolio = {};
    try {
      const portfolioRes = await query(
        'SELECT * FROM financial.portfolios WHERE id = $1',
        [portfolioId]
      );
      portfolio = portfolioRes.rows[0] || {};
    } catch {
      // portfolio không có custom fee -- dùng default
    }

    // Tính buy fee ngay khi ghi nhận lệnh mua
    const buyFeeVnd = calculateBuyFee(filledPrice, quantity, portfolio);
    const totalCost = (filledPrice * quantity) + buyFeeVnd;

    // Trừ tiền trước khi tạo order -- nếu không đủ tiền sẽ throw 422
    await CapitalService.deductForBuy(portfolioId, totalCost);

    // 1. Tạo order record: context='REAL', status='RECORDED', orderType='MANUAL_RECORD'
    const order = await Order.create({
      portfolioId,
      symbol,
      exchange,
      side: 'BUY',
      orderType: 'MANUAL_RECORD',
      limitPrice: filledPrice,
      quantity,
      simulationMode: 'MANUAL',
      context: 'REAL',
      status: 'RECORDED',
      manualEntry: true,
      actualFilledAt: filledDate,
      notes,
    });

    // 2. Tạo position: context='REAL', status='OPEN', stopLoss=null, takeProfit=null
    const position = await Position.create({
      portfolioId,
      symbol,
      exchange,
      entryPrice: filledPrice,
      stopLoss: null,      // REAL positions không bắt buộc có SL (per migration 007)
      takeProfit: null,
      quantity,
      riskValueVnd: 0,     // Risk được tính sau khi user set SL
      side: 'LONG',
      context: 'REAL',
      buyFeeVnd,
      notes,
    });

    return { order, position };
  }

  /**
   * Lấy lịch sử giao dịch thật của portfolio.
   * Chỉ trả về orders với context='REAL', sắp xếp theo ngày khớp mới nhất.
   *
   * @param {string} portfolioId
   * @param {object} [options]
   * @param {number} [options.page=1]
   * @param {number} [options.limit=50]
   * @returns {{ orders: object[], total: number, page: number, limit: number }}
   */
  static async getTransactionHistory(portfolioId, { page = 1, limit = 50 } = {}) {
    const offset = (page - 1) * limit;

    // Count total
    const countRes = await query(
      `SELECT COUNT(*) as count
       FROM financial.orders
       WHERE portfolio_id = $1
         AND context = 'REAL'`,
      [portfolioId]
    );
    const total = parseInt(countRes.rows[0]?.count || 0);

    // Fetch orders với pagination
    const ordersRes = await query(
      `SELECT *
       FROM financial.orders
       WHERE portfolio_id = $1
         AND context = 'REAL'
       ORDER BY actual_filled_at DESC NULLS LAST, created_at DESC
       LIMIT $2 OFFSET $3`,
      [portfolioId, limit, offset]
    );

    return {
      orders: ordersRes.rows,
      total,
      page,
      limit,
    };
  }
}

export default RealOrderService;
