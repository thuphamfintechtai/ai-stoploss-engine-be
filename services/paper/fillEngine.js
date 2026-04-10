/**
 * Paper Fill Engine — Xử lý khớp lệnh cho PAPER TRADING simulator.
 *
 * Context guard: CHỈ xử lý orders/positions có context = 'PAPER'.
 * Không bao giờ chạy cho REAL orders.
 *
 * INSTANT mode:
 *   - MP: fill ngay tại current price
 *   - LO BUY:  fill nếu currentPrice <= limitPrice
 *   - LO SELL: fill nếu currentPrice >= limitPrice
 *   - ATO: fill tại open_price của phiên sáng
 *   - ATC: fill tại close_price của phiên chiều
 *
 * REALISTIC mode:
 *   - MP: fill ngay với slippage qua PaperMatchingEngine
 *   - LO: vào queue PENDING, worker fill sau với fill probability
 *   - ATO/ATC: dùng PaperMatchingEngine.fillATOOrder / fillATCOrder
 */

import Order from '../../models/Order.js';
import Position from '../../models/Position.js';
import Portfolio from '../../models/Portfolio.js';
import ExecutionLog from '../../models/ExecutionLog.js';
import { calculateBuyFee, calculateFees } from '../feeEngine.js';
import { transaction } from '../../config/database.js';
import { broadcastPortfolioUpdate } from '../websocket.js';
import PaperMatchingEngine from './paperMatchingEngine.js';
import PaperCapitalService from './paperCapitalService.js';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const VPBS_TO_VND = 1000;

// ─── Cache avgDailyVolume in-memory với TTL 1 giờ ──────────────────────────
const volumeCache = new Map(); // key: "symbol|exchange" → { volume, expiresAt }
const VOLUME_CACHE_TTL_MS = 60 * 60 * 1000; // 1 giờ

async function getCurrentPriceVnd(symbol, exchange = 'HOSE') {
  try {
    const res = await fetch(`${API_BASE}/api/market/symbols/${encodeURIComponent(symbol)}/price?exchange=${exchange}`);
    if (!res.ok) return null;
    const json = await res.json();
    const p = json?.data?.price != null ? parseFloat(json.data.price) : null;
    if (!p || !Number.isFinite(p)) return null;
    return Math.round(p >= 1000 ? p : p * VPBS_TO_VND);
  } catch {
    return null;
  }
}

async function getLatestCandle(symbol, exchange = 'HOSE') {
  try {
    const res = await fetch(`${API_BASE}/api/market/symbols/${encodeURIComponent(symbol)}/ohlcv?timeframe=1d&limit=1&exchange=${exchange}`);
    if (!res.ok) return null;
    const json = await res.json();
    const candles = json?.data ?? [];
    return candles.length > 0 ? candles[candles.length - 1] : null;
  } catch {
    return null;
  }
}

/**
 * Lấy avgDailyVolume cho symbol, cache 1 giờ.
 * Fallback: 100000 (medium liquidity) nếu fetch thất bại.
 *
 * @param {string} symbol
 * @param {string} exchange
 * @returns {Promise<number>}
 */
async function getAvgDailyVolume(symbol, exchange = 'HOSE') {
  const cacheKey = `${symbol}|${exchange}`;
  const cached = volumeCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.volume;
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/market/symbols/${encodeURIComponent(symbol)}/ohlcv?timeframe=1d&limit=20&exchange=${exchange}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const candles = json?.data ?? [];
    if (candles.length === 0) throw new Error('No candle data');

    const totalVolume = candles.reduce((sum, c) => sum + (Number(c.volume) || 0), 0);
    const avgVolume = Math.round(totalVolume / candles.length);

    volumeCache.set(cacheKey, {
      volume: avgVolume,
      expiresAt: Date.now() + VOLUME_CACHE_TTL_MS,
    });
    return avgVolume;
  } catch {
    console.warn(`[PaperFillEngine] Cannot get volume for ${symbol}, using default 100000`);
    return 100000; // medium liquidity fallback
  }
}

