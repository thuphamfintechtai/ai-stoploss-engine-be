/**
 * RealOrder Controller — HTTP handlers cho real order entry (nhập lệnh thật).
 *
 * POST   /api/portfolios/:portfolioId/real-orders        — Ghi nhận lệnh thật
 * GET    /api/portfolios/:portfolioId/real-orders        — Lịch sử giao dịch thật
 *
 * NOTE: CapitalService (cash deduction) sẽ được wire vào đây bởi Plan 06.
 * Controller này CHỈ làm: validate → ownership → service call → response.
 */

import Joi from 'joi';
import Portfolio from '../../models/Portfolio.js';
import RealOrderService from '../../services/portfolio/realOrderService.js';
// KHONG import CapitalService -- Plan 06 se wire cash deduction vao day

// ─── Validation Schema ────────────────────────────────────────────────────────

export const createRealOrderSchema = Joi.object({
  symbol:       Joi.string().max(20).uppercase().required(),
  exchange:     Joi.string().valid('HOSE', 'HNX', 'UPCOM').required(),
  side:         Joi.string().valid('BUY', 'SELL').required(),
  quantity:     Joi.number().integer().positive().required(),
  filled_price: Joi.number().positive().required(),
  filled_date:  Joi.date().iso().required(),
  notes:        Joi.string().max(500).optional().allow('', null),
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
 * Ghi nhận lệnh thật đã đặt trên sàn.
 * POST /api/portfolios/:portfolioId/real-orders
 */
export const createRealOrder = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const {
      symbol,
      exchange,
      side,
      quantity,
      filled_price,
      filled_date,
      notes,
    } = req.validatedBody;

    let result;

    if (side === 'BUY') {
      // Ghi nhận lệnh mua: tạo order + position với context='REAL'
      // NOTE: Cash deduction (CapitalService.deductForBuy) sẽ được thêm bởi Plan 06
      result = await RealOrderService.recordBuyOrder(portfolio.id, {
        symbol,
        exchange,
        quantity,
        filledPrice: filled_price,
        filledDate: filled_date,
        notes,
      });
    } else {
      // SELL side sẽ delegate sang RealPositionService.closePosition (qua realPosition.controller)
      // Plan 02 chỉ handle BUY side tại đây; SELL được handle qua endpoint riêng
      return res.status(400).json({
        success: false,
        message: "Để đóng vị thế, sử dụng endpoint POST /:portfolioId/real-positions/:positionId/close",
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        order: result.order,
        position: result.position,
      },
    });
  } catch (error) {
    if (error.statusCode === 422) {
      return res.status(422).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * Lấy lịch sử giao dịch thật của portfolio.
 * GET /api/portfolios/:portfolioId/real-orders
 */
export const getTransactionHistory = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);

    const result = await RealOrderService.getTransactionHistory(portfolio.id, { page, limit });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};
