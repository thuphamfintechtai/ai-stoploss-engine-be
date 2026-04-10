import { query } from '../config/database.js';

/**
 * AiRecommendation — Lưu trữ toàn bộ AI suggestions với audit trail.
 * RULE: AI chỉ tạo record ở đây. Việc apply suggestion phải do user xác nhận.
 * RULE: Không bao giờ xóa records — đây là audit trail tài chính.
 */
class AiRecommendation {
  static async create({
    userId,
    symbol,
    exchange,
    side = 'LONG',
    entryPriceAtRequest,
    ohlcvFrom = null,
    ohlcvTo   = null,
    daysAvailable = 0,
    suggestions,          // [{type, stop_loss_vnd, take_profit_vnd, rr_ratio, ...}]
    technicalScore = null,
    technicalLabel = null,
    scoreMethodology = null,
    analysisText = null,
    keyLevels = {},
    modelUsed = null,
    disclaimer,
  }) {
    const result = await query(
      `INSERT INTO financial.ai_recommendations (
        user_id, symbol, exchange, side,
        entry_price_at_request, ohlcv_from, ohlcv_to, days_available,
        suggestions, technical_score, technical_label, score_methodology,
        analysis_text, key_levels, model_used, disclaimer, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'GENERATED')
      RETURNING *`,
      [
        userId, symbol, exchange, side,
        entryPriceAtRequest, ohlcvFrom, ohlcvTo, daysAvailable,
        JSON.stringify(suggestions),
        technicalScore, technicalLabel, scoreMethodology,
        analysisText, JSON.stringify(keyLevels), modelUsed, disclaimer,
      ]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await query(
      'SELECT * FROM financial.ai_recommendations WHERE id = $1',
      [id]
    );
    return result.rows[0] ?? null;
  }

  static async findByUser(userId, { limit = 20 } = {}) {
    const result = await query(
      `SELECT * FROM financial.ai_recommendations
       WHERE user_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  /**
   * Đánh dấu recommendation đã được user apply.
   * Dùng optimistic locking: chỉ update nếu status = 'GENERATED'.
   * @returns {object|null} Updated record, null nếu đã apply rồi
   */
  static async markApplied(id, selectedLevel) {
    const result = await query(
      `UPDATE financial.ai_recommendations
       SET status = 'APPLIED', applied_level = $2, applied_at = NOW()
       WHERE id = $1 AND status = 'GENERATED'
       RETURNING *`,
      [id, selectedLevel]
    );
    return result.rows[0] ?? null;
  }

  /** Đánh dấu recommendation bị user bỏ qua */
  static async markIgnored(id) {
    await query(
      `UPDATE financial.ai_recommendations
       SET status = 'IGNORED'
       WHERE id = $1 AND status = 'GENERATED'`,
      [id]
    );
  }

  /** Expire recommendations cũ hơn 24h chưa được apply */
  static async expireStale() {
    await query(
      `UPDATE financial.ai_recommendations
       SET status = 'EXPIRED'
       WHERE status = 'GENERATED'
         AND created_at < NOW() - INTERVAL '24 hours'`
    );
  }

  /** Ghi model inference log */
  static async logInference({
    recommendationId,
    modelName,
    latencyMs,
    status,
    errorMessage = null,
  }) {
    try {
      await query(
        `INSERT INTO financial.model_inference_logs
         (recommendation_id, model_name, latency_ms, status, error_message)
         VALUES ($1,$2,$3,$4,$5)`,
        [recommendationId, modelName, latencyMs, status, errorMessage]
      );
    } catch (err) {
      console.error('[AiRecommendation] logInference failed:', err.message);
    }
  }
}

export default AiRecommendation;