/**
 * Tạo position sau khi order được fill.
 * Dùng chung cho cả fillOrderInstant và fillOrderRealistic.
 *
 * @param {object} order - Order đã fill
 * @param {object} portfolio - Portfolio record
 * @param {number} fillPrice - Giá khớp (VND)
 * @param {number} buyFeeVnd - Phí mua đã tính
 * @returns {Promise<object>} position record
 */
async function createPositionFromOrder(order, portfolio, fillPrice, buyFeeVnd) {
  const position = await transaction(async (client) => {
    const side = order.side === 'BUY' ? 'LONG' : 'SHORT';
    const stopType = order.stop_type || (order.stop_loss_vnd ? 'FIXED' : null);
    const trailingCurrentStop = stopType === 'TRAILING' ? order.stop_loss_vnd : null;

    const result = await client.query(
      `INSERT INTO financial.positions (
        portfolio_id, order_id, symbol, exchange, entry_price, quantity,
        stop_loss, stop_type, stop_params, trailing_current_stop,
        take_profit, take_profit_type,
        risk_value_vnd, buy_fee_vnd, side, status, context, opened_at, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'OPEN','PAPER',NOW(),$16)
      RETURNING *`,
      [
        order.portfolio_id, order.id, order.symbol, order.exchange,
        fillPrice, order.quantity,
        order.stop_loss_vnd ?? null,
        stopType,
        order.stop_params ? JSON.stringify(order.stop_params) : null,
        trailingCurrentStop,
        order.take_profit_vnd ?? null,
        order.take_profit_type ?? null,
        // risk_value_vnd: nếu có SL
        order.stop_loss_vnd
          ? Math.abs(fillPrice - order.stop_loss_vnd) * order.quantity
          : 0,
        buyFeeVnd,
        side,
        order.notes ?? null,
      ]
    );
    return result.rows[0];
  });

  return position;
}

/**
 * Check và fill order ngay lập tức (INSTANT mode) — CHỈ cho PAPER orders.
 * Dùng khi tạo order mới (MP) hoặc trong fill worker cycle.
 *
 * Pitfall 4 fix: deductForBuy được gọi trước khi tạo position.
 *
 * @param {object} order - Order record từ DB (phải có context = 'PAPER')
 * @param {object} [portfolio] - Portfolio record (optional, sẽ fetch nếu không có)
 * @returns {{ filled: boolean, position: object|null }}
 */
