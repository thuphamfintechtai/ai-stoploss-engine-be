/**
 * Stop-Loss Monitor Worker (v2)
 *
 * Cải tiến so với v1:
 *   1. Dùng OHLCV candle (high/low) thay vì giá điểm → phát hiện SL/TP chính xác hơn
 *   2. Tính slippage khi gap down/up qua mức trigger
 *   3. P&L tính đủ: gross - fee - slippage = net_pnl
 *   4. Circuit breaker: nếu VPBS API lỗi liên tiếp → pause, không crash
 *   5. Conflict resolution: SL và TP cùng trigger trong 1 nến → chỉ trigger 1 cái
 *   6. Trailing stop update SAU khi check close (tránh đóng ngay sau khi kéo stop)
 *   7. Fill engine cho pending LO orders
 *   8. Expire orders hết phiên
 */

import dotenv from 'dotenv';
import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { query, transaction, testConnection } from '../config/database.js';
import Position from '../models/Position.js';
import ExecutionLog from '../models/ExecutionLog.js';
import Portfolio from '../models/Portfolio.js';
import { calculateFees } from '../services/feeEngine.js';
import { calcLongSLSlippage, calcShortSLSlippage, calcLongTPSlippage, calcShortTPSlippage, resolveConflict } from '../services/slippageCalculator.js';
import { createNotification, getUserIdByPortfolio } from '../services/notificationService.js';
import { fillOrderInstant, expireEndOfSessionOrders } from '../services/fillEngine.js';
import Order from '../models/Order.js';
import { calculateDynamicSL, generateSLNarrative } from '../services/ai/dynamicStopLoss.js';
import { getOrCreateIndicators, feedCandle } from '../services/ai/indicatorCache.js';

dotenv.config();

const CHECK_CRON    = process.env.STOPLOSS_CRON || '*/2 * * * *'; // 2 phút (production nên 30s)
const ALERT_CRON    = process.env.ALERT_CRON    || '*/5 * * * *'; // smart alerts mỗi 5 phút
const API_BASE      = process.env.API_BASE_URL   || 'http://localhost:3000';
const VPBS_TO_VND   = 1000;

// ─── Circuit Breaker ──────────────────────────────────────────────────────────
const circuitBreaker = {
  failures:      0,
  MAX_FAILURES:  3,
  RESET_AFTER_MS: 5 * 60 * 1000, // reset sau 5 phút
  lastFailure:   0,
  isOpen() {
    if (this.failures >= this.MAX_FAILURES) {
      if (Date.now() - this.lastFailure > this.RESET_AFTER_MS) {
        console.log('[CB] Reset circuit breaker');
        this.failures = 0;
        return false;
      }
      return true;
    }
    return false;
  },
  recordSuccess() { this.failures = 0; },
  recordFailure() {
    this.failures++;
    this.lastFailure = Date.now();
    if (this.failures >= this.MAX_FAILURES) {
      console.error(`[CB] Circuit breaker OPEN after ${this.MAX_FAILURES} failures. Pausing market data calls for ${this.RESET_AFTER_MS / 60000} phút.`);
    }
  },
};

// ─── Trailing high-water marks ────────────────────────────────────────────────
const trailingHWM = new Map(); // positionId → priceVnd

async function loadTrailingHWM() {
  try {
    // Context guard: chỉ load trailing HWM cho PAPER positions
    const res = await query(
      `SELECT id, trailing_current_stop, stop_params
       FROM financial.positions WHERE status = 'OPEN' AND stop_type = 'TRAILING' AND context = 'PAPER'`
    );
    for (const row of res.rows) {
      const params = typeof row.stop_params === 'object' ? row.stop_params ?? {} : {};
      const hwm = params.high_water_mark != null
        ? parseFloat(params.high_water_mark)
        : (row.trailing_current_stop != null ? parseFloat(row.trailing_current_stop) : null);
      if (hwm != null && Number.isFinite(hwm)) trailingHWM.set(row.id, hwm);
    }
    console.log(`[Trailing] Loaded ${trailingHWM.size} HWM from DB`);
  } catch (err) {
    console.error('[Trailing] Failed to load HWM:', err.message);
  }
}

