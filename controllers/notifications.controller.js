/**
 * Notifications Controller – CRUD cho hệ thống thông báo.
 */
import Notification from '../models/Notification.js';
import { markAsRead, markAllAsRead } from '../services/notificationService.js';

/**
 * GET /api/notifications
 * Lấy danh sách notifications của user
 */
export async function getNotifications(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const unreadOnly = req.query.unread_only === 'true';

    const [notifications, unreadCount, total] = await Promise.all([
      Notification.findByUserId(req.user.userId, { limit, offset, unreadOnly }),
      Notification.countUnread(req.user.userId),
      Notification.countTotal(req.user.userId, unreadOnly)
    ]);

    res.json({
      success: true,
      data: notifications,
      pagination: {
        total,
        limit,
        offset,
        has_more: offset + limit < total
      },
      unread_count: unreadCount
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/notifications/unread-count
 * Lấy số lượng notification chưa đọc
 */
export async function getUnreadCount(req, res, next) {
  try {
    const count = await Notification.countUnread(req.user.userId);
    res.json({ success: true, data: { count } });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/notifications/:id/read
 * Đánh dấu 1 notification là đã đọc
 */
export async function markNotificationRead(req, res, next) {
  try {
    const { id } = req.params;
    const updated = await markAsRead(id, req.user.userId);
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Notification không tồn tại' });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/notifications/mark-all-read
 * Đánh dấu tất cả notifications là đã đọc
 */
export async function markAllNotificationsRead(req, res, next) {
  try {
    const count = await markAllAsRead(req.user.userId);
    res.json({
      success: true,
      message: `Đã đánh dấu ${count} thông báo là đã đọc`,
      data: { updated_count: count }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/notifications/:id
 * Xóa 1 notification
 */
export async function deleteNotification(req, res, next) {
  try {
    const { id } = req.params;
    const deleted = await Notification.delete(id, req.user.userId);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Notification không tồn tại' });
    }
    res.json({ success: true, message: 'Đã xóa thông báo' });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/notifications/read
 * Xóa tất cả notifications đã đọc
 */
export async function deleteReadNotifications(req, res, next) {
  try {
    const count = await Notification.deleteReadByUserId(req.user.userId);
    res.json({
      success: true,
      message: `Đã xóa ${count} thông báo đã đọc`,
      data: { deleted_count: count }
    });
  } catch (error) {
    next(error);
  }
}