export async function fillOrderInstant(order, portfolio = null) {
  // Context guard: chỉ fill orders có context = 'PAPER'
  if (order.context !== 'PAPER') {
    console.warn(`[PaperFillEngine] Skipping order ${order.id} with context=${order.context} (not PAPER)`);
    return { filled: false, position: null };
  }

  if (!['PENDING', 'PARTIALLY_FILLED'].includes(order.status)) {
    return { filled: false, position: null };
  }

  // Lấy giá thị trường
  const currentPrice = await getCurrentPriceVnd(order.symbol, order.exchange);
  if (!currentPrice) {
    console.warn(`[PaperFillEngine] Cannot get price for ${order.symbol}, skip fill`);
    return { filled: false, position: null };
  }

  // Kiểm tra điều kiện fill theo order type
  let shouldFill = false;
  let fillPrice  = currentPrice;

  if (order.order_type === 'MP') {
    shouldFill = true;
    fillPrice  = currentPrice;
  } else if (order.order_type === 'LO') {
    if (order.side === 'BUY'  && currentPrice <= order.limit_price) {
      shouldFill = true;
      fillPrice  = order.limit_price; // fill tại giá limit (tốt hơn market)
    } else if (order.side === 'SELL' && currentPrice >= order.limit_price) {
      shouldFill = true;
      fillPrice  = order.limit_price;
    }
  } else if (order.order_type === 'ATO') {
    // ATO: fill tại open price của ngày
    const candle = await getLatestCandle(order.symbol, order.exchange);
    if (candle?.open) {
      const openVnd = Math.round(candle.open >= 1000 ? candle.open : candle.open * VPBS_TO_VND);
      shouldFill = true;
      fillPrice  = openVnd;
    }
  } else if (order.order_type === 'ATC') {
    // ATC: fill tại close price của ngày
    const candle = await getLatestCandle(order.symbol, order.exchange);
    if (candle?.close) {
      const closeVnd = Math.round(candle.close >= 1000 ? candle.close : candle.close * VPBS_TO_VND);
      shouldFill = true;
      fillPrice  = closeVnd;
    }
  }

  if (!shouldFill) {
    return { filled: false, position: null };
  }

  // Fetch portfolio nếu chưa có
  if (!portfolio) {
    portfolio = await Portfolio.findById(order.portfolio_id);
  }
  if (!portfolio) return { filled: false, position: null };

  // Tính buy_fee để lưu vào position ngay khi tạo
  const buyFeeVnd = calculateBuyFee(fillPrice, order.quantity, portfolio);

  // Pitfall 4: Deduct virtual balance trước khi fill (chỉ cho BUY)
  if (order.side === 'BUY') {
    try {
      const totalCost = fillPrice * order.quantity + buyFeeVnd;
      await PaperCapitalService.deductForBuy(order.portfolio_id, totalCost);
    } catch (err) {
      console.warn(`[PaperFillEngine] Insufficient paper balance for order ${order.id}: ${err.message}`);
      await Order.reject(order.id);
      return { filled: false, position: null };
    }
  }

  // Fill order với optimistic locking
  const updatedOrder = await Order.fill(order.id, order.quantity, fillPrice);
  if (!updatedOrder) {
    // Race condition — đã fill/cancel bởi process khác
    // Hoàn tiền nếu đã deduct
    if (order.side === 'BUY') {
      const totalCost = fillPrice * order.quantity + buyFeeVnd;
      await PaperCapitalService.refundForCancel(order.portfolio_id, totalCost).catch(() => {});
    }
    console.warn(`[PaperFillEngine] Race condition on order ${order.id}, skip`);
    return { filled: false, position: null };
  }

  // Tạo position từ order đã fill
  const position = await createPositionFromOrder(order, portfolio, fillPrice, buyFeeVnd);

  // SELL: addPendingSettlement T+2
  if (order.side === 'SELL') {
    try {
      const fees = calculateFees(fillPrice, fillPrice, order.quantity, portfolio);
      const netAmount = fillPrice * order.quantity - fees.sell_fee_vnd - fees.sell_tax_vnd;
      await PaperCapitalService.addPendingSettlement(order.portfolio_id, netAmount, order.id);
    } catch (err) {
      console.warn(`[PaperFillEngine] addPendingSettlement error for order ${order.id}: ${err.message}`);
    }
  }

  // Ghi audit logs
  await ExecutionLog.write({
    entityType:  'ORDER',
    entityId:    order.id,
    portfolioId: order.portfolio_id,
    eventType:   'ORDER_FILLED',
    fillPrice,
    metadata:    { quantity: order.quantity, order_type: order.order_type, position_id: position.id, context: 'PAPER', mode: 'INSTANT' },
  });

  await ExecutionLog.write({
    entityType:  'POSITION',
    entityId:    position.id,
    portfolioId: order.portfolio_id,
    eventType:   'POSITION_CREATED',
    fillPrice,
    metadata:    { order_id: order.id, buy_fee_vnd: buyFeeVnd, context: 'PAPER', mode: 'INSTANT' },
  });

  // Broadcast
  try {
    broadcastPortfolioUpdate(order.portfolio_id, {
      type:       'order_filled',
      order_id:   order.id,
      position_id: position.id,
      symbol:     order.symbol,
      fill_price: fillPrice,
      context:    'PAPER',
      mode:       'INSTANT',
    });
  } catch (_) { /* ignore WS errors */ }

  console.log(`[PaperFillEngine] Order ${order.id} (${order.symbol}) filled @ ${fillPrice} → position ${position.id} [PAPER/INSTANT]`);
  return { filled: true, position };
}

