/**
 * Paper Order Controller — Quản lý lifecycle lệnh đặt cho PAPER TRADING.
 *
 * POST   /api/portfolios/:portfolioId/orders        — Đặt lệnh (paper)
 * GET    /api/portfolios/:portfolioId/orders        — Danh sách lệnh (paper)
 * DELETE /api/portfolios/:portfolioId/orders/:id   — Hủy lệnh (paper)
 *
 * RULE: position chỉ được tạo sau khi order FILLED (xử lý bởi paper fillEngine).
 * RULE: SHORT chỉ cho phép với derivative symbols (VN30F, VN100F...).
 * RULE: Tất cả orders tạo bởi controller này đều có context = 'PAPER'.
 */

import Joi from 'joi';
import Order from '../../models/Order.js';
import Portfolio from '../../models/Portfolio.js';
import ExecutionLog from '../../models/ExecutionLog.js';
import RiskCalculator from '../../services/riskCalculator.js';
import stopLossResolver from '../../services/stopLossResolver.js';
import { getMarketData } from '../../services/marketPriceService.js';
import { snapToTickSize, isValidTickSize, validatePriceInBand, isDerivativeSymbol } from '../../services/shared/tickSizeEngine.js';
import { fillOrderInstant, fillOrderRealistic } from '../../services/paper/fillEngine.js';
import PaperCapitalService from '../../services/paper/paperCapitalService.js';
import { query } from '../../config/database.js';
import { calculateBuyFee } from '../../services/shared/feeEngine.js';

const VPBS_PRICE_TO_VND = 1000;

function marketPriceToVnd(price) {
  if (price == null || !Number.isFinite(Number(price))) return null;
  const p = Number(price);
  return Math.round(p >= 1000 ? p : p * VPBS_PRICE_TO_VND);
}

