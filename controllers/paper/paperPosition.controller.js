/**
 * Paper Position Controller — Quản lý positions cho PAPER TRADING.
 * Đơn vị tiền tệ: VND (đồng).
 *
 * RULE: Chỉ thao tác với positions có context = 'PAPER'.
 * Giá vào (entry) và giá đóng (closed) phải lấy từ thị trường thực (VPBS), không nhập tùy ý.
 * VPBS trả giá theo nghìn đồng → nhân 1000 để lưu và tính toán hoàn toàn bằng VND trong DB.
 */
const VPBS_PRICE_TO_VND = 1000;

/** Chuẩn hóa giá từ thị trường về VND: nếu giá >= 1000 coi là đã VND, ngược lại coi là điểm × 1000. */
function marketPriceToVnd(price) {
  if (price == null || !Number.isFinite(Number(price))) return null;
  const p = Number(price);
  return Math.round(p >= 1000 ? p : p * VPBS_PRICE_TO_VND);
}

import Position from '../../models/Position.js';
import Portfolio from '../../models/Portfolio.js';
import RiskCalculator from '../../services/riskCalculator.js';
import stopLossResolver from '../../services/stopLossResolver.js';
import { getMarketData } from '../../services/marketPriceService.js';
import { calculateFees } from '../../services/shared/feeEngine.js';
import ExecutionLog from '../../models/ExecutionLog.js';
import { isDerivativeSymbol } from '../../services/tickSizeEngine.js';
import Joi from 'joi';

const ENTRY_PRICE_TOLERANCE_PERCENT = Number(process.env.ENTRY_PRICE_TOLERANCE_PERCENT) || 2;

/** Loại bỏ cột legacy USD; thêm giá theo điểm (1 điểm = 1000 VND) để FE hiển thị đúng. */
function toVndPosition(pos) {
  if (!pos) return pos;
  const { profit_loss_usd, ...rest } = pos;
  const entry = Number(rest.entry_price);
  const stop = Number(rest.stop_loss);
  const tp = rest.take_profit != null ? Number(rest.take_profit) : null;
  return {
    ...rest,
    entry_price_points: Number.isFinite(entry) ? (entry >= 1000 ? entry / 1000 : entry) : null,
    stop_loss_points: Number.isFinite(stop) ? (stop >= 1000 ? stop / 1000 : stop) : null,
    take_profit_points: tp != null && Number.isFinite(tp) ? (tp >= 1000 ? tp / 1000 : tp) : null,
  };
}

/** Đảm bảo portfolio tồn tại và thuộc user; trả về portfolio hoặc gửi 404/403 và return. */
async function ensurePortfolioOwnership(req, res) {
  const portfolioId = req.params.portfolioId;
  const portfolio = await Portfolio.findById(portfolioId);
  if (!portfolio) {
    res.status(404).json({ success: false, message: 'Portfolio not found' });
    return null;
  }
  if (portfolio.user_id !== req.user.userId) {
    res.status(403).json({ success: false, message: 'Access denied' });
    return null;
  }
  return portfolio;
}

// Validation schemas – mặc định giá + khối lượng = từ thị trường (VPBS), không nhập tùy ý
export const createPositionSchema = Joi.object({
  symbol: Joi.string().max(50).required(),
  exchange: Joi.string().max(50).required(),
  side: Joi.string().valid('LONG', 'SHORT').optional().default('LONG'),
  order_type: Joi.string().valid('LO', 'ATO', 'ATC', 'MP', 'MOK', 'MAK').optional().default('LO'),
  use_market_entry: Joi.boolean().optional().default(true),
  entry_price: Joi.number().positive().when('use_market_entry', { is: false, then: Joi.required(), otherwise: Joi.optional() }),
  use_market_quantity: Joi.boolean().optional().default(true),
  quantity: Joi.number().positive().integer().when('use_market_quantity', { is: false, then: Joi.required(), otherwise: Joi.optional() }),
  stop_type: Joi.string().valid('FIXED', 'PERCENT', 'MAX_LOSS', 'SUPPORT_RESISTANCE', 'TRAILING', 'ATR', 'MA').default('FIXED'),
  stop_params: Joi.object().optional().default({}),
  stop_price: Joi.number().optional(),
  take_profit_type: Joi.string().valid('FIXED', 'PERCENT', 'R_RATIO').optional(),
  take_profit_params: Joi.object().optional(),
  take_profit_price: Joi.number().optional(),
  signal_source_id: Joi.string().uuid().optional(),
  notes: Joi.string().optional()
});