/**
 * Fill order theo REALISTIC mode (slippage + fill probability).
 * Dùng PaperMatchingEngine để tính giá fill và xác suất khớp lệnh.
 *
 * - MP: fill ngay với slippage
 * - LO: có thể fill hoặc không (fill probability dựa trên volume)
 * - ATO: fill tại open price qua PaperMatchingEngine.fillATOOrder
 * - ATC: fill tại close price qua PaperMatchingEngine.fillATCOrder
 *
 * @param {object} order - Order record từ DB (phải có context = 'PAPER')
 * @param {object} [portfolio] - Portfolio record (optional)
 * @returns {{ filled: boolean, position: object|null, slippage?: number }}
 */
export async function fillOrderRealistic(order, portfolio = null) {
  // Context guard: chỉ fill PAPER orders
  if (order.context !== 'PAPER') {
    console.warn(`[PaperFillEngine] fillOrderRealistic: Skipping order ${order.id} with context=${order.context} (not PAPER)`);
    return { filled: false, position: null };
  }

  if (!['PENDING', 'PARTIALLY_FILLED'].includes(order.status)) {
    return { filled: false, position: null };
  }

  // Lấy giá thị trường
  const currentPrice = await getCurrentPriceVnd(order.symbol, order.exchange);
  if (!currentPrice) {
    console.warn(`[PaperFillEngine] fillOrderRealistic: Cannot get price for ${order.symbol}, skip`);
    return { filled: false, position: null };
  }

  // Lấy avgDailyVolume (cached 1 giờ)
  const avgDailyVolume = await getAvgDailyVolume(order.symbol, order.exchange);

  // Quyết định fill dựa trên order_type
  let fillResult = { filled: false };

  if (order.order_type === 'MP') {
    fillResult = PaperMatchingEngine.fillMarketOrder(order, currentPrice, avgDailyVolume, order.exchange);
  } else if (order.order_type === 'LO') {
    fillResult = PaperMatchingEngine.tryFillLimitOrder(order, currentPrice, avgDailyVolume);
  } else if (order.order_type === 'ATO') {
    const candle = await getLatestCandle(order.symbol, order.exchange);
    if (candle?.open) {
      const openVnd = Math.round(candle.open >= 1000 ? candle.open : candle.open * VPBS_TO_VND);
      fillResult = PaperMatchingEngine.fillATOOrder(order, openVnd);
    }
  } else if (order.order_type === 'ATC') {
    const candle = await getLatestCandle(order.symbol, order.exchange);
    if (candle?.close) {
      const closeVnd = Math.round(candle.close >= 1000 ? candle.close : candle.close * VPBS_TO_VND);
      fillResult = PaperMatchingEngine.fillATCOrder(order, closeVnd);
    }
  }

  if (!fillResult.filled) {
    return { filled: false, position: null };
  }

  const fillPrice = fillResult.fillPrice;
  const slippage  = fillResult.slippage ?? 0;

  // Fetch portfolio nếu chưa có
  if (!portfolio) {
    portfolio = await Portfolio.findById(order.portfolio_id);
  }
  if (!portfolio) return { filled: false, position: null };

  // Tính buy_fee
  const buyFeeVnd = calculateBuyFee(fillPrice, order.quantity, portfolio);

  // Pitfall 4: Deduct virtual balance trước khi fill (chỉ cho BUY)
  if (order.side === 'BUY') {
    try {
      const totalCost = fillPrice * order.quantity + buyFeeVnd;
      await PaperCapitalService.deductForBuy(order.portfolio_id, totalCost);
    } catch (err) {
      console.warn(`[PaperFillEngine] fillOrderRealistic: Insufficient paper balance for order ${order.id}: ${err.message}`);
      await Order.reject(order.id);
      return { filled: false, position: null };
    }
  }

  // Fill order với optimistic locking
  const updatedOrder = await Order.fill(order.id, order.quantity, fillPrice);
  if (!updatedOrder) {
    // Race condition — đã fill/cancel bởi process khác; hoàn tiền
    if (order.side === 'BUY') {
      const totalCost = fillPrice * order.quantity + buyFeeVnd;
      await PaperCapitalService.refundForCancel(order.portfolio_id, totalCost).catch(() => {});
    }
    console.warn(`[PaperFillEngine] fillOrderRealistic: Race condition on order ${order.id}, skip`);
    return { filled: false, position: null };
  }

  // Tạo position từ order đã fill
  const position = await createPositionFromOrder(order, portfolio, fillPrice, buyFeeVnd);

  // SELL: addPendingSettlement T+2
  if (order.side === 'SELL') {
    try {
      const fees = calculateFees(fillPrice, fillPrice, order.quantity, portfolio);
      const netAmount = fillPrice * order.quantity - fees.sell_fee_vnd - fees.sell_tax_vnd;
      await PaperCapitalService.addPendingSettlement(order.portfolio_id, netAmount, order.id);
    } catch (err) {
      console.warn(`[PaperFillEngine] fillOrderRealistic: addPendingSettlement error for order ${order.id}: ${err.message}`);
    }
  }

  // Ghi audit logs
  await ExecutionLog.write({
    entityType:  'ORDER',
    entityId:    order.id,
    portfolioId: order.portfolio_id,
    eventType:   'ORDER_FILLED',
    fillPrice,
    metadata:    {
      quantity: order.quantity,
      order_type: order.order_type,
      position_id: position.id,
      context: 'PAPER',
      mode: 'REALISTIC',
      slippage,
    },
  });

  await ExecutionLog.write({
    entityType:  'POSITION',
    entityId:    position.id,
    portfolioId: order.portfolio_id,
    eventType:   'POSITION_CREATED',
    fillPrice,
    metadata:    { order_id: order.id, buy_fee_vnd: buyFeeVnd, context: 'PAPER', mode: 'REALISTIC', slippage },
  });

  // Broadcast
  try {
    broadcastPortfolioUpdate(order.portfolio_id, {
      type:        'order_filled',
      order_id:    order.id,
      position_id: position.id,
      symbol:      order.symbol,
      fill_price:  fillPrice,
      slippage,
      context:     'PAPER',
      mode:        'REALISTIC',
    });
  } catch (_) { /* ignore WS errors */ }

  console.log(
    `[PaperFillEngine] Order ${order.id} (${order.symbol}) filled @ ${fillPrice}` +
    (slippage > 0 ? ` (slippage: ${slippage}đ)` : '') +
    ` → position ${position.id} [PAPER/REALISTIC]`
  );
  return { filled: true, position, slippage };
}

/**
 * Expire các lệnh PAPER hết hạn (cuối phiên).
 * Gọi từ worker cuối mỗi phiên giao dịch.
 */
export async function expireEndOfSessionOrders() {
  const expired = await Order.expireStale();
  // Chỉ log cho PAPER orders
  const paperExpired = expired.filter(o => o.context === 'PAPER');
  for (const order of paperExpired) {
    await ExecutionLog.write({
      entityType:  'ORDER',
      entityId:    order.id,
      portfolioId: order.portfolio_id,
      eventType:   'ORDER_EXPIRED',
      metadata:    { expired_at: order.expired_at, order_type: order.order_type, context: 'PAPER' },
    });
    console.log(`[PaperFillEngine] Order ${order.id} (${order.symbol}) expired [PAPER]`);
  }
  return paperExpired.length;
}

export default {
  fillOrderInstant,
  fillOrderRealistic,
  expireEndOfSessionOrders,
};
