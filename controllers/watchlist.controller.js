/**
 * Watchlist Controller – Quản lý danh sách theo dõi mã CK theo từng user.
 * Sync 2 chiều với FE localStorage (FE gửi lên, BE lưu DB và trả về).
 */
import { query } from '../config/database.js';

const DB = process.env.DB_SCHEMA || 'financial';

/**
 * GET /api/watchlist
 * Lấy toàn bộ watchlist của user.
 */
export async function getWatchlist(req, res, next) {
  try {
    const result = await query(
      `SELECT id, symbol, exchange, created_at
       FROM ${DB}.watchlists
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [req.user.userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/watchlist
 * Thêm 1 mã vào watchlist. Body: { symbol, exchange }
 */
export async function addToWatchlist(req, res, next) {
  try {
    const { symbol, exchange = 'HOSE' } = req.body;
    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ success: false, message: 'symbol là bắt buộc' });
    }
    const sym = symbol.trim().toUpperCase();

    const result = await query(
      `INSERT INTO ${DB}.watchlists (user_id, symbol, exchange)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, symbol) DO UPDATE SET exchange = EXCLUDED.exchange
       RETURNING id, symbol, exchange, created_at`,
      [req.user.userId, sym, exchange.toUpperCase()]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/watchlist/bulk
 * Đồng bộ toàn bộ watchlist từ FE lên (overwrite).
 * Body: { items: [{ symbol, exchange }] }
 */
export async function syncWatchlist(req, res, next) {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ success: false, message: 'items phải là mảng' });
    }

    // Xóa tất cả và insert lại trong 1 transaction
    await query(`DELETE FROM ${DB}.watchlists WHERE user_id = $1`, [req.user.userId]);

    if (items.length > 0) {
      const values = items.map((item, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`).join(', ');
      const params = [req.user.userId, ...items.flatMap(item => [
        (item.symbol || '').trim().toUpperCase(),
        (item.exchange || 'HOSE').toUpperCase()
      ])];
      await query(
        `INSERT INTO ${DB}.watchlists (user_id, symbol, exchange) VALUES ${values} ON CONFLICT DO NOTHING`,
        params
      );
    }

    const result = await query(
      `SELECT id, symbol, exchange, created_at FROM ${DB}.watchlists WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.user.userId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/watchlist/:symbol
 * Xóa 1 mã khỏi watchlist.
 */
export async function removeFromWatchlist(req, res, next) {
  try {
    const sym = (req.params.symbol || '').trim().toUpperCase();
    await query(
      `DELETE FROM ${DB}.watchlists WHERE user_id = $1 AND symbol = $2`,
      [req.user.userId, sym]
    );
    res.json({ success: true, message: `Đã xóa ${sym} khỏi watchlist` });
  } catch (error) {
    next(error);
  }
}