export const calculatePositionSchema = Joi.object({
  entry_price: Joi.number().positive().required(),
  quantity: Joi.number().positive().required(),
  stop_type: Joi.string().valid('FIXED', 'PERCENT', 'MAX_LOSS', 'SUPPORT_RESISTANCE', 'TRAILING', 'ATR', 'MA').default('FIXED'),
  stop_params: Joi.object().optional().default({}),
  stop_price: Joi.number().optional(),
  take_profit_type: Joi.string().valid('FIXED', 'PERCENT', 'R_RATIO').optional(),
  take_profit_params: Joi.object().optional(),
  take_profit_price: Joi.number().optional()
});

export const updatePositionSchema = Joi.object({
  trailing_current_stop: Joi.number().positive().optional(),
  stop_loss: Joi.number().positive().optional(),       // Cho phép AI điều chỉnh SL trực tiếp
  take_profit: Joi.number().positive().optional(),     // Cho phép AI điều chỉnh TP trực tiếp
  notes: Joi.string().max(500).optional()
});

export const closePositionSchema = Joi.object({
  reason: Joi.string().valid('CLOSED_TP', 'CLOSED_SL', 'CLOSED_MANUAL').required(),
  use_market_price: Joi.boolean().optional().default(true),
  closed_price: Joi.number().positive().when('use_market_price', { is: false, then: Joi.required(), otherwise: Joi.optional() })
});

/**
 * Quy ước đơn vị khi tạo/cập nhật position:
 * - entry_price, stop_price, take_profit_price: VND (đồng). FE gửi giá điểm × 1000 (1 điểm = 1.000 ₫).
 * - stop_params.max_loss_vnd: VND.
 * - DB lưu entry_price, stop_loss, take_profit hoàn toàn bằng VND.
 */

/** GET /portfolios/:portfolioId/positions */
export const list = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const status = req.query.status || null;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

    // Neu co query param page thi dung pagination, nguoc lai lay tat ca (backward compat)
    const usePagination = req.query.page !== undefined || req.query.limit !== undefined;

    let rows, total, totalPages;

    if (usePagination) {
      const paginated = await Position.findByPortfolioPaginated(req.params.portfolioId, { page, limit, status });
      rows = paginated.data;
      total = paginated.total;
      totalPages = paginated.totalPages;
    } else {
      rows = await Position.findByPortfolioId(req.params.portfolioId, { status });
      total = rows.length;
      totalPages = 1;
    }

    // Enrich OPEN positions with real-time current_price from market API
    const enriched = await Promise.all(rows.map(async (pos) => {
      const base = toVndPosition(pos);
      if (pos.status === 'OPEN') {
        try {
          const mkt = await getMarketData(pos.symbol);
          if (mkt?.price != null) {
            base.current_price = marketPriceToVnd(mkt.price);
          }
        } catch (_) {
          // Giữ current_price = null nếu không lấy được giá thị trường
        }
      }
      return base;
    }));

    res.json({
      success: true,
      data: enriched,
      count: enriched.length,
      pagination: { page, limit, total, totalPages }
    });
  } catch (error) {
    next(error);
  }
};

/** GET /portfolios/:portfolioId/positions/:id */
export const getById = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const position = await Position.findById(req.params.id);
    if (!position || position.portfolio_id !== req.params.portfolioId) {
      return res.status(404).json({ success: false, message: 'Position not found' });
    }

    const riskReward = position.take_profit && position.stop_loss
      ? RiskCalculator.calculateRiskRewardRatio(
          parseFloat(position.entry_price),
          parseFloat(position.stop_loss),
          parseFloat(position.take_profit)
        )
      : null;

    res.json({
      success: true,
      data: { ...toVndPosition(position), risk_reward: riskReward }
    });
  } catch (error) {
    next(error);
  }
};

/** POST /portfolios/:portfolioId/positions */
/**
 * @deprecated Sử dụng POST /api/portfolios/:id/orders thay thế.
 * Endpoint này tạo position trực tiếp mà không qua order flow (không trừ vốn, không tính phí).
 */
