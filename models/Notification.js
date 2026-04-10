import { query } from '../config/database.js';

const DB_SCHEMA = process.env.DB_SCHEMA || 'financial';

class Notification {
  /**
   * Lấy danh sách notifications của user, có phân trang.
   */
  static async findByUserId(userId, { limit = 20, offset = 0, unreadOnly = false } = {}) {
    const conditions = ['user_id = $1'];
    const values = [userId];
    let idx = 2;

    if (unreadOnly) {
      conditions.push(`is_read = FALSE`);
    }

    const result = await query(
      `SELECT * FROM ${DB_SCHEMA}.notifications
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );
    return result.rows;
  }

  /**
   * Đếm số notification chưa đọc.
   */
  static async countUnread(userId) {
    const result = await query(
      `SELECT COUNT(*) as count FROM ${DB_SCHEMA}.notifications
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId]
    );
    return parseInt(result.rows[0]?.count || 0, 10);
  }

  /**
   * Tổng số notifications.
   */
  static async countTotal(userId, unreadOnly = false) {
    const where = unreadOnly
      ? 'WHERE user_id = $1 AND is_read = FALSE'
      : 'WHERE user_id = $1';
    const result = await query(
      `SELECT COUNT(*) as count FROM ${DB_SCHEMA}.notifications ${where}`,
      [userId]
    );
    return parseInt(result.rows[0]?.count || 0, 10);
  }

  /**
   * Xóa notification theo id (chỉ của user đó).
   */
  static async delete(id, userId) {
    const result = await query(
      `DELETE FROM ${DB_SCHEMA}.notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    );
    return result.rows[0];
  }

  /**
   * Xóa tất cả notifications đã đọc của user.
   */
  static async deleteReadByUserId(userId) {
    const result = await query(
      `DELETE FROM ${DB_SCHEMA}.notifications WHERE user_id = $1 AND is_read = TRUE`,
      [userId]
    );
    return result.rowCount;
  }
}

export default Notification;
