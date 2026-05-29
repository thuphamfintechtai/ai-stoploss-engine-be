/**
 * RealOrderService — Ghi nhận lệnh thật đã đặt trên sàn.
 *
 * Context: REAL (không phải paper trading simulation)
 * - recordBuyOrder(..., orderStatus): D-05 (MAP-01)
 *     * 'FILLED'  (default): status='RECORDED', deductForBuy(id, cost, 'FILLED'), tạo Position OPEN
 *     * 'PENDING': status='PENDING', deductForBuy(id, cost, 'PENDING') → lock, KHÔNG tạo Position
 * - confirmOrderFill(portfolioId, orderId, { actualPrice, actualDate }):
 *     * PENDING → RECORDED, confirmBuyFill (lock → spent), tạo Position OPEN với entry_price thuc te
 * - cancelBuyOrder(portfolioId, orderId):
 *     * PENDING → CANCELLED, releaseBuyLock (giam pending_buy_lock)
 * - getTransactionHistory: Lấy lịch sử giao dịch thật (context='REAL')
 *
 * MAP-05 D-06 LOCKED scope: integer VND math (Math.round(Number(x))).
 */

import { calculateBuyFee } from '../shared/feeEngine.js';
import { query } from '../../config/database.js';
import Order from '../../models/Order.js';
import Position from '../../models/Position.js';
import CapitalService from './capitalService.js';
// KHONG import fillEngine -- per D-03: real orders không cần matching engine

class RealOrderService {
  /**
   * Recompute locked amount từ PENDING order DB row (source-of-truth).
   * KHÔNG nhận từ caller (T-03-02: elevation of privilege mitigation).
   *
   * @param {object} orderRow - Order row từ DB (snake_case columns)
   * @param {object} portfolio - Portfolio row (cho fee percent config)
   * @returns {number} Locked amount (VND integer)
   */
  static _computeLockedAmount(orderRow, portfolio) {
    const qty = Number(orderRow.quantity);
    const price = Number(orderRow.limit_price);
    if (!Number.isFinite(qty) || !Number.isFinite(price) || qty <= 0 || price <= 0) {
      throw new Error('Invalid order row: quantity hoac limit_price khong hop le');
    }
    const feeVnd = calculateBuyFee(price, qty, portfolio);
    return Math.round(price * qty) + feeVnd;
  }

  /**
   * Ghi nhận lệnh mua thật (FILLED) hoặc lệnh limit chờ khớp (PENDING).
   *
   * @param {string} portfolioId
   * @param {object} params
   * @param {string} params.symbol
   * @param {string} params.exchange - HOSE | HNX | UPCOM
   * @param {number} params.quantity - Số lượng CP
   * @param {number} params.filledPrice - Giá khớp / giá limit (VND)
   * @param {string|Date} params.filledDate - Ngày khớp (FILLED) / ngày đặt (PENDING)
   * @param {string} [params.notes]
   * @param {string} [params.orderStatus='FILLED'] - 'FILLED' | 'PENDING' (D-05)
   * @returns {{ order: object, position: object|null }}
   */
  static async recordBuyOrder(portfolioId, {
    symbol,
    exchange,
    quantity,
    filledPrice,
    filledDate,
    notes = null,
    orderStatus = 'FILLED',
    stopLoss = null,
    takeProfit = null,
  }) {
    if (orderStatus !== 'FILLED' && orderStatus !== 'PENDING') {
      const err = new Error('orderStatus phai la FILLED hoac PENDING');
      err.statusCode = 400;
      throw err;
    }

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

    // Tính buy fee + total cost (MAP-05 D-06: integer VND)
    const buyFeeVnd = calculateBuyFee(filledPrice, quantity, portfolio);
    const totalCost = Math.round(Number(filledPrice) * Number(quantity)) + buyFeeVnd;

    // D-05: deduct theo state (FILLED tru cash / PENDING lock only)
    await CapitalService.deductForBuy(portfolioId, totalCost, orderStatus);

    // Tạo order — status + orderType reflect lifecycle
    const order = await Order.create({
      portfolioId,
      symbol,
      exchange,
      side: 'BUY',
      orderType: orderStatus === 'PENDING' ? 'LO' : 'MANUAL_RECORD',
      limitPrice: filledPrice,
      quantity,
      simulationMode: 'INSTANT',
      context: 'REAL',
      status: orderStatus === 'PENDING' ? 'PENDING' : 'RECORDED',
      manualEntry: true,
      actualFilledAt: orderStatus === 'FILLED' ? filledDate : null,
      notes,
    });

    // Position CHI tao khi FILLED — PENDING chua co position (tao khi confirmOrderFill)
    let position = null;
    if (orderStatus === 'FILLED') {
      // Calculate risk if stopLoss is provided
      let riskValueVnd = 0;
      if (stopLoss && stopLoss > 0 && filledPrice > stopLoss) {
        riskValueVnd = Math.round((filledPrice - stopLoss) * quantity);
      }
      position = await Position.create({
        portfolioId,
        symbol,
        exchange,
        entryPrice: filledPrice,
        stopLoss: stopLoss || null,
        takeProfit: takeProfit || null,
        quantity,
        riskValueVnd,
        side: 'LONG',
        context: 'REAL',
        buyFeeVnd,
        notes,
      });
    }

    return { order, position };
  }