export const create = async (req, res, next) => {
  try {
    console.warn('[DEPRECATED] paperPosition.create called — use order flow instead');
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const body = req.validatedBody || req.body;
    const {
      symbol,
      exchange,
      side: bodySide,
      use_market_entry,
      entry_price: bodyEntryPrice,
      use_market_quantity,
      quantity: bodyQuantity,
      stop_type,
      stop_params,
      stop_price,
      take_profit_type,
      take_profit_params,
      take_profit_price,
      signal_source_id,
      notes
    } = body;

    const marketData = await getMarketData(symbol);
    let entry_price;
    let quantity;

    if (use_market_entry !== false) {
      if (marketData.price == null || marketData.price <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Giá vào phải là giá thị trường. Không lấy được giá từ VPBS, vui lòng thử lại.',
          market_error: marketData.error
        });
      }
      entry_price = marketPriceToVnd(marketData.price);
    } else {
      if (bodyEntryPrice == null) {
        return res.status(400).json({ success: false, message: 'Cần entry_price khi use_market_entry: false.' });
      }
      const marketPriceVnd = marketData.price != null && marketData.price > 0 ? marketPriceToVnd(marketData.price) : null;
      if (marketPriceVnd != null) {
        const diffPercent = Math.abs(bodyEntryPrice - marketPriceVnd) / marketPriceVnd * 100;
        if (diffPercent > ENTRY_PRICE_TOLERANCE_PERCENT) {
          return res.status(400).json({
            success: false,
            message: `Giá vào phải gần giá thị trường. VPBS: ${marketPriceVnd.toLocaleString('vi-VN')}, bạn nhập: ${bodyEntryPrice.toLocaleString('vi-VN')} (chênh ${diffPercent.toFixed(1)}%). Cho phép tối đa ${ENTRY_PRICE_TOLERANCE_PERCENT}% hoặc bỏ use_market_entry: false để dùng giá thị trường.`,
            market_price: marketPriceVnd
          });
        }
      }
      entry_price = bodyEntryPrice;
    }

    if (use_market_quantity !== false) {
      if (marketData.quantity == null || marketData.quantity <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Khối lượng phải lấy từ thị trường. Không lấy được khối lượng từ VPBS, vui lòng thử lại hoặc gửi use_market_quantity: false và quantity.',
          market_error: marketData.error
        });
      }
      quantity = marketData.quantity;
    } else {
      if (bodyQuantity == null) {
        return res.status(400).json({ success: false, message: 'Cần quantity khi use_market_quantity: false.' });
      }
      quantity = bodyQuantity;
    }

    const side = (bodySide === 'SHORT') ? 'SHORT' : 'LONG';

    // SHORT chỉ cho phái sinh
    if (side === 'SHORT' && !isDerivativeSymbol(symbol)) {
      return res.status(400).json({
        success: false,
        error: 'SHORT_NOT_ALLOWED',
        message: `Bán khống không được phép với cổ phiếu cơ sở (${symbol}/${exchange}). SHORT chỉ áp dụng cho hợp đồng phái sinh: VN30F, VN100F.`,
      });
    }

    // 1) Resolve stop_loss (ATR/MA có thể nhận atr_value, ma_value trong stop_params hoặc từ FE)
    const fixedStop = stop_type === 'FIXED' ? (stop_price ?? stop_params?.stop_price ?? stop_params?.level_price) : null;
    const resolverOptions = {
      atrValue: stop_params?.atr_value,
      maValue: stop_params?.ma_value
    };
    const { stopLoss, error: stopError } = stopLossResolver.resolveStopLoss(
      stop_type,
      stop_params || {},
      entry_price,
      quantity,
      side,
      fixedStop,
      resolverOptions
    );
    if (stopError || stopLoss == null) {
      return res.status(400).json({
        success: false,
        message: stopError || 'Invalid stop loss'
      });
    }

    // 2) Resolve take_profit (optional)
    let takeProfit = null;
    if (take_profit_type || take_profit_price != null) {
      const tpType = take_profit_type || 'FIXED';
      const { takeProfit: tp, error: tpError } = stopLossResolver.resolveTakeProfit(
        tpType,
        take_profit_params || {},
        entry_price,
        stopLoss,
        side,
        take_profit_price
      );
      if (tpError) {
        return res.status(400).json({ success: false, message: tpError });
      }
      takeProfit = tp;
    }

    // 3) Risk (VND)
    const { riskVND } = RiskCalculator.calculatePositionRisk(entry_price, stopLoss, quantity);

    // 4) Validate against portfolio max risk (VND)
    const validation = await RiskCalculator.validatePositionAgainstRisk(portfolio.id, riskVND);
    if (!validation.allowed) {
      return res.status(400).json({
        success: false,
        message: validation.reason,
        details: validation.details
      });
    }

    // 5) Insert với context = 'PAPER' (TRAILING: lưu thêm trailing_current_stop = stopLoss ban đầu)
    const trailingCurrentStop = stop_type === 'TRAILING' ? stopLoss : null;
    const position = await Position.create({
      portfolioId: portfolio.id,
      symbol,
      exchange,
      entryPrice: entry_price,
      stopLoss,
      takeProfit,
      quantity,
      riskValueVnd: riskVND,
      side,
      stopType: stop_type,
      stopParams: stop_params || null,
      takeProfitType: take_profit_type || null,
      takeProfitParams: take_profit_params || null,
      trailingCurrentStop,
      signalSourceId: signal_source_id || null,
      notes: notes || null,
      context: 'PAPER',  // Context guard: paper positions luôn có context = 'PAPER'
    });

    const riskReward = takeProfit
      ? RiskCalculator.calculateRiskRewardRatio(entry_price, stopLoss, takeProfit)
      : null;

    res.status(201).json({
      success: true,
      message: 'Position created',
      data: {
        ...toVndPosition(position),
        risk_reward: riskReward,
        entry_price_from_market: use_market_entry !== false,
        market_price_used: use_market_entry !== false ? entry_price : undefined,
        quantity_from_market: use_market_quantity !== false,
        market_quantity_used: use_market_quantity !== false ? quantity : undefined
      }
    });
  } catch (error) {
    next(error);
  }
};

