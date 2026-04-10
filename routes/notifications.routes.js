import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  getNotifications,
  getUnreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  deleteReadNotifications
} from '../controllers/notifications.controller.js';

const router = express.Router();

// Tất cả notification routes cần xác thực
router.use(authenticateToken);

/**
 * GET /api/notifications
 * Lấy danh sách notifications
 * Query: { limit?, offset?, unread_only? }
 */
router.get('/', getNotifications);

/**
 * GET /api/notifications/unread-count
 * Lấy số lượng notification chưa đọc
 */
router.get('/unread-count', getUnreadCount);

/**
 * POST /api/notifications/mark-all-read
 * Đánh dấu tất cả notifications là đã đọc
 */
router.post('/mark-all-read', markAllNotificationsRead);

/**
 * DELETE /api/notifications/read
 * Xóa tất cả notifications đã đọc
 */
router.delete('/read', deleteReadNotifications);

/**
 * PATCH /api/notifications/:id/read
 * Đánh dấu 1 notification là đã đọc
 */
router.patch('/:id/read', markNotificationRead);

/**
 * DELETE /api/notifications/:id
 * Xóa 1 notification
 */
router.delete('/:id', deleteNotification);

export default router;
