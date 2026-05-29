/**
 * RealOrder Controller — HTTP handlers cho real order entry (nhập lệnh thật).
 *
 * POST   /api/portfolios/:portfolioId/real-orders        — Ghi nhận lệnh thật
 * GET    /api/portfolios/:portfolioId/real-orders        — Lịch sử giao dịch thật
 *
 * NOTE: CapitalService (cash deduction) sẽ được wire vào đây bởi Plan 06.
 * Controller này CHỈ làm: validate → ownership → service call → response.
 *
 * Phase 2 (VN market rules enforcement):
 * - Joi schema wire validateLotSize + isValidTick từ vnMarketRules (server authority).
 * - Handler body lookup reference_price từ DB (marketPriceService.getMarketData) → validatePriceInBand.
 * - KHÔNG accept `reference_price` từ client body (policy LOCKED — không trust client).
 * - KHÔNG dùng `isMarketOpen` để block order create (app là trade-logging, lệnh đã khớp trên broker).
 * - Graceful degrade: nếu DB không có reference_price → skip band check + log warning.
 */

import Joi from 'joi';
import Portfolio from '../../models/Portfolio.js';
import RealOrderService from '../../services/portfolio/realOrderService.js';
import {
  validateLotSize,
  isValidTick,
  getTickSize,
  validatePriceInBand,
  ERRORS,
} from '../../services/shared/vnMarketRules.js';
import { getMarketData } from '../../services/shared/marketPriceService.js';
// KHONG import CapitalService -- Plan 06 se wire cash deduction vao day

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Lookup reference_price (VND) từ DB/market data cho band validation.
 * F0 graceful degrade: return null nếu không có → caller SKIP band check.
 * @param {string} symbol
 * @returns {Promise<number|null>}
 */
async function lookupReferencePriceVnd(symbol) {
  try {
    const info = await getMarketData(symbol);
    const ref = Number(info?.reference);
    return Number.isFinite(ref) && ref > 0 ? ref : null;
  } catch (e) {
    console.warn('[order] reference_price lookup error for', symbol, '-', e?.message);
    return null;
  }
}

// ─── Validation Schema ────────────────────────────────────────────────────────

export const createRealOrderSchema = Joi.object({
  symbol:   Joi.string().max(20).uppercase().required(),
  exchange: Joi.string().valid('HOSE', 'HNX', 'UPCOM').required(),
  side:     Joi.string().valid('BUY', 'SELL').required(),

  // Lot size validate theo sàn sibling — pattern tested: helpers.error('any.invalid', {message})
  quantity: Joi.number().integer().positive().required()
    .custom((value, helpers) => {
      const exchange = helpers.state.ancestors[0]?.exchange || 'HOSE';
      const r = validateLotSize(value, exchange);
      if (r.ok) return value;
      return helpers.error('any.invalid', { message: r.reason });
    }, 'vn-lot-size')
    .messages({ 'any.invalid': '{#message}' }),

  // Tick validate theo sàn sibling
  filled_price: Joi.number().positive().required()
    .custom((value, helpers) => {
      const exchange = helpers.state.ancestors[0]?.exchange || 'HOSE';
      if (isValidTick(value, exchange)) return value;
      const tick = getTickSize(value, exchange);
      return helpers.error('any.invalid', {
        message: ERRORS.TICK_INVALID(tick, exchange),
      });
    }, 'vn-tick-size')
    .messages({ 'any.invalid': '{#message}' }),

  filled_date: Joi.date().iso().required(),
  notes:       Joi.string().max(500).optional().allow('', null),
  // D-05 (MAP-01): order_status ∈ {FILLED, PENDING}, default FILLED (backward-compat)
  order_status: Joi.string().valid('FILLED', 'PENDING').default('FILLED'),
  // Stop Loss / Take Profit (optional - VND)
  stop_loss:   Joi.number().positive().optional().allow(null),
  take_profit: Joi.number().positive().optional().allow(null),
  // NOTE: reference_price KHÔNG accept từ client (policy F0 — không trust client-provided).
  // Server lookup qua marketPriceService.getMarketData ở handler body.
});

/**
 * Schema cho POST /:portfolioId/orders/:orderId/confirm-fill.
 * User cung cap gia fill thuc te + ngay fill khi broker khop lenh PENDING.
 */
export const confirmFillSchema = Joi.object({
  actual_price: Joi.number().positive().required(),
  actual_date:  Joi.date().iso().required(),
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
      order_status,
      stop_loss,
      take_profit,
    } = req.validatedBody;

    // ─── Server-side band validation ────────────────────────────────────────
    // reference_price LUÔN lookup từ DB/market data, KHÔNG trust client body.
    // F0 graceful degrade: DB không có ref → SKIP band check + log warning.
    // Phase 3+ sẽ enforce stricter (fail-closed khi DB ref missing).
    const referenceVnd = await lookupReferencePriceVnd(symbol);
    if (referenceVnd && referenceVnd > 0) {
      const bandCheck = validatePriceInBand(filled_price, exchange, referenceVnd);
      if (!bandCheck.ok) {
        return res.status(400).json({
          success: false,
          message: bandCheck.reason,
        });
      }
    } else {
      console.warn('[order] No reference_price for', symbol, '— band check skipped');
    }

    let result;

    if (side === 'BUY') {
      // Ghi nhận lệnh mua: tạo order + position với context='REAL'
      // D-05 (MAP-01): order_status ∈ {FILLED, PENDING} — FILLED tru cash, PENDING lock
      result = await RealOrderService.recordBuyOrder(portfolio.id, {
        symbol,
        exchange,
        quantity,
        filledPrice: filled_price,
        filledDate: filled_date,
        notes,
        orderStatus: order_status,
        stopLoss: stop_loss || null,
        takeProfit: take_profit || null,
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

/**
 * Confirm PENDING BUY order fill on broker.
 * POST /api/portfolios/:portfolioId/orders/:orderId/confirm-fill
 *
 * D-05 (MAP-01) PENDING lifecycle:
 *   PENDING → RECORDED, CapitalService.confirmBuyFill (lock → spent), tạo Position OPEN.
 * T-03-04 mitigation: controller check ownership; service layer check order.portfolio_id matches.
 */
export const confirmOrderFill = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const { orderId } = req.params;
    const { actual_price, actual_date } = req.validatedBody;

    const result = await RealOrderService.confirmOrderFill(portfolio.id, orderId, {
      actualPrice: actual_price,
      actualDate: actual_date,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    // Service throws statusCode-tagged errors (404/403/409/422)
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

/**
 * Cancel PENDING BUY order.
 * DELETE /api/portfolios/:portfolioId/orders/:orderId
 *
 * D-05 (MAP-01): PENDING → CANCELLED, CapitalService.releaseBuyLock (giảm pending_buy_lock).
 * available_cash KHÔNG đổi (chưa trừ vì PENDING chưa fill).
 */
export const cancelOrder = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const { orderId } = req.params;

    const result = await RealOrderService.cancelBuyOrder(portfolio.id, orderId);

    return res.json({ success: true, data: result });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};