/** PATCH /portfolios/:portfolioId/positions/:id */
export const update = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const position = await Position.findById(req.params.id);
    if (!position || position.portfolio_id !== req.params.portfolioId) {
      return res.status(404).json({ success: false, message: 'Position not found' });
    }
    if (position.status !== 'OPEN') {
      return res.status(400).json({ success: false, message: 'Only OPEN positions can be updated' });
    }

    const body = req.validatedBody || req.body;
    const { trailing_current_stop, stop_loss, take_profit, notes } = body;
    const updatePayload = { trailingCurrentStop: trailing_current_stop };
    if (stop_loss != null) updatePayload.stopLoss = stop_loss;
    if (take_profit != null) updatePayload.takeProfit = take_profit;
    if (notes != null) updatePayload.notes = notes;
    const updated = await Position.update(position.id, updatePayload);

    res.json({
      success: true,
      data: toVndPosition(updated)
    });
  } catch (error) {
    next(error);
  }
};

/** POST /portfolios/:portfolioId/positions/:id/close */
export const close = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const position = await Position.findById(req.params.id);
    if (!position || position.portfolio_id !== req.params.portfolioId) {
      return res.status(404).json({ success: false, message: 'Position not found' });
    }
    if (position.status !== 'OPEN') {
      return res.status(400).json({ success: false, message: 'Position is already closed' });
    }

    const body = req.validatedBody || req.body;
    const { reason, use_market_price = true, closed_price: bodyClosedPrice } = body;

    let closed_price = bodyClosedPrice;
    if (use_market_price !== false) {
      const marketData = await getMarketData(position.symbol);
      if (marketData.price != null && marketData.price > 0) {
        closed_price = marketPriceToVnd(marketData.price);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Không lấy được giá bán thị trường từ VPBS. Vui lòng thử lại hoặc gửi use_market_price: false và closed_price.',
          market_error: marketData.error
        });
      }
    } else if (bodyClosedPrice == null) {
      return res.status(400).json({ success: false, message: 'Cần closed_price khi use_market_price: false.' });
    }

    const entryVnd  = parseFloat(position.entry_price);
    const qty       = parseFloat(position.quantity);
    // buy_fee_vnd đã được tính khi tạo position; dùng lại để hiển thị, không tính lại
    const buyFeeVnd = parseFloat(position.buy_fee_vnd) || 0;

    // Tính phí bán + P&L đầy đủ (calculateFees tự tính buy_fee từ portfolio config)
    const fees = calculateFees(entryVnd, closed_price, qty, portfolio);

    const updated = await Position.update(position.id, {
      status:          reason,
      closedAt:        new Date(),
      closedPrice:     closed_price,
      profitLossVnd:   fees.net_pnl_vnd,
      grossPnlVnd:     fees.gross_pnl_vnd,
      sellFeeVnd:      fees.sell_fee_vnd,
      sellTaxVnd:      fees.sell_tax_vnd,
    });

    await ExecutionLog.write({
      entityType:  'POSITION',
      entityId:    position.id,
      portfolioId: portfolio.id,
      eventType:   'POSITION_CLOSED_MANUAL',
      fillPrice:   closed_price,
      metadata:    {
        reason,
        gross_pnl_vnd: fees.gross_pnl_vnd,
        net_pnl_vnd:   fees.net_pnl_vnd,
        sell_fee_vnd:  fees.sell_fee_vnd,
        sell_tax_vnd:  fees.sell_tax_vnd,
        total_fee_vnd: fees.total_fee_vnd,
        context:       'PAPER',
      },
    });

    res.json({
      success: true,
      message: 'Position closed',
      data: {
        ...toVndPosition(updated),
        fees: {
          buy_fee_vnd:   buyFeeVnd,
          sell_fee_vnd:  fees.sell_fee_vnd,
          sell_tax_vnd:  fees.sell_tax_vnd,
          total_fee_vnd: fees.total_fee_vnd,
          gross_pnl_vnd: fees.gross_pnl_vnd,
          net_pnl_vnd:   fees.net_pnl_vnd,
        },
      },
      market_closed_price_used: use_market_price ? closed_price : undefined
    });
  } catch (error) {
    next(error);
  }
};

