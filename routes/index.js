import express from 'express';
import authRoutes from './auth.routes.js';
import portfolioRoutes from './portfolio.routes.js';
import marketRoutes from './market.routes.js';
import aiRoutes from './ai.routes.js';
import notificationsRoutes from './notifications.routes.js';
import watchlistRoutes from './watchlist.routes.js';
import priceAlertsRoutes from './priceAlerts.routes.js';

const router = express.Router();

// API version prefix
const API_VERSION = '/api';

// Mount routes
router.use(`${API_VERSION}/auth`, authRoutes);
router.use(`${API_VERSION}/portfolios`, portfolioRoutes);
// Positions chỉ qua nested: /api/portfolios/:portfolioId/positions (trong portfolio.routes.js)
router.use(`${API_VERSION}/market`, marketRoutes);
router.use(`${API_VERSION}/ai`, aiRoutes);
router.use(`${API_VERSION}/notifications`, notificationsRoutes);
router.use(`${API_VERSION}/watchlist`, watchlistRoutes);
router.use(`${API_VERSION}/price-alerts`, priceAlertsRoutes);

// Health check
router.get(`${API_VERSION}/health`, (req, res) => {
  res.json({
    success: true,
    message: 'AI Stop-Loss Engine API is running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

export default router;
