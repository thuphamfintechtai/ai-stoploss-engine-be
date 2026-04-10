import { query } from '../config/database.js';

/**
 * ExecutionLog — Audit trail cho mọi state transition.
 * Ghi log cho: ORDER_CREATED, ORDER_FILLED, ORDER_CANCELLED, ORDER_EXPIRED,
 *              POSITION_CREATED, SL_TRIGGERED, TP_TRIGGERED, POSITION_CLOSED_MANUAL,
 *              TRAILING_UPDATED, SLIPPAGE_OCCURRED
 *
 * RULE: Không bao giờ xóa records từ bảng này.
 */
class ExecutionLog {
  static async write({
    entityType,      // 'ORDER' | 'POSITION' | 'ALERT'
    entityId,
    portfolioId = null,
    eventType,       // 'SL_TRIGGERED' | 'TP_TRIGGERED' | ...
    triggerPrice = null,
    fillPrice    = null,
    slippageVnd  = null,
    metadata     = {},
    workerRunId  = null,
  }) {
    try {
      const result = await query(
        `INSERT INTO financial.execution_logs (
          entity_type, entity_id, portfolio_id,
          event_type, trigger_price, fill_price, slippage_vnd,
          metadata, worker_run_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        RETURNING id`,
        [
          entityType, entityId, portfolioId,
          eventType, triggerPrice, fillPrice, slippageVnd,
          JSON.stringify(metadata), workerRunId,
        ]
      );
      return result.rows[0]?.id;
    } catch (err) {
      // Log failures không được throw — audit trail không được crash business logic
      console.error('[ExecutionLog] write failed:', err.message, { entityType, entityId, eventType });
      return null;
    }
  }

  static async findByEntity(entityType, entityId, { limit = 50 } = {}) {
    const result = await query(
      `SELECT * FROM financial.execution_logs
       WHERE entity_type = $1 AND entity_id = $2
       ORDER BY event_at DESC LIMIT $3`,
      [entityType, entityId, limit]
    );
    return result.rows;
  }

  static async findByPortfolio(portfolioId, { limit = 100, offset = 0 } = {}) {
    const result = await query(
      `SELECT * FROM financial.execution_logs
       WHERE portfolio_id = $1
       ORDER BY event_at DESC
       LIMIT $2 OFFSET $3`,
      [portfolioId, limit, offset]
    );
    return result.rows;
  }
}

export default ExecutionLog;
