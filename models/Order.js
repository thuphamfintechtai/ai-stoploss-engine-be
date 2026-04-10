import { query, transaction } from '../config/database.js';

/**
 * Order Model — quản lý lifecycle lệnh đặt.
 * Trạng thái: PENDING → FILLED | PARTIALLY_FILLED | CANCELLED | EXPIRED | REJECTED
 * Position chỉ được tạo khi order chuyển sang FILLED.
 */
class Order {
  /**
   * Tạo lệnh mới.
   * - Paper trading: status = 'PENDING' (default)
   * - Real order: status = 'RECORDED', context = 'REAL', manualEntry = true
   */
  static async create({
    portfolioId,
    symbol,
    exchange,
    side,
    orderType,
    limitPrice = null,
    quantity,
    simulationMode = 'INSTANT',
    stopLossVnd = null,
    stopType = null,
    stopParams = null,
    takeProfitVnd = null,
    takeProfitType = null,
    expiredAt = null,
    notes = null,
    // Context separation fields (migration 007)
    context = 'PAPER',
    status = 'PENDING',
    manualEntry = false,
    actualFilledAt = null,
  }) {
    const result = await query(
      `INSERT INTO financial.orders (
        portfolio_id, symbol, exchange, side, order_type,
        limit_price, quantity, simulation_mode,
        stop_loss_vnd, stop_type, stop_params,
        take_profit_vnd, take_profit_type,
        expired_at, notes, status, placed_at,
        context, manual_entry, actual_filled_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),$17,$18,$19)
      RETURNING *`,
      [
        portfolioId, symbol, exchange, side, orderType,
        limitPrice, quantity, simulationMode,
        stopLossVnd, stopType,
        stopParams ? JSON.stringify(stopParams) : null,
        takeProfitVnd, takeProfitType,
        expiredAt, notes, status,
        context, manualEntry, actualFilledAt,
      ]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await query(
      'SELECT * FROM financial.orders WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  }

  /** Tìm tất cả lệnh PENDING theo portfolio */
  static async findPendingByPortfolio(portfolioId) {
    const result = await query(
      `SELECT * FROM financial.orders
       WHERE portfolio_id = $1 AND status = 'PENDING'
       ORDER BY placed_at DESC`,
      [portfolioId]
    );
    return result.rows;
  }

  /** Tìm tất cả lệnh theo portfolio (mọi status) */
  static async findByPortfolio(portfolioId, { status = null, limit = 50 } = {}) {
    if (status) {
      const statuses = Array.isArray(status) ? status : [status];
      const result = await query(
        `SELECT * FROM financial.orders
         WHERE portfolio_id = $1 AND status = ANY($2::text[])
         ORDER BY placed_at DESC LIMIT $3`,
        [portfolioId, statuses, limit]
      );
      return result.rows;
    }
    const result = await query(
      `SELECT * FROM financial.orders
       WHERE portfolio_id = $1
       ORDER BY placed_at DESC LIMIT $2`,
      [portfolioId, limit]
    );
    return result.rows;
  }

  /** Tìm lệnh PENDING theo symbol (cho fill engine) */
  static async findPendingBySymbol(symbol) {
    const result = await query(
      `SELECT * FROM financial.orders
       WHERE symbol = $1 AND status = 'PENDING'
       ORDER BY placed_at ASC`,
      [symbol]
    );
    return result.rows;
  }

  /** Lấy danh sách symbols có lệnh PENDING */
  static async getDistinctPendingSymbols() {
    const result = await query(
      `SELECT DISTINCT symbol FROM financial.orders WHERE status = 'PENDING'`
    );
    return result.rows.map(r => r.symbol);
  }

  /**
   * Fill order (toàn bộ hoặc một phần).
   * Dùng optimistic locking: chỉ update nếu status vẫn là PENDING/PARTIALLY_FILLED.
   *
   * @param {string} id - Order ID
   * @param {number} fillQty - Số CP được fill trong lần này
   * @param {number} fillPriceVnd - Giá fill (VND)
   * @returns {object|null} Updated order, hoặc null nếu đã bị race condition
   */
  static async fill(id, fillQty, fillPriceVnd) {
    const result = await query(
      `UPDATE financial.orders
       SET
         filled_quantity = filled_quantity + $2,
         avg_fill_price  = $3,
         status = CASE
           WHEN filled_quantity + $2 >= quantity THEN 'FILLED'
           ELSE 'PARTIALLY_FILLED'
         END,
         filled_at = CASE
           WHEN filled_quantity + $2 >= quantity THEN NOW()
           ELSE filled_at
         END,
         updated_at = NOW()
       WHERE id = $1
         AND status IN ('PENDING', 'PARTIALLY_FILLED')
       RETURNING *`,
      [id, fillQty, fillPriceVnd]
    );
    return result.rows[0] ?? null; // null = race condition (đã fill/cancel bởi process khác)
  }

  /**
   * Cancel order. Chỉ cancel được khi PENDING hoặc PARTIALLY_FILLED.
   * Dùng optimistic locking tương tự fill().
   */
  static async cancel(id) {
    const result = await query(
      `UPDATE financial.orders
       SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status IN ('PENDING', 'PARTIALLY_FILLED')
       RETURNING *`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Expire các lệnh hết hạn (hết phiên, hoặc expired_at đã qua).
   * @returns {object[]} Danh sách orders đã expire
   */
  static async expireStale() {
    const result = await query(
      `UPDATE financial.orders
       SET status = 'EXPIRED', updated_at = NOW()
       WHERE status = 'PENDING'
         AND expired_at IS NOT NULL
         AND expired_at < NOW()
       RETURNING *`
    );
    return result.rows;
  }

  /** Reject order với lý do */
  static async reject(id, reason) {
    const result = await query(
      `UPDATE financial.orders
       SET status = 'REJECTED', reject_reason = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'PENDING'
       RETURNING *`,
      [id, reason]
    );
    return result.rows[0] ?? null;
  }
}

export default Order;