// ─── Market hours ─────────────────────────────────────────────────────────────
function isMarketOpen() {
  const now = new Date();
  const tz  = 'Asia/Ho_Chi_Minh';
  const day = now.toLocaleDateString('vi-VN', { weekday: 'short', timeZone: tz });
  if (day === 'CN' || day === 'T7') return false;
  const t = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  const [h, m] = t.split(':').map(Number);
  const hhmm   = h * 100 + m;
  return (hhmm >= 915 && hhmm <= 1130) || (hhmm >= 1300 && hhmm <= 1500);
}

function isClosingSession() {
  const now = new Date();
  const tz  = 'Asia/Ho_Chi_Minh';
  const t   = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
  const [h, m] = t.split(':').map(Number);
  const hhmm   = h * 100 + m;
  return hhmm >= 1500; // sau 15:00 là cuối phiên
}

// ─── Market data helpers ──────────────────────────────────────────────────────

function toVnd(val) {
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n >= 1000 ? n : n * VPBS_TO_VND);
}

async function getLatestCandle(symbol, exchange) {
  try {
    const res = await fetch(
      `${API_BASE}/api/market/symbols/${encodeURIComponent(symbol)}/ohlcv?timeframe=1d&limit=2&exchange=${exchange}`
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const candles = json?.data ?? [];
    if (candles.length === 0) throw new Error('No candle data');

    const raw = candles[candles.length - 1];
    // Chuyển về VND
    const candle = {
      open:   toVnd(raw.open),
      high:   toVnd(raw.high),
      low:    toVnd(raw.low),
      close:  toVnd(raw.close),
      volume: raw.volume ?? 0,
      time:   raw.time,
    };

    if (!candle.open || !candle.high || !candle.low || !candle.close) {
      throw new Error('Incomplete candle data');
    }

    circuitBreaker.recordSuccess();
    return candle;
  } catch (err) {
    circuitBreaker.recordFailure();
    console.warn(`[Worker] Cannot get candle for ${symbol}: ${err.message}`);
    return null;
  }
}

// ─── Tick size round ──────────────────────────────────────────────────────────

function roundToTick(priceVnd) {
  if (priceVnd <= 10000)  return Math.round(priceVnd / 10)  * 10;
  if (priceVnd <= 49950)  return Math.round(priceVnd / 50)  * 50;
  return Math.round(priceVnd / 100) * 100;
}

// ─── Core: close position ─────────────────────────────────────────────────────

async function closePosition(pos, candle, newStatus, slipResult, workerRunId) {
  const portfolio = await Portfolio.findById(pos.portfolio_id);
  const fees      = calculateFees(
    parseFloat(pos.entry_price),
    slipResult.fill_price,
    parseFloat(pos.quantity),
    portfolio
  );

  const slippageVnd  = Math.max(0, slipResult.slippage_vnd); // chỉ tính bất lợi vào net P&L
  const netPnlVnd    = fees.gross_pnl_vnd - fees.buy_fee_vnd - fees.sell_fee_vnd - fees.sell_tax_vnd - slippageVnd;

  // Update position trong transaction
  await transaction(async (client) => {
    await client.query(
      `UPDATE financial.positions
       SET status          = $2,
           closed_at       = NOW(),
           closed_price    = $3,
           gross_pnl_vnd   = $4,
           buy_fee_vnd     = COALESCE(buy_fee_vnd, $5),
           sell_fee_vnd    = $6,
           sell_tax_vnd    = $7,
           slippage_vnd    = $8,
           slippage_reason = $9,
           profit_loss_vnd = $10,
           updated_at      = NOW()
       WHERE id = $1 AND status = 'OPEN'`,
      [
        pos.id, newStatus,
        slipResult.fill_price,
        fees.gross_pnl_vnd,
        fees.buy_fee_vnd,   // buy_fee có thể đã set khi tạo position
        fees.sell_fee_vnd,
        fees.sell_tax_vnd,
        slipResult.slippage_vnd,
        slipResult.slippage_reason,
        netPnlVnd,
      ]
    );
  });

  // Audit log
  const isSL = newStatus === 'CLOSED_SL';
  await ExecutionLog.write({
    entityType:  'POSITION',
    entityId:    pos.id,
    portfolioId: pos.portfolio_id,
    eventType:   isSL ? 'SL_TRIGGERED' : 'TP_TRIGGERED',
    triggerPrice: isSL ? parseFloat(pos.stop_loss) : parseFloat(pos.take_profit),
    fillPrice:   slipResult.fill_price,
    slippageVnd: slipResult.slippage_vnd,
    metadata: {
      slippage_reason: slipResult.slippage_reason,
      candle_high:     candle.high,
      candle_low:      candle.low,
      candle_open:     candle.open,
      gross_pnl:       fees.gross_pnl_vnd,
      fees_total:      fees.buy_fee_vnd + fees.sell_fee_vnd + fees.sell_tax_vnd,
      net_pnl:         netPnlVnd,
    },
    workerRunId,
  });

  if (slipResult.slippage_vnd > 0) {
    await ExecutionLog.write({
      entityType:  'POSITION',
      entityId:    pos.id,
      portfolioId: pos.portfolio_id,
      eventType:   'SLIPPAGE_OCCURRED',
      triggerPrice: isSL ? parseFloat(pos.stop_loss) : parseFloat(pos.take_profit),
      fillPrice:   slipResult.fill_price,
      slippageVnd: slipResult.slippage_vnd,
      metadata:    { reason: slipResult.slippage_reason },
      workerRunId,
    });
  }

  // Notification
  try {
    const userId = await getUserIdByPortfolio(pos.portfolio_id);
    if (userId) {
      const pnlSign    = netPnlVnd >= 0 ? '+' : '';
      const slippageMsg = slipResult.slippage_vnd > 0
        ? ` ⚠ Trượt giá: -${Math.round(slipResult.slippage_vnd).toLocaleString('vi-VN')}đ (${slipResult.slippage_reason}).`
        : '';

      await createNotification({
        userId,
        type:     isSL ? 'SL_TRIGGERED' : 'TP_TRIGGERED',
        title:    isSL ? `Stop Loss: ${pos.symbol}` : `Take Profit: ${pos.symbol}`,
        message:  isSL
          ? `${pos.symbol} cắt lỗ tại ${slipResult.fill_price.toLocaleString('vi-VN')}đ. P&L thực: ${pnlSign}${Math.round(netPnlVnd).toLocaleString('vi-VN')}đ.${slippageMsg}`
          : `${pos.symbol} chốt lời tại ${slipResult.fill_price.toLocaleString('vi-VN')}đ. P&L thực: ${pnlSign}${Math.round(netPnlVnd).toLocaleString('vi-VN')}đ.${slippageMsg}`,
        severity: isSL ? 'WARNING' : 'SUCCESS',
        metadata: {
          position_id:  pos.id,
          symbol:       pos.symbol,
          fill_price:   slipResult.fill_price,
          slippage_vnd: slipResult.slippage_vnd,
          net_pnl_vnd:  netPnlVnd,
          status:       newStatus,
        },
      });

      const { broadcastPortfolioUpdate } = await import('../services/websocket.js');
      broadcastPortfolioUpdate(pos.portfolio_id, {
        type:        'position_closed',
        position_id: pos.id,
        symbol:      pos.symbol,
        status:      newStatus,
        fill_price:  slipResult.fill_price,
        net_pnl_vnd: netPnlVnd,
        slippage_vnd: slipResult.slippage_vnd,
      });
    }
  } catch (notifErr) {
    console.error('[Worker] Notification error:', notifErr.message);
  }

  // Cleanup in-memory caches cho position đã đóng
  trailingHWM.delete(pos.id);
  alertCache.delete(`${pos.id}:APPROACHING_SL`);
  alertCache.delete(`${pos.id}:APPROACHING_TP`);
  alertCache.delete(`${pos.id}:HIGH_VOLATILITY`);

  const pnlSign = netPnlVnd >= 0 ? '+' : '';
  console.log(
    `[Worker] ${pos.symbol} ${newStatus} @ ${slipResult.fill_price}` +
    (slipResult.slippage_vnd > 0 ? ` (slip: -${slipResult.slippage_vnd})` : '') +
    ` | net P&L: ${pnlSign}${Math.round(netPnlVnd)}`
  );
}

// ─── Trailing stop update ─────────────────────────────────────────────────────

async function updateTrailingStops(positions, candle, symbol, workerRunId) {
  const trailingPositions = positions.filter(p => p.stop_type === 'TRAILING' && p.status === 'OPEN');

  for (const pos of trailingPositions) {
    const isLong  = (pos.side || 'LONG') === 'LONG';
    const params  = typeof pos.stop_params === 'object' ? pos.stop_params ?? {} : {};
    const stepPct = parseFloat(params.trailing_step_percent ?? params.trailing_percent ?? 2);
    const curStop = pos.trailing_current_stop != null
      ? parseFloat(pos.trailing_current_stop)
      : parseFloat(pos.stop_loss);

    const hwmKey = pos.id;
    const hwm    = trailingHWM.get(hwmKey) ?? (isLong ? candle.high : candle.low);

    let newHWM = hwm;
    if (isLong  && candle.high > hwm) newHWM = candle.high;
    if (!isLong && candle.low  < hwm) newHWM = candle.low;

    const newStop = isLong
      ? roundToTick(newHWM * (1 - stepPct / 100))
      : roundToTick(newHWM * (1 + stepPct / 100));

    const shouldUpdate = isLong ? newStop > curStop : newStop < curStop;

    if (newHWM !== hwm || shouldUpdate) {
      trailingHWM.set(hwmKey, newHWM);

      // Persist HWM
      const newParams = { ...params, high_water_mark: newHWM };
      await query(
        `UPDATE financial.positions SET stop_params = $1 WHERE id = $2`,
        [JSON.stringify(newParams), pos.id]
      );
    }

    if (shouldUpdate) {
      await Position.update(pos.id, { trailingCurrentStop: newStop, stopLoss: newStop });

      await ExecutionLog.write({
        entityType:  'POSITION',
        entityId:    pos.id,
        portfolioId: pos.portfolio_id,
        eventType:   'TRAILING_UPDATED',
        metadata:    { old_stop: curStop, new_stop: newStop, hwm: newHWM, step_pct: stepPct },
        workerRunId,
      });

      try {
        const { broadcastPortfolioUpdate } = await import('../services/websocket.js');
        broadcastPortfolioUpdate(pos.portfolio_id, {
          type:         'trailing_stop_updated',
          position_id:  pos.id,
          symbol:       pos.symbol,
          new_stop:     newStop,
          current_high: candle.high,
          hwm:          newHWM,
        });
      } catch (_) {}

      console.log(`[Trailing] ${pos.symbol} ${isLong ? 'LONG' : 'SHORT'}: stop ${curStop} → ${newStop} (HWM=${newHWM})`);
    }
  }
}

// ─── Main check cycle ─────────────────────────────────────────────────────────

async function checkAndClosePositions() {
  if (circuitBreaker.isOpen()) {
    console.warn('[Worker] Circuit breaker open, skipping cycle');
    return;
  }

  const workerRunId = uuidv4().slice(0, 8);

  // Lấy tất cả symbols có OPEN positions thuộc PAPER context
  // Context guard: stopLossMonitor chỉ monitor PAPER positions
  // Real positions không cần SL monitor vì user tự quản lý trên sàn
  const openResult = await query(
    `SELECT p.id, p.portfolio_id, p.symbol, p.exchange, p.entry_price,
            p.stop_loss, p.take_profit, p.quantity, p.side,
            p.stop_type, p.stop_params, p.trailing_current_stop
     FROM financial.positions p
     WHERE p.status = 'OPEN' AND p.context = 'PAPER'`
  );
  const allPositions = openResult.rows;
  if (allPositions.length === 0) return;

  // Group by symbol để fetch candle một lần cho nhiều positions cùng symbol
  const symbolMap = {};
  for (const pos of allPositions) {
    const key = `${pos.symbol}|${pos.exchange || 'HOSE'}`;
    if (!symbolMap[key]) symbolMap[key] = [];
    symbolMap[key].push(pos);
  }

  for (const [key, positions] of Object.entries(symbolMap)) {
    const [symbol, exchange] = key.split('|');

    // Fetch candle một lần cho cả nhóm
    const candle = await getLatestCandle(symbol, exchange);
    if (!candle) continue;

    for (const pos of positions) {
      if (pos.status !== 'OPEN') continue; // có thể đã bị đóng bởi iteration trước

      const isLong = (pos.side || 'LONG') === 'LONG';
      const sl     = pos.stop_loss   != null ? parseFloat(pos.stop_loss)   : null;
      const tp     = pos.take_profit != null ? parseFloat(pos.take_profit) : null;

      // Check SL/TP triggers
      const slTriggered = sl != null && (isLong ? candle.low <= sl  : candle.high >= sl);
      const tpTriggered = tp != null && (isLong ? candle.high >= tp : candle.low  <= tp);

      if (slTriggered && tpTriggered) {
        // Conflict: cả 2 trigger trong cùng nến
        const winner = resolveConflict(isLong ? 'LONG' : 'SHORT', candle, sl, tp);
        console.log(`[Worker] ${symbol} conflict SL+TP in same candle → ${winner} wins (workerRun=${workerRunId})`);
        if (winner === 'SL') {
          const slipResult = isLong
            ? calcLongSLSlippage(candle, sl, parseFloat(pos.quantity))
            : calcShortSLSlippage(candle, sl, parseFloat(pos.quantity));
          if (slipResult.triggered) await closePosition(pos, candle, 'CLOSED_SL', slipResult, workerRunId);
        } else {
          const slipResult = isLong
            ? calcLongTPSlippage(candle, tp, parseFloat(pos.quantity))
            : calcShortTPSlippage(candle, tp, parseFloat(pos.quantity));
          if (slipResult.triggered) await closePosition(pos, candle, 'CLOSED_TP', slipResult, workerRunId);
        }
      } else if (slTriggered) {
        const slipResult = isLong
          ? calcLongSLSlippage(candle, sl, parseFloat(pos.quantity))
          : calcShortSLSlippage(candle, sl, parseFloat(pos.quantity));
        if (slipResult.triggered) await closePosition(pos, candle, 'CLOSED_SL', slipResult, workerRunId);
      } else if (tpTriggered) {
        const slipResult = isLong
          ? calcLongTPSlippage(candle, tp, parseFloat(pos.quantity))
          : calcShortTPSlippage(candle, tp, parseFloat(pos.quantity));
        if (slipResult.triggered) await closePosition(pos, candle, 'CLOSED_TP', slipResult, workerRunId);
      } else {
        // Không trigger SL/TP → update trailing stop NẾU CÓ
        // (update trailing PHẢI SAU check close, không trước)
        await updateTrailingStops([pos], candle, symbol, workerRunId);
      }
    }

    // Fill pending LO orders cho symbol này
    try {
      const pendingOrders = await Order.findPendingBySymbol(symbol);
      for (const order of pendingOrders) {
        if (order.exchange === exchange) {
          await fillOrderInstant(order);
        }
      }
    } catch (fillErr) {
      console.error(`[Worker] Fill engine error for ${symbol}:`, fillErr.message);
    }
  }

  // Cuối phiên: expire orders
  if (isClosingSession()) {
    const expiredCount = await expireEndOfSessionOrders();
    if (expiredCount > 0) console.log(`[Worker] Expired ${expiredCount} orders`);
  }
}

// ─── Smart alerts ─────────────────────────────────────────────────────────────

const alertCache = new Map(); // positionId:type → timestamp
const ALERT_CACHE_EXPIRY_MS = 60 * 60 * 1000; // 1 giờ

function cleanupAlertCache() {
  const now = Date.now();
  for (const [key, timestamp] of alertCache) {
    if (now - timestamp > ALERT_CACHE_EXPIRY_MS) alertCache.delete(key);
  }
}

async function checkSmartAlerts() {
  if (!process.env.GEMINI_API_KEY) return;

  try {
    const { generateSmartAlerts } = await import('../services/aiService.js');
    // Context guard: chỉ generate smart alerts cho PAPER positions
    const openResult = await query(
      `SELECT p.id, p.portfolio_id, p.symbol, p.exchange, p.entry_price,
              p.stop_loss, p.take_profit, p.quantity, p.side
       FROM financial.positions p WHERE p.status = 'OPEN' AND p.context = 'PAPER'`
    );
    const positions = openResult.rows;
    if (positions.length === 0) return;

    const symbols = [...new Set(positions.map(p => p.symbol))];
    const prices  = {};
    await Promise.all(symbols.map(async (sym) => {
      const pos = positions.find(p => p.symbol === sym);
      const candle = await getLatestCandle(sym, pos?.exchange || 'HOSE');
      if (candle?.close) prices[sym] = candle.close;
    }));

    const alerts = await generateSmartAlerts(positions, prices);
    for (const alert of alerts) {
      const cacheKey = `${alert.position_id}:${alert.type}`;
      const lastSent = alertCache.get(cacheKey);
      if (lastSent && Date.now() - lastSent < 30 * 60 * 1000) continue;
      alertCache.set(cacheKey, Date.now());

      const pos = positions.find(p => p.id === alert.position_id);
      if (!pos) continue;
      const userId = await getUserIdByPortfolio(pos.portfolio_id);
      if (!userId) continue;

      await createNotification({
        userId,
        type:     'AI_ALERT',
        title:    alert.title,
        message:  alert.message,
        severity: alert.severity,
        metadata: { ...alert.metadata, position_id: alert.position_id, alert_type: alert.type },
      });
    }
    // Dọn dẹp alertCache entries quá 1 giờ
    cleanupAlertCache();
  } catch (err) {
    console.error('[SmartAlert] Error:', err.message);
  }
}

// ─── Dynamic SL recalculation (moi 5 phut trong gio giao dich) ───────────────

const DYNAMIC_SL_CRON = '*/5 9-15 * * 1-5'; // 9h-15h Mon-Fri

async function recalculateDynamicSLJob() {
  if (circuitBreaker.isOpen()) {
    console.warn('[DynamicSL] Circuit breaker open, skipping cycle');
    return;
  }

  const workerRunId = uuidv4().slice(0, 8);

  // Query ca REAL va PAPER positions dang OPEN co stop_loss
  const openResult = await query(
    `SELECT p.id, p.portfolio_id, p.symbol, p.exchange, p.entry_price,
            p.stop_loss, p.take_profit, p.quantity, p.side, p.context
     FROM financial.positions p
     WHERE p.status = 'OPEN' AND p.stop_loss IS NOT NULL`
  );
  const allPositions = openResult.rows;
  if (allPositions.length === 0) return;

  // Group by symbol
  const symbolMap = {};
  for (const pos of allPositions) {
    const key = `${pos.symbol}|${pos.exchange || 'HOSE'}`;
    if (!symbolMap[key]) symbolMap[key] = [];
    symbolMap[key].push(pos);
  }

  const symbols = Object.keys(symbolMap);
  console.log(`[DynamicSL] Recalculating SL for ${allPositions.length} positions across ${symbols.length} symbols`);

  // Gioi han concurrent: xu ly toi da 5 symbols dong thoi (tranh VPBS rate limit)
  const CONCURRENCY = 5;
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (key) => {
      const [symbol, exchange] = key.split('|');
      const positions = symbolMap[key];

      // Fetch candle moi nhat
      const candle = await getLatestCandle(symbol, exchange);
      if (!candle) return;

      // Update indicators
      feedCandle(symbol, { high: candle.high, low: candle.low, close: candle.close });

      // Lay indicators da duoc cap nhat
      const indicators = getOrCreateIndicators(symbol);

      // Xu ly tung position
      for (const pos of positions) {
        try {
          const result = calculateDynamicSL(pos, candle, indicators);

          if (!result.changed) continue;

          // Update stop loss trong DB
          await Position.update(pos.id, { stopLoss: result.newSL });

          // Log vao ExecutionLog
          await ExecutionLog.write({
            entityType:   'POSITION',
            entityId:     pos.id,
            portfolioId:  pos.portfolio_id,
            eventType:    'DYNAMIC_SL_UPDATE',
            triggerPrice: result.oldSL,
            fillPrice:    result.newSL,
            metadata: {
              old_sl:     result.oldSL,
              new_sl:     result.newSL,
              regime:     result.regime,
              atr_value:  result.atrValue,
              multiplier: result.multiplier,
              reason:     result.reason,
            },
            workerRunId,
          });

          // Generate narrative va broadcast via WebSocket
          try {
            const narrative = await generateSLNarrative({
              symbol:     pos.symbol,
              oldSL:      result.oldSL,
              newSL:      result.newSL,
              atrValue:   result.atrValue,
              regime:     result.regime,
              multiplier: result.multiplier,
            });

            const { broadcastPortfolioUpdate } = await import('../services/websocket.js');
            broadcastPortfolioUpdate(pos.portfolio_id, {
              type:        'dynamic_sl_updated',
              position_id: pos.id,
              symbol:      pos.symbol,
              old_sl:      result.oldSL,
              new_sl:      result.newSL,
              regime:      result.regime,
              atr_value:   result.atrValue,
              multiplier:  result.multiplier,
              narrative,
            });
          } catch (wsErr) {
            console.error(`[DynamicSL] WebSocket broadcast error for ${pos.symbol}:`, wsErr.message);
          }

          console.log(`[DynamicSL] ${pos.symbol} (${pos.id.slice(0, 8)}) SL: ${result.oldSL} → ${result.newSL} [${result.regime}]`);
        } catch (posErr) {
          console.error(`[DynamicSL] Error processing position ${pos.id}:`, posErr.message);
        }
      }
    }));
  }
}

