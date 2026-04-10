/**
 * RealPosition Controller — HTTP handlers cho position close (đóng vị thế thủ công).
 *
 * GET    /api/portfolios/:portfolioId/real-positions                       — Danh sách vị thế đang mở
 * POST   /api/portfolios/:portfolioId/real-positions/:positionId/close     — Đóng vị thế
 *
 * NOTE: CapitalService (pending settlement) sẽ được wire vào đây bởi Plan 06.
 * Controller này CHỈ làm: validate → ownership → service call → response.
 */

import Joi from 'joi';
import Portfolio from '../../models/Portfolio.js';
import RealPositionService from '../../services/portfolio/realPositionService.js';
// KHONG import CapitalService -- Plan 06 se wire pending settlement vao day

// ─── Validation Schema ────────────────────────────────────────────────────────

export const closePositionSchema = Joi.object({
  sell_price: Joi.number().positive().required(),
  sell_date:  Joi.date().iso().required(),
  notes:      Joi.string().max(500).optional().allow('', null),
});

// ─── Helper ───────────────────────────────────────────────────────────────────

async function ensurePortfolioOwnership(req, res) {
  const portfolioId = req.params.portfolioId;
  const portfolio = await Portfolio.findById(portfolioId);
  if (!portfolio) {
    res.status(404).json({ success: false, message: 'Portfolio không tồn tại' });
    return null;
  }
  if (portfolio.user_id !== req.user.userId) {
    res.status(403).json({ success: false, message: 'Không có quyền truy cập portfolio này' });
    return null;
  }
  return portfolio;
}

// ─── Controllers ─────────────────────────────────────────────────────────────

/**
 * Lấy danh sách vị thế đang mở (context='REAL', status='OPEN').
 * GET /api/portfolios/:portfolioId/real-positions
 */
export const getOpenPositions = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const positions = await RealPositionService.getOpenPositions(portfolio.id);

    return res.json({
      success: true,
      data: positions,
      count: positions.length,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Đóng vị thế thật (manual close) với sell price và P&L calculation.
 * POST /api/portfolios/:portfolioId/real-positions/:positionId/close
 */
export const closePosition = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const positionId = req.params.positionId;
    const { sell_price, sell_date, notes } = req.validatedBody;

    // NOTE: Pending settlement (CapitalService.addPendingSettlement) sẽ được thêm bởi Plan 06
    const result = await RealPositionService.closePosition(positionId, {
      sellPrice: sell_price,
      sellDate: sell_date,
      portfolioId: portfolio.id,
      notes,
    });

    return res.json({
      success: true,
      data: {
        position: result.position,
        pnl: result.pnl,
        sellOrder: result.sellOrder,
      },
    });
  } catch (error) {
    next(error);
  }
};
