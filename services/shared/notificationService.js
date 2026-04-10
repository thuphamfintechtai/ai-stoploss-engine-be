/**
 * Notification Service – Tạo notification trong DB và broadcast qua WebSocket.
 */
import { query } from '../../config/database.js';
import { getIO } from './websocket.js';

const DB_SCHEMA = process.env.DB_SCHEMA || 'financial';

/**
 * Tạo notification mới.
 *
 * @param {object} params
 * @param {string} params.userId - ID người dùng
 * @param {string} params.type - Loại notification (SL_TRIGGERED, TP_TRIGGERED, RISK_WARNING, NEW_SIGNAL, AI_ALERT, ...)
 * @param {string} params.title - Tiêu đề
 * @param {string} params.message - Nội dung
 * @param {'INFO'|'WARNING'|'ERROR'|'SUCCESS'} [params.severity='INFO'] - Mức độ
 * @param {object} [params.metadata=null] - Dữ liệu bổ sung
 * @returns {Promise<object>} Notification đã tạo
 */
export async function createNotification({ userId, type, title, message, severity = 'INFO', metadata = null }) {
  try {
    const result = await query(
      `INSERT INTO ${DB_SCHEMA}.notifications (user_id, type, title, message, severity, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [userId, type, title, message, severity, metadata ? JSON.stringify(metadata) : null]
    );
    const notification = result.rows[0];

    // Broadcast qua WebSocket nếu có io instance
    const io = getIO();
    if (io) {
      io.to(`user:${userId}`).emit('notification', {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        severity: notification.severity,
        metadata: notification.metadata,
        created_at: notification.created_at
      });
    }

    return notification;
  } catch (error) {
    console.error('[NotificationService] Error creating notification:', error.message);
    throw error;
  }
}

/**
 * Tạo nhiều notifications cùng lúc.
 * @param {Array<object>} notifications - Mảng notification objects
 */
export async function createBulkNotifications(notifications) {
  const results = [];
  for (const n of notifications) {
    try {
      const created = await createNotification(n);
      results.push(created);
    } catch (error) {
      console.error(`[NotificationService] Failed to create notification for user ${n.userId}:`, error.message);
    }
  }
  return results;
}

/**
 * Lấy user_id từ portfolio_id.
 */
export async function getUserIdByPortfolio(portfolioId) {
  try {
    const result = await query(
      `SELECT user_id FROM ${DB_SCHEMA}.portfolios WHERE id = $1`,
      [portfolioId]
    );
    return result.rows[0]?.user_id || null;
  } catch {
    return null;
  }
}

/**
 * Đánh dấu notification là đã đọc.
 */
export async function markAsRead(notificationId, userId) {
  const result = await query(
    `UPDATE ${DB_SCHEMA}.notifications
     SET is_read = TRUE, read_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [notificationId, userId]
  );
  return result.rows[0];
}

/**
 * Đánh dấu tất cả notification của user là đã đọc.
 */
export async function markAllAsRead(userId) {
  const result = await query(
    `UPDATE ${DB_SCHEMA}.notifications
     SET is_read = TRUE, updated_at = NOW()
     WHERE user_id = $1 AND is_read = FALSE
     RETURNING id`,
    [userId]
  );
  return result.rowCount;
}

export default {
  createNotification,
  createBulkNotifications,
  getUserIdByPortfolio,
  markAsRead,
  markAllAsRead
};
