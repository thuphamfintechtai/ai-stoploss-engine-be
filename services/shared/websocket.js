import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

/**
 * Singleton io instance – dùng để broadcast từ controllers/workers.
 */
let ioInstance = null;

/**
 * Lấy io instance hiện tại.
 * @returns {Server|null}
 */
export function getIO() {
  return ioInstance;
}

/**
 * Broadcast notification đến user qua WebSocket.
 * @param {string} userId
 * @param {object} notification
 */
export function broadcastNotification(userId, notification) {
  if (!ioInstance) return;
  ioInstance.to(`user:${userId}`).emit('notification', notification);
}

/**
 * Broadcast cập nhật portfolio đến tất cả clients đang subscribe portfolio đó.
 * @param {string} portfolioId
 * @param {object} data
 */
export function broadcastPortfolioUpdate(portfolioId, data) {
  if (!ioInstance) return;
  ioInstance.to(`portfolio:${portfolioId}`).emit('portfolio_update', data);
}

/**
 * Broadcast cập nhật giá cổ phiếu.
 * SECURITY (Phase 5 MDI-07): public room — payload MUST NOT contain user_id
 * hoặc portfolio_id. Caller có trách nhiệm scrub trước khi gọi.
 * @param {string} symbol
 * @param {object} priceData
 */
export function broadcastPriceUpdate(symbol, priceData) {
  if (!ioInstance) return;
  ioInstance.to(`symbol:${symbol}`).emit('price_update', priceData);
}

/**
 * Broadcast cảnh báo giao dịch thông minh đến user.
 * @param {string} userId
 * @param {object} alert
 */
export function broadcastTradeAlert(userId, alert) {
  if (!ioInstance) return;
  ioInstance.to(`user:${userId}`).emit('trade_alert', alert);
}

/**
 * Gắn Socket.IO vào HTTP server để FE kết nối realtime.
 *
 * Phase 5 MDI-02: JWT bắt buộc ở handshake. Connection thiếu/sai token sẽ bị reject
 * qua `next(new Error('UNAUTHENTICATED' | 'INVALID_TOKEN'))` → socket.io tự emit
 * `connect_error` cho client và disconnect.
 */
export function initializeWebSocket(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      // MDI-02: reject anonymous connections — next(new Error) triggers disconnect(true) internally.
      return next(new Error('UNAUTHENTICATED'));
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
      socket.userEmail = decoded.email;
    } catch {
      return next(new Error('INVALID_TOKEN'));
    }
    next();
  });

  io.on('connection', (socket) => {
    // Middleware siết MDI-02 → tới đây socket.userId luôn có giá trị.
    if (process.env.LOG_LEVEL === 'debug') {
      console.log('[WS] Client connected:', socket.id, 'user:', socket.userId);
    }

    // Auto join user room (private room cho notification/trade_alert).
    socket.join(`user:${socket.userId}`);

    socket.on('subscribe_portfolio', async (portfolioId) => {
      if (!portfolioId || !socket.userId) {
        socket.emit('error', { message: 'Cần xác thực để subscribe portfolio' });
        return;
      }
      try {
        const { default: Portfolio } = await import('../../models/Portfolio.js');
        const portfolio = await Portfolio.findById(portfolioId);
        if (!portfolio || String(portfolio.user_id) !== String(socket.userId)) {
          socket.emit('error', { message: 'Không có quyền truy cập portfolio này' });
          return;
        }
        socket.join(`portfolio:${portfolioId}`);
        socket.emit('subscribed', { type: 'portfolio', id: portfolioId });
      } catch (err) {
        socket.emit('error', { message: 'Subscription thất bại' });
      }
    });
    socket.on('unsubscribe_portfolio', (portfolioId) => {
      if (portfolioId) socket.leave(`portfolio:${portfolioId}`);
    });
    socket.on('subscribe_symbol', (symbol) => {
      if (symbol) socket.join(`symbol:${symbol}`);
      socket.emit('subscribed', { type: 'symbol', id: symbol });
    });
    socket.on('unsubscribe_symbol', (symbol) => {
      if (symbol) socket.leave(`symbol:${symbol}`);
    });

    socket.on('disconnect', (reason) => {
      if (process.env.LOG_LEVEL === 'debug') {
        console.log('[WS] Client disconnected:', socket.id, reason);
      }
    });
  });

  ioInstance = io;
  return io;
}
