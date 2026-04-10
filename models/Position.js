import { query } from '../config/database.js';

/**
 * Position model: CRUD + updateStopLoss (cho trailing).
 * Bảng positions có thêm cột: side, stop_type, stop_params, take_profit_type, take_profit_params, trailing_current_stop (migration 005).
 */
class Position {
  /**
   * Tạo position – đơn vị tiền tệ: VND.
   * trailing_current_stop: khi stop_type = TRAILING thì set = stopLoss ban đầu.
   */
  static async create({
    portfolioId,
    symbol,
    exchange,
    entryPrice,
    stopLoss,
    takeProfit,
    quantity,
    riskValueVnd,
    side = 'LONG',
    stopType = 'FIXED',
    stopParams = null,
    takeProfitType = null,
    takeProfitParams = null,
    trailingCurrentStop = null,
    signalSourceId = null,
    notes = null,
    // Context separation fields (migration 007)
    context = 'PAPER',
    // Fee tracking fields (migration 006)
    buyFeeVnd = 0,
  }) {
    const result = await query(
      `INSERT INTO positions (
        portfolio_id, symbol, exchange, entry_price, stop_loss, take_profit,
        quantity, risk_value_vnd, status,
        side, stop_type, stop_params, take_profit_type, take_profit_params,
        trailing_current_stop, signal_source_id, notes,
        context, buy_fee_vnd
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'OPEN', $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING *`,
      [
        portfolioId, symbol, exchange, entryPrice, stopLoss ?? null, takeProfit ?? null,
        quantity, riskValueVnd,
        side, stopType, stopParams ? JSON.stringify(stopParams) : null,
        takeProfitType ?? null, takeProfitParams ? JSON.stringify(takeProfitParams) : null,
        trailingCurrentStop ?? null,
        signalSourceId ?? null, notes ?? null,
        context, buyFeeVnd,
      ]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await query(
      'SELECT * FROM positions WHERE id = $1',
      [id]
    );
    return result.rows[0];
  }

  static async findByPortfolioId(portfolioId, options = {}) {
    const { status = null } = options;
    if (status) {
      // Hỗ trợ cả status đơn lẻ và danh sách phân cách dấu phẩy
      const statuses = typeof status === 'string' && status.includes(',')
        ? status.split(',').map(s => s.trim())
        : [status];
      const result = await query(
        'SELECT * FROM positions WHERE portfolio_id = $1 AND status = ANY($2::text[]) ORDER BY opened_at DESC',
        [portfolioId, statuses]
      );
      return result.rows;
    }
    const result = await query(
      'SELECT * FROM positions WHERE portfolio_id = $1 ORDER BY opened_at DESC',
      [portfolioId]
    );
    return result.rows;
  }

  /**
   * Cập nhật position – lãi/lỗ chỉ dùng VND (profitLossVnd).
   * Cột profit_loss_usd trong DB không cập nhật (legacy).
   */
  static async update(id, {
    stopLoss = undefined,
    takeProfit = undefined,
    trailingCurrentStop = undefined,
    status = undefined,
    closedAt = undefined,
    closedPrice = undefined,
    profitLossVnd = undefined,
    grossPnlVnd = undefined,
    sellFeeVnd = undefined,
    sellTaxVnd = undefined,
    slippageVnd = undefined,
    slippageReason = undefined,
    notes = undefined
  }) {
    const updates = [];
    const values = [];
    let idx = 1;

    if (stopLoss !== undefined) { updates.push(`stop_loss = $${idx++}`); values.push(stopLoss); }
    if (takeProfit !== undefined) { updates.push(`take_profit = $${idx++}`); values.push(takeProfit); }
    if (trailingCurrentStop !== undefined) { updates.push(`trailing_current_stop = $${idx++}`); values.push(trailingCurrentStop); }
    if (status !== undefined) { updates.push(`status = $${idx++}`); values.push(status); }
    if (closedAt !== undefined) { updates.push(`closed_at = $${idx++}`); values.push(closedAt); }
    if (closedPrice !== undefined) { updates.push(`closed_price = $${idx++}`); values.push(closedPrice); }
    if (profitLossVnd !== undefined) { updates.push(`profit_loss_vnd = $${idx++}`); values.push(profitLossVnd); }
    if (grossPnlVnd !== undefined) { updates.push(`gross_pnl_vnd = $${idx++}`); values.push(grossPnlVnd); }
    if (sellFeeVnd !== undefined) { updates.push(`sell_fee_vnd = $${idx++}`); values.push(sellFeeVnd); }
    if (sellTaxVnd !== undefined) { updates.push(`sell_tax_vnd = $${idx++}`); values.push(sellTaxVnd); }
    if (slippageVnd !== undefined) { updates.push(`slippage_vnd = $${idx++}`); values.push(slippageVnd); }
    if (slippageReason !== undefined) { updates.push(`slippage_reason = $${idx++}`); values.push(slippageReason); }
    if (notes !== undefined) { updates.push(`notes = $${idx++}`); values.push(notes); }

    if (updates.length === 0) return this.findById(id);

    values.push(id);
    const result = await query(
      `UPDATE positions SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`,
      values
    );
    return result.rows[0];
  }

  /** Cập nhật mức stop hiện tại (trailing). */
  static async updateStopLoss(id, newStopLoss) {
    return this.update(id, { stopLoss: newStopLoss, trailingCurrentStop: newStopLoss });
  }

  /**
   * Lay positions co pagination — 20 items/page mac dinh.
   * Backward-compatible: findByPortfolioId cu van hoat dong binh thuong.
   *
   * @param {string} portfolioId
   * @param {{ page?: number, limit?: number, status?: string|null }} options
   * @returns {Promise<{ data: Array, total: number, page: number, limit: number, totalPages: number }>}
   */
  static async findByPortfolioPaginated(portfolioId, { page = 1, limit = 20, status = null } = {}) {
    const offset = (page - 1) * limit;

    let whereClause = 'portfolio_id = $1';
    const countParams = [portfolioId];
    const dataParams = [portfolioId];
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND status = $${paramIdx}`;
      countParams.push(status);
      dataParams.push(status);
      paramIdx++;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM positions WHERE ${whereClause}`,
      countParams
    );

    const total = parseInt(countResult.rows[0].count, 10);

    dataParams.push(limit, offset);
    const dataResult = await query(
      `SELECT * FROM positions WHERE ${whereClause} ORDER BY opened_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      dataParams
    );

    return {
      data: dataResult.rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}

export default Position;
