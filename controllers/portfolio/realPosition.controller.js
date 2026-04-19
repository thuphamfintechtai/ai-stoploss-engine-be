/**
 * RealPosition Controller — HTTP handlers cho position close (đóng vị thế thủ công).
 *
 * GET    /api/portfolios/:portfolioId/real-positions                       — Danh sách vị thế đang mở
 * POST   /api/portfolios/:portfolioId/real-positions/:positionId/close     — Đóng vị thế
 *
 * NOTE: CapitalService (pending settlement) sẽ được wire vào đây bởi Plan 06.
 * Controller này CHỈ làm: validate → ownership → service call → response.
 *
 * Phase 2 (VN market rules enforcement):
 * - Schema minimal (sell_price, sell_date, notes) — KHÔNG accept client exchange/reference_price.
 * - Handler body lookup position (DB) → validate tick + band theo position.exchange + DB ref.
 * - Graceful degrade: DB không có reference_price → skip band check + log warning.
 */

import Joi from 'joi';
import Portfolio from '../../models/Portfolio.js';
import Position from '../../models/Position.js';
import RealPositionService from '../../services/portfolio/realPositionService.js';
import {
  isValidTick,
  getTickSize,
  validatePriceInBand,
  ERRORS,
} from '../../services/shared/vnMarketRules.js';
import { getMarketData } from '../../services/shared/marketPriceService.js';
// KHONG import CapitalService -- Plan 06 se wire pending settlement vao day

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
    console.warn('[position] reference_price lookup error for', symbol, '-', e?.message);
    return null;
  }
}

// ─── Validation Schema ────────────────────────────────────────────────────────

export const closePositionSchema = Joi.object({
  sell_price: Joi.number().positive().required(),
  sell_date:  Joi.date().iso().required(),
  notes:      Joi.string().max(500).optional().allow('', null),
  // NOTE: exchange + reference_price KHÔNG accept từ client — server lookup từ position record + DB.
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

    // ─── Server-side position lookup (authority cho exchange + symbol) ─────
    const position = await Position.findById(positionId);
    if (!position) {
      return res.status(404).json({
        success: false,
        message: 'Position không tồn tại',
      });
    }
    if (position.portfolio_id !== portfolio.id) {
      return res.status(403).json({
        success: false,
        message: 'Không có quyền truy cập position này',
      });
    }

    // ─── Server-side tick validation (dùng position.exchange — không trust client) ──
    if (!isValidTick(sell_price, position.exchange)) {
      const tick = getTickSize(sell_price, position.exchange);
      return res.status(400).json({
        success: false,
        message: ERRORS.TICK_INVALID(tick, position.exchange),
      });
    }

    // ─── Server-side band validation (reference_price lookup từ DB) ────────
    // F0 graceful degrade: DB không có ref → SKIP band check + log warning.
    const referenceVnd = await lookupReferencePriceVnd(position.symbol);
    if (referenceVnd && referenceVnd > 0) {
      const bandCheck = validatePriceInBand(sell_price, position.exchange, referenceVnd);
      if (!bandCheck.ok) {
        return res.status(400).json({
          success: false,
          message: bandCheck.reason,
        });
      }
    } else {
      console.warn('[position] No reference_price for', position.symbol, '— band check skipped');
    }

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