/** POST /portfolios/:portfolioId/positions/calculate — preview SL/TP/risk/R:R */
export const calculate = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const body = req.validatedBody || req.body;
    const {
      entry_price,
      quantity,
      side: bodySideCalc,
      stop_type,
      stop_params,
      stop_price,
      take_profit_type,
      take_profit_params,
      take_profit_price
    } = body;

    const side = (bodySideCalc === 'SHORT') ? 'SHORT' : 'LONG';
    const fixedStop = stop_type === 'FIXED' ? (stop_price ?? stop_params?.stop_price ?? stop_params?.level_price) : null;
    const resolverOptions = { atrValue: stop_params?.atr_value, maValue: stop_params?.ma_value };

    const { stopLoss, error: stopError } = stopLossResolver.resolveStopLoss(
      stop_type || 'FIXED',
      stop_params || {},
      entry_price,
      quantity,
      side,
      fixedStop,
      resolverOptions
    );
    if (stopError || stopLoss == null) {
      return res.status(400).json({
        success: false,
        message: stopError || 'Invalid stop loss'
      });
    }

    let takeProfit = null;
    if (take_profit_type || take_profit_price != null) {
      const tpType = take_profit_type || 'FIXED';
      const { takeProfit: tp } = stopLossResolver.resolveTakeProfit(
        tpType,
        take_profit_params || {},
        entry_price,
        stopLoss,
        side,
        take_profit_price
      );
      takeProfit = tp;
    }

    const { riskVND } = RiskCalculator.calculatePositionRisk(entry_price, stopLoss, quantity);

    const riskReward = takeProfit
      ? RiskCalculator.calculateRiskRewardRatio(entry_price, stopLoss, takeProfit)
      : null;

    const validation = await RiskCalculator.validatePositionAgainstRisk(portfolio.id, riskVND);

    res.json({
      success: true,
      data: {
        stop_loss: stopLoss,
        take_profit: takeProfit,
        risk_value_vnd: riskVND,
        risk_reward: riskReward,
        validation: validation
      }
    });
  } catch (error) {
    next(error);
  }
};

// ─── Re-export aliases ────────────────────────────────────────────────────────
// Backward compat: position.routes.js dùng positionController.list, .getById, etc.
export { list as getByPortfolio };
export { close as closePosition };
export { update as updateStopLoss };
