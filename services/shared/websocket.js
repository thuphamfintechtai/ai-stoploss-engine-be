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
 * Chấp nhận token từ handshake.auth.token; không từ chối kết nối nếu thiếu/sai token.
 */
export function initializeWebSocket(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true }
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.userId = null;
      return next();
    }
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId;
    } catch {
      socket.userId = null;
    }
    next();
  });

  io.on('connection', (socket) => {
    if (process.env.LOG_LEVEL === 'debug') {
      console.log('[WS] Client connected:', socket.id, socket.userId ? 'authenticated' : 'anonymous');
    }

    // Tự động join user room nếu đã xác thực
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

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