  /**
   * Confirm PENDING BUY order fill on broker. Chuyen PENDING → RECORDED, tao Position.
   *
   * @param {string} portfolioId
   * @param {string} orderId
   * @param {object} params
   * @param {number} params.actualPrice - Gia fill thuc te (VND)
   * @param {string|Date} params.actualDate - Ngay fill thuc te
   * @returns {{ order: object, position: object }}
   */
  static async confirmOrderFill(portfolioId, orderId, { actualPrice, actualDate }) {
    const orderRow = await Order.findById(orderId);
    if (!orderRow) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }
    if (orderRow.portfolio_id !== portfolioId) {
      const err = new Error('Order khong thuoc portfolio (T-03-04 defense)');
      err.statusCode = 403;
      throw err;
    }
    if (orderRow.status !== 'PENDING') {
      const err = new Error('Chi co the confirm fill order PENDING');
      err.statusCode = 409;
      throw err;
    }

    // Load portfolio (cho fee calc)
    const pRes = await query('SELECT * FROM financial.portfolios WHERE id = $1', [portfolioId]);
    const portfolio = pRes.rows[0] || {};

    // Compute locked (tu DB row — source-of-truth, T-03-02 mitigation)
    const qty = Number(orderRow.quantity);
    const lockedAmount = RealOrderService._computeLockedAmount(orderRow, portfolio);

    // Compute actual cost (MAP-05 D-06 integer VND)
    const actualFee = calculateBuyFee(actualPrice, qty, portfolio);
    const actualTotalCost = Math.round(Number(actualPrice) * qty) + actualFee;

    // Transfer lock → spent (1 transaction)
    await CapitalService.confirmBuyFill(portfolioId, actualTotalCost, lockedAmount);

    // Create Position OPEN voi entry_price = actualPrice (gia fill thuc te)
    const position = await Position.create({
      portfolioId,
      symbol: orderRow.symbol,
      exchange: orderRow.exchange,
      entryPrice: actualPrice,
      stopLoss: null,
      takeProfit: null,
      quantity: qty,
      riskValueVnd: 0,
      side: 'LONG',
      context: 'REAL',
      buyFeeVnd: actualFee,
      notes: orderRow.notes,
    });

    // Update order: PENDING → RECORDED + actual_filled_at (avg_fill_price luu actualPrice)
    await query(
      `UPDATE financial.orders
       SET status = 'RECORDED',
           actual_filled_at = $2,
           avg_fill_price = $3,
           filled_quantity = quantity,
           updated_at = NOW()
       WHERE id = $1`,
      [orderId, actualDate, actualPrice]
    );

    const updatedOrder = await Order.findById(orderId);
    return { order: updatedOrder, position };
  }

  /**
   * Cancel PENDING BUY order. Release lock + set status = CANCELLED.
   *
   * @param {string} portfolioId
   * @param {string} orderId
   * @returns {{ order: object }}
   */
  static async cancelBuyOrder(portfolioId, orderId) {
    const orderRow = await Order.findById(orderId);
    if (!orderRow) {
      const err = new Error('Order not found');
      err.statusCode = 404;
      throw err;
    }
    if (orderRow.portfolio_id !== portfolioId) {
      const err = new Error('Order khong thuoc portfolio (T-03-04 defense)');
      err.statusCode = 403;
      throw err;
    }
    if (orderRow.status !== 'PENDING') {
      const err = new Error('Chi co the cancel order PENDING');
      err.statusCode = 409;
      throw err;
    }

    const pRes = await query('SELECT * FROM financial.portfolios WHERE id = $1', [portfolioId]);
    const portfolio = pRes.rows[0] || {};
    const lockedAmount = RealOrderService._computeLockedAmount(orderRow, portfolio);

    await CapitalService.releaseBuyLock(portfolioId, lockedAmount);

    // Update order: PENDING → CANCELLED
    await query(
      `UPDATE financial.orders
       SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [orderId]
    );

    const updatedOrder = await Order.findById(orderId);
    return { order: updatedOrder };
  }

  /**
   * Lấy lịch sử giao dịch thật của portfolio.
   *
   * @param {string} portfolioId
   * @param {object} [options]
   * @param {number} [options.page=1]
   * @param {number} [options.limit=50]
   * @returns {{ orders: object[], total: number, page: number, limit: number }}
   */
  static async getTransactionHistory(portfolioId, { page = 1, limit = 50 } = {}) {
    const offset = (page - 1) * limit;

    const countRes = await query(
      `SELECT COUNT(*) as count
       FROM financial.orders
       WHERE portfolio_id = $1
         AND context = 'REAL'`,
      [portfolioId]
    );
    const total = parseInt(countRes.rows[0]?.count || 0);

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