/** Tính expired_at theo order type và giờ hiện tại */
function getOrderExpiry(orderType) {
  const now = new Date();
  const tz = 'Asia/Ho_Chi_Minh';
  const dateStr = now.toLocaleDateString('vi-VN', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const [day, month, year] = dateStr.split('/');

  if (orderType === 'ATO') {
    // ATO hết hạn lúc 09:14:59
    return new Date(`${year}-${month}-${day}T09:14:59+07:00`);
  }
  if (orderType === 'ATC') {
    // ATC hết hạn lúc 15:00:00
    return new Date(`${year}-${month}-${day}T15:00:00+07:00`);
  }
  // LO/MP hết hạn cuối phiên chiều 15:00
  return new Date(`${year}-${month}-${day}T15:00:00+07:00`);
}

// ─── Validation Schema ────────────────────────────────────────────────────────

export const createOrderSchema = Joi.object({
  symbol:          Joi.string().max(20).uppercase().required(),
  exchange:        Joi.string().valid('HOSE', 'HNX', 'UPCOM', 'DERIVATIVE').required(),
  side:            Joi.string().valid('BUY', 'SELL').required(),
  order_type:      Joi.string().valid('LO', 'ATO', 'ATC', 'MP').default('LO'),
  limit_price:     Joi.number().positive().when('order_type', { is: 'LO', then: Joi.required(), otherwise: Joi.optional() }),
  quantity:        Joi.number().integer().positive().required(),
  simulation_mode: Joi.string().valid('INSTANT', 'REALISTIC').default('INSTANT'),
  // SL/TP gắn vào order (optional, áp dụng khi filled)
  stop_price:      Joi.number().positive().optional(),
  stop_type:       Joi.string().valid('FIXED','PERCENT','MAX_LOSS','TRAILING','ATR','MA').optional(),
  stop_params:     Joi.object().optional(),
  take_profit_price: Joi.number().positive().optional(),
  take_profit_type:  Joi.string().valid('FIXED','PERCENT','R_RATIO').optional(),
  notes:           Joi.string().max(500).optional(),
});

/** Schema cho PATCH /orders/:id — chỉ cho phép sửa limit_price và quantity (per D-09) */
export const editOrderSchema = Joi.object({
  limit_price: Joi.number().positive().optional(),
  quantity:    Joi.number().integer().positive().min(100).optional(),
}).min(1); // ít nhất 1 field phải có

// ─── Helper: đảm bảo portfolio thuộc user ────────────────────────────────────

async function ensurePortfolioOwnership(req, res) {
  const portfolioId = req.params.portfolioId;
  const portfolio   = await Portfolio.findById(portfolioId);
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

// ─── POST /api/portfolios/:portfolioId/orders ─────────────────────────────────

export const createOrder = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const body = req.validatedBody || req.body;
    const {
      symbol, exchange, side, order_type,
      limit_price, quantity, simulation_mode,
      stop_price, stop_type, stop_params,
      take_profit_price, take_profit_type,
      notes,
    } = body;

    const warnings = [];

    // ── 1. SHORT validation ──────────────────────────────────────────────────
    if (side === 'SELL' && !(await isExistingLongToSell(portfolio.id, symbol))) {
      // "SELL" để đóng LONG position là OK (xử lý ở position close flow)
      // "SELL" như short new position chỉ cho derivative
    }
    // Short selling (mở vị thế SHORT mới) chỉ cho phái sinh
    const isNewShortPosition = side === 'SELL'; // simplified check
    if (isNewShortPosition && !isDerivativeSymbol(symbol)) {
      return res.status(400).json({
        success: false,
        error: 'SHORT_NOT_ALLOWED',
        message: `Bán khống không được phép với cổ phiếu cơ sở (${symbol}/${exchange}). SHORT chỉ áp dụng cho hợp đồng phái sinh: VN30F, VN100F.`,
      });
    }

    // ── 2. Tick size validation & auto-correct ───────────────────────────────
    let effectiveLimitPrice = limit_price ?? null;
    if (order_type === 'LO' && effectiveLimitPrice != null) {
      const snapped = snapToTickSize(effectiveLimitPrice, exchange);
      if (snapped !== effectiveLimitPrice) {
        const tick = snapped - snapToTickSize(snapped - 1, exchange);
        warnings.push(`Giá đã điều chỉnh từ ${effectiveLimitPrice.toLocaleString('vi-VN')} → ${snapped.toLocaleString('vi-VN')} (bước giá ${tick}đ)`);
        effectiveLimitPrice = snapped;
      }
    }

    // ── 3. Price band check (warning only, không block) ──────────────────────
    if (order_type === 'LO' && effectiveLimitPrice != null) {
      try {
        const mkt = await getMarketData(symbol);
        const refVnd = mkt?.reference != null ? marketPriceToVnd(mkt.reference) : null;
        if (refVnd) {
          const bandCheck = validatePriceInBand(effectiveLimitPrice, refVnd, exchange);
          if (!bandCheck.valid) {
            warnings.push(bandCheck.warning);
          }
        }
      } catch (_) { /* không block nếu lấy giá TC thất bại */ }
    }

    // ── 4. SL validation: stop phải ngược chiều entry ────────────────────────
    if (stop_price != null && effectiveLimitPrice != null) {
      if (side === 'BUY'  && stop_price >= effectiveLimitPrice) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_STOP_LOSS',
          message: `Stop Loss (${stop_price.toLocaleString('vi-VN')}đ) phải thấp hơn giá vào (${effectiveLimitPrice.toLocaleString('vi-VN')}đ) cho lệnh MUA.`,
        });
      }
      if (side === 'SELL' && stop_price <= effectiveLimitPrice) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_STOP_LOSS',
          message: `Stop Loss (${stop_price.toLocaleString('vi-VN')}đ) phải cao hơn giá vào (${effectiveLimitPrice.toLocaleString('vi-VN')}đ) cho lệnh BÁN.`,
        });
      }
    }

    // ── 5. Resolve SL/TP giá trị cụ thể ─────────────────────────────────────
    let resolvedSL = null;
    let resolvedTP = null;

    if (stop_price != null || (stop_type && stop_type !== 'FIXED')) {
      // Cần giá vào để resolve percentage/ATR-based SL
      const entryForResolve = effectiveLimitPrice ?? (await getMarketData(symbol).then(m => marketPriceToVnd(m?.price)).catch(() => null));
      if (entryForResolve) {
        const fixedStop = stop_type === 'FIXED' || !stop_type ? stop_price : null;
        const { stopLoss, error: slErr } = stopLossResolver.resolveStopLoss(
          stop_type || 'FIXED', stop_params || {}, entryForResolve,
          quantity, side === 'BUY' ? 'LONG' : 'SHORT', fixedStop
        );
        if (slErr) {
          return res.status(400).json({ success: false, message: slErr });
        }
        resolvedSL = stopLoss;
      }
    }

    if (take_profit_price != null || take_profit_type) {
      const entryForTP = effectiveLimitPrice ?? (await getMarketData(symbol).then(m => marketPriceToVnd(m?.price)).catch(() => null));
      if (entryForTP && resolvedSL) {
        const { takeProfit, error: tpErr } = stopLossResolver.resolveTakeProfit(
          take_profit_type || 'FIXED', {}, entryForTP,
          resolvedSL, side === 'BUY' ? 'LONG' : 'SHORT', take_profit_price
        );
        if (!tpErr) resolvedTP = takeProfit;
      }
    }

    // ── 6. Risk check (chỉ cho BUY với SL đã resolve) ────────────────────────
    if (side === 'BUY' && resolvedSL && effectiveLimitPrice) {
      const { riskVND } = RiskCalculator.calculatePositionRisk(effectiveLimitPrice, resolvedSL, quantity);
      const validation  = await RiskCalculator.validatePositionAgainstRisk(portfolio.id, riskVND);
      if (!validation.allowed) {
        return res.status(422).json({
          success: false,
          error: 'RISK_EXCEEDED',
          message: validation.reason,
          details: validation.details,
        });
      }
    }

    // ── 7. Tạo order record với context = 'PAPER' ─────────────────────────────
    const expiredAt = getOrderExpiry(order_type);
    const order = await Order.create({
      portfolioId: portfolio.id,
      symbol, exchange, side, orderType: order_type,
      limitPrice:    effectiveLimitPrice,
      quantity,
      simulationMode: simulation_mode,
      stopLossVnd:   resolvedSL,
      stopType:      stop_type || (stop_price != null ? 'FIXED' : null),
      stopParams:    stop_params || null,
      takeProfitVnd: resolvedTP,
      takeProfitType: take_profit_type || (take_profit_price != null ? 'FIXED' : null),
      expiredAt,
      notes: notes || null,
      context: 'PAPER',  // Context guard: paper orders luôn có context = 'PAPER'
    });

    // Ghi audit log
    await ExecutionLog.write({
      entityType:  'ORDER',
      entityId:    order.id,
      portfolioId: portfolio.id,
      eventType:   'ORDER_CREATED',
      metadata:    { side, order_type, quantity, limit_price: effectiveLimitPrice, warnings, context: 'PAPER' },
    });

    // ── 8. Immediate fill: routing theo simulation_mode ─────────────────────────
    let filledPosition = null;
    let fillMessage = 'Lệnh đã đặt, đang chờ khớp';
    let fillSlippage = null;

    if (simulation_mode === 'REALISTIC') {
      if (order_type === 'MP') {
        // REALISTIC MP: fill ngay với slippage qua PaperMatchingEngine
        const fillResult = await fillOrderRealistic(order, portfolio);
        if (fillResult?.position) {
          filledPosition = fillResult.position;
          fillSlippage = fillResult.slippage ?? 0;
          fillMessage = fillSlippage > 0
            ? `Lệnh đã khớp với slippage ${fillSlippage.toLocaleString('vi-VN')}đ (REALISTIC)`
            : 'Lệnh đã khớp (REALISTIC)';
        }
      } else {
        // REALISTIC LO/ATO/ATC: chỉ tạo PENDING, worker sẽ fill sau
        fillMessage = 'Lệnh đã đặt, chờ khớp (REALISTIC)';
      }
    } else {
      // INSTANT mode (backward compatible): MP và LO/ATO/ATC fill ngay nếu điều kiện đúng
      if (order_type === 'MP' || simulation_mode === 'INSTANT') {
        const fillResult = await fillOrderInstant(order, portfolio);
        if (fillResult?.position) {
          filledPosition = fillResult.position;
          fillMessage = 'Lệnh đã khớp và position được tạo';
        }
      }
    }

    res.status(201).json({
      success: true,
      message: fillMessage,
      data: {
        order,
        position: filledPosition,
        ...(fillSlippage != null && { slippage: fillSlippage }),
      },
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/portfolios/:portfolioId/orders ──────────────────────────────────

export const listOrders = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const status = req.query.status || null; // 'PENDING', 'FILLED', v.v. hoặc null = tất cả
    const limit  = Math.min(100, parseInt(req.query.limit, 10) || 50);

    const orders = await Order.findByPortfolio(portfolio.id, { status: status ? status.split(',') : null, limit });

    res.json({
      success: true,
      data: orders,
      count: orders.length,
    });
  } catch (error) {
    next(error);
  }
};