// ─── startWorker — gọi từ index.js (DB đã kết nối) ───────────────────────────

export function startWorker() {
  loadTrailingHWM().catch(err => console.error('[Worker] loadTrailingHWM error:', err.message));

  console.log(`[Worker v2] Stop-Loss Monitor started. CHECK_CRON: ${CHECK_CRON}`);

  cron.schedule(CHECK_CRON, async () => {
    if (!isMarketOpen()) return;
    try {
      await checkAndClosePositions();
    } catch (err) {
      console.error('[Worker] checkAndClosePositions error:', err.message);
    }
  });

  cron.schedule(ALERT_CRON, async () => {
    if (!isMarketOpen()) return;
    try {
      await checkSmartAlerts();
    } catch (err) {
      console.error('[Worker] checkSmartAlerts error:', err.message);
    }
  });

  cron.schedule(DYNAMIC_SL_CRON, async () => {
    try {
      await recalculateDynamicSLJob();
    } catch (err) {
      console.error('[Worker] recalculateDynamicSLJob error:', err.message);
    }
  });
}

// ─── Standalone entry point (npm run worker:stoploss) ─────────────────────────

async function run() {
  const ok = await testConnection();
  if (!ok) { console.error('DB connection failed'); process.exit(1); }
  startWorker();
}

// Chỉ auto-run khi được gọi trực tiếp (không phải import)
if (process.argv[1] && process.argv[1].endsWith('stopLossMonitor.js')) {
  run();
}
