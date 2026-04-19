import express from 'express';
import * as portfolioController from '../controllers/portfolio.controller.js';
import { validate } from '../middleware/validation.js';
import { authenticateToken } from '../middleware/auth.js';
import * as realOrderController from '../controllers/portfolio/realOrder.controller.js';
import * as realPositionController from '../controllers/portfolio/realPosition.controller.js';
import * as portfolioSummaryController from '../controllers/portfolio/portfolioSummary.controller.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

router.get('/', portfolioController.getAll);
router.post('/', validate(portfolioController.createPortfolioSchema), portfolioController.create);
router.get('/:id', portfolioController.getById);
router.put('/:id', validate(portfolioController.updatePortfolioSchema), portfolioController.update);
router.delete('/:id', portfolioController.deletePortfolio);
router.get('/:id/risk', portfolioController.getRisk);
router.get('/:id/performance', portfolioController.getPerformance);

// ─── Real Orders (Portfolio Tracking) ────────────────────────────────────────
// Ghi nhận lệnh thật đã đặt trên sàn (context='REAL', KHÔNG qua fillEngine)
router.post('/:portfolioId/real-orders',
  validate(realOrderController.createRealOrderSchema),
  realOrderController.createRealOrder);
router.get('/:portfolioId/real-orders',
  realOrderController.getTransactionHistory);

// ─── Real Positions ───────────────────────────────────────────────────────────
// Xem và đóng vị thế thật
router.get('/:portfolioId/real-positions',
  realPositionController.getOpenPositions);
router.post('/:portfolioId/real-positions/:positionId/close',
  validate(realPositionController.closePositionSchema),
  realPositionController.closePosition);

// ─── Portfolio Summary ────────────────────────────────────────────────────────
// Tổng quan portfolio: tổng giá trị, P&L, % return
router.get('/:portfolioId/real-summary', portfolioSummaryController.getPortfolioSummary);

export default router;