// ─── DELETE /api/portfolios/:portfolioId/orders/:id ───────────────────────────

export const cancelOrder = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const order = await Order.findById(req.params.id);
    if (!order || order.portfolio_id !== portfolio.id) {
      return res.status(404).json({ success: false, message: 'Lệnh không tồn tại' });
    }

    if (!['PENDING', 'PARTIALLY_FILLED'].includes(order.status)) {
      return res.status(409).json({
        success: false,
        error: 'CANNOT_CANCEL',
        message: `Không thể hủy lệnh đang ở trạng thái ${order.status}. Chỉ hủy được lệnh PENDING hoặc PARTIALLY_FILLED.`,
      });
    }

    const cancelled = await Order.cancel(order.id);
    if (!cancelled) {
      // Race condition: đã bị fill/cancel bởi process khác
      return res.status(409).json({
        success: false,
        error: 'CANCEL_RACE_CONDITION',
        message: 'Lệnh đã được xử lý bởi hệ thống. Vui lòng refresh.',
      });
    }

    await ExecutionLog.write({
      entityType:  'ORDER',
      entityId:    order.id,
      portfolioId: portfolio.id,
      eventType:   'ORDER_CANCELLED',
      metadata:    { filled_quantity: order.filled_quantity, cancelled_by: 'USER', context: 'PAPER' },
    });

    // ── Refund virtual balance khi cancel REALISTIC BUY order ────────────────
    // Chi refund neu: side=BUY (da deduct tien khi dat) va mode=REALISTIC (INSTANT fill ngay, khong deduct truoc)
    if (order.side === 'BUY' && order.simulation_mode === 'REALISTIC') {
      const limitPrice = Number(order.limit_price) || 0;
      const qty = Number(order.quantity) || 0;
      const buyFee = calculateBuyFee(limitPrice, qty);
      const refundAmount = limitPrice * qty + buyFee;
      if (refundAmount > 0) {
        await PaperCapitalService.refundForCancel(portfolio.id, refundAmount);
      }
    }

    res.json({
      success: true,
      message: 'Lệnh đã hủy thành công',
      data: cancelled,
    });
  } catch (error) {
    next(error);
  }
};

