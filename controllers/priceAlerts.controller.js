/**
 * Price Alerts Controller – Cảnh báo giá cổ phiếu.
 * Các loại cảnh báo:
 *   ABOVE        – Giá vượt lên trên mức target_value (VND)
 *   BELOW        – Giá giảm xuống dưới mức target_value (VND)
 *   PERCENT_UP   – Giá tăng ≥ target_value% so với reference_price lúc tạo
 *   PERCENT_DOWN – Giá giảm ≥ target_value% so với reference_price lúc tạo
 */
import Joi from 'joi';
import { query } from '../config/database.js';

const DB = process.env.DB_SCHEMA || 'financial';

const createAlertSchema = Joi.object({
  symbol:    Joi.string().min(1).max(20).required(),
  exchange:  Joi.string().valid('HOSE', 'HNX', 'UPCOM').default('HOSE'),
  condition: Joi.string().valid('ABOVE', 'BELOW', 'PERCENT_UP', 'PERCENT_DOWN').required(),
  target_value:    Joi.number().required(),
  reference_price: Joi.number().positive().optional(),
  note: Joi.string().max(200).optional().allow('', null)
});

/**
 * GET /api/price-alerts
 * Lấy tất cả price alerts của user.
 * Query: { symbol?, active_only? }
 */
export async function getAlerts(req, res, next) {
  try {
    const { symbol, active_only } = req.query;
    const conditions = ['user_id = $1'];
    const values = [req.user.userId];
    let idx = 2;

    if (symbol) {
      conditions.push(`symbol = $${idx++}`);
      values.push(symbol.toUpperCase());
    }
    if (active_only === 'true') {
      conditions.push(`is_active = TRUE AND is_triggered = FALSE`);
    }

    const result = await query(
      `SELECT * FROM ${DB}.price_alerts
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC`,
      values
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/price-alerts
 * Tạo price alert mới.
 * Body: { symbol, exchange?, condition, target_value, reference_price?, note? }
 */
export async function createAlert(req, res, next) {
  try {
    const { error, value } = createAlertSchema.validate(req.body, { stripUnknown: true });
    if (error) return res.status(400).json({ success: false, message: error.details[0].message });

    const { symbol, exchange, condition, target_value, reference_price, note } = value;

    // Nếu PERCENT_UP/DOWN không có reference_price thì lấy giá hiện tại từ API
    let refPrice = reference_price;
    if (!refPrice && (condition === 'PERCENT_UP' || condition === 'PERCENT_DOWN')) {
      try {
        const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
        const priceRes = await fetch(`${API_BASE}/api/market/symbols/${encodeURIComponent(symbol)}/price?exchange=${exchange}`);
        if (priceRes.ok) {
          const priceData = await priceRes.json();
          const priceRaw = priceData?.data?.price;
          if (priceRaw) refPrice = parseFloat(priceRaw);
        }
      } catch { /* ignore */ }
    }

    const result = await query(
      `INSERT INTO ${DB}.price_alerts
         (user_id, symbol, exchange, condition, target_value, reference_price, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user.userId, symbol.toUpperCase(), exchange, condition, target_value, refPrice ?? null, note ?? null]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/price-alerts/:id
 * Xóa price alert.
 */
export async function deleteAlert(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(
      `DELETE FROM ${DB}.price_alerts WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, req.user.userId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Alert không tồn tại' });
    }
    res.json({ success: true, message: 'Đã xóa cảnh báo' });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/price-alerts/:id/toggle
 * Bật/tắt price alert (is_active).
 */
export async function toggleAlert(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(
      `UPDATE ${DB}.price_alerts
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, req.user.userId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Alert không tồn tại' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/price-alerts/:id/reset
 * Reset alert đã kích hoạt (is_triggered → false, is_active → true).
 */
export async function resetAlert(req, res, next) {
  try {
    const { id } = req.params;
    const result = await query(
      `UPDATE ${DB}.price_alerts
       SET is_triggered = FALSE, triggered_at = NULL, triggered_price = NULL,
           is_active = TRUE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, req.user.userId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ success: false, message: 'Alert không tồn tại' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}