// ─── PATCH /api/portfolios/:portfolioId/orders/:id ────────────────────────────

export const editOrder = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const body = req.validatedBody || req.body;
    const { limit_price, quantity } = body;

    // Lấy order hiện tại
    const order = await Order.findById(req.params.id);
    if (!order || order.portfolio_id !== portfolio.id) {
      return res.status(404).json({ success: false, message: 'Lệnh không tồn tại' });
    }

    // Chỉ edit được lệnh PENDING
    if (order.status !== 'PENDING') {
      return res.status(409).json({
        success: false,
        error: 'ORDER_NOT_PENDING',
        message: `Không thể sửa lệnh đang ở trạng thái ${order.status}. Chỉ sửa được lệnh PENDING.`,
      });
    }

    // Chỉ edit paper orders
    if (order.context !== 'PAPER') {
      return res.status(400).json({
        success: false,
        error: 'NOT_PAPER_ORDER',
        message: 'Chỉ có thể sửa lệnh paper trading.',
      });
    }

    const warnings = [];
    let effectiveLimitPrice = order.limit_price != null ? Number(order.limit_price) : null;
    let effectiveQuantity   = Number(order.quantity);

    // ── Xử lý limit_price mới ────────────────────────────────────────────────
    if (limit_price != null) {
      const snapped = snapToTickSize(limit_price, order.exchange);
      if (snapped !== limit_price) {
        warnings.push(`Giá đã điều chỉnh từ ${limit_price.toLocaleString('vi-VN')} → ${snapped.toLocaleString('vi-VN')}`);
      }
      effectiveLimitPrice = snapped;

      // Price band check (warning only)
      try {
        const mkt = await getMarketData(order.symbol);
        const refVnd = mkt?.reference != null ? marketPriceToVnd(mkt.reference) : null;
        if (refVnd) {
          const bandCheck = validatePriceInBand(effectiveLimitPrice, refVnd, order.exchange);
          if (!bandCheck.valid) warnings.push(bandCheck.warning);
        }
      } catch (_) { /* không block nếu lấy giá TC thất bại */ }
    }

    // ── Xử lý quantity mới ───────────────────────────────────────────────────
    if (quantity != null) {
      // Lot size validation: phải là bội số 100
      if (quantity % 100 !== 0) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_LOT_SIZE',
          message: `Khối lượng phải là bội số của 100 (lot size). Giá trị nhập: ${quantity}.`,
        });
      }

      const oldQty = Number(order.quantity);
      const currentPrice = effectiveLimitPrice ?? 0;

      if (quantity > oldQty && order.side === 'BUY') {
        // Tăng quantity: kiểm tra virtual balance đủ cover delta cost
        const deltaQty  = quantity - oldQty;
        const deltaCost = deltaQty * currentPrice + calculateBuyFee(currentPrice, deltaQty);

        const balance = await PaperCapitalService.getVirtualBalance(portfolio.id);
        const available = balance?.paper_available_cash ?? 0;

        if (available < deltaCost) {
          return res.status(422).json({
            success: false,
            error: 'INSUFFICIENT_BALANCE',
            message: `Không đủ số dư để tăng khối lượng. Cần thêm ${deltaCost.toLocaleString('vi-VN')}đ, hiện có ${available.toLocaleString('vi-VN')}đ.`,
            details: { required: deltaCost, available },
          });
        }

        // Deduct thêm cho delta quantity
        await PaperCapitalService.deductForBuy(portfolio.id, deltaCost);

      } else if (quantity < oldQty && order.side === 'BUY') {
        // Giảm quantity: refund delta
        const deltaQty     = oldQty - quantity;
        const refundAmount = deltaQty * currentPrice + calculateBuyFee(currentPrice, deltaQty);
        if (refundAmount > 0) {
          await PaperCapitalService.refundForCancel(portfolio.id, refundAmount);
        }
      }

      effectiveQuantity = quantity;
    }

    // ── Update order với optimistic locking ──────────────────────────────────
    const updateResult = await query(
      `UPDATE financial.orders
       SET limit_price = $2,
           quantity    = $3,
           updated_at  = NOW()
       WHERE id = $1
         AND status = 'PENDING'
       RETURNING *`,
      [order.id, effectiveLimitPrice, effectiveQuantity]
    );

    const updatedOrder = updateResult.rows[0];
    if (!updatedOrder) {
      // Race condition: lệnh đã bị fill/cancel trong lúc edit
      return res.status(409).json({
        success: false,
        error: 'ORDER_MODIFIED_CONCURRENTLY',
        message: 'Lệnh đã được xử lý bởi hệ thống trong lúc bạn sửa. Vui lòng refresh.',
      });
    }

    // Ghi audit log
    await ExecutionLog.write({
      entityType:  'ORDER',
      entityId:    order.id,
      portfolioId: portfolio.id,
      eventType:   'ORDER_MODIFIED',
      metadata:    {
        old: { limit_price: order.limit_price, quantity: order.quantity },
        new: { limit_price: effectiveLimitPrice, quantity: effectiveQuantity },
        warnings,
        context: 'PAPER',
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Lệnh đã được cập nhật',
      data:    updatedOrder,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error) {
    next(error);
  }
};

// ─── Helper function (placeholder) ───────────────────────────────────────────

async function isExistingLongToSell(portfolioId, symbol) {
  const { default: Position } = await import('../../models/Position.js');
  const positions = await Position.findByPortfolioId(portfolioId, { status: 'OPEN', context: 'PAPER' });
  return positions.some(p => p.symbol === symbol && p.side === 'LONG');
}

// ─── Re-export alias for backward compat (create = createOrder) ──────────────
export const create = createOrder;
