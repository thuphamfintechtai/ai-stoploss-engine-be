/**
 * fallbackSuggestor — Rule-based fallback khi Gemini timeout/fail.
 *
 * Requirement: AIT-07 (D-07 trong 04-CONTEXT.md).
 * Threats mitigated:
 *   - T-04-07 DoS: Gemini timeout → FE không được trắng
 *   - T-04-08 Tampering: Fallback response shape khác Gemini → FE crash
 *
 * Output MUST match signalSchema / sltpSchema (validate ở 04-01)
 * để đi qua validateAiResponse không reject.
 *
 * Chiến lược:
 *   - Tính ATR14 từ OHLCV raw (local copy, không import từ aiService.js để tránh circular)
 *   - SL/TP = ATR × multiplier (moderate 1.5, RR 1:2 cho signal; 3 mức cho sltp)
 *   - Snap tick theo sàn (snapToTick từ vnMarketRules)
 *   - Graceful khi < 14 nến: fallback % fixed (SL -7%, TP +7% cho LONG)
 *   - Tag `source: 'rule-based-fallback'` + `ai_source: 'rule-based'` (backward compat FE)
 */

import { snapToTick } from '../shared/vnMarketRules.js';

const MIN_CANDLES_FOR_ATR = 14;
const DEFAULT_CONFIDENCE = 45; // mid-low vì rule-based, không như Gemini
const DEFAULT_ATR_MULTIPLIER = 1.5; // moderate
const DEFAULT_RR_RATIO = 2;

const DISCLAIMER_TEXT =
  'Đây là phân tích kỹ thuật tham khảo dựa trên ATR và vùng hỗ trợ/kháng cự. ' +
  'KHÔNG phải khuyến nghị đầu tư. Quyết định cuối cùng thuộc về nhà đầu tư.';

/**
 * Tính ATR14 local (copy logic từ aiService.calcATR để tránh circular import).
 * @param {Array<{high:number, low:number, close:number}>} candles
 * @param {number} [period=14]
 * @returns {number|null}
 */
function calcATRLocal(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) return null;
  const trueRanges = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low - prev.close)
    );
  });
  return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/**
 * Tính MA đơn giản cho N nến gần nhất.
 */
function calcMA(candles, period) {
  if (!Array.isArray(candles) || candles.length < period) return null;
  const closes = candles.slice(-period).map(c => c.close).filter(v => v != null);
  if (closes.length === 0) return null;
  return closes.reduce((a, b) => a + b, 0) / closes.length;
}

/**
 * Snap giá dương về tick hợp lệ, bảo đảm ≥ 100 (min VND trong test).
 */
function safeSnap(priceRaw, exchange) {
  const rounded = Math.max(100, Math.round(priceRaw));
  return snapToTick(rounded, exchange, 'nearest');
}

/**
 * Quyết định action dựa trên MA20 (rule đơn giản, không Gemini).
 */
function decideAction(currentPrice, ma20) {
  if (ma20 == null) return 'HOLD';
  if (currentPrice > ma20) return 'BUY';
  if (currentPrice < ma20 * 0.98) return 'SELL';
  return 'HOLD';
}

/**
 * Generate fallback signal — output match signalSchema.
 *
 * @param {object} params
 * @param {string} params.symbol
 * @param {string} [params.exchange='HOSE']
 * @param {number} params.currentPrice
 * @param {Array}  params.ohlcvData
 * @param {'LONG'|'SHORT'} [params.side='LONG']
 * @returns {object} Signal payload + source/ai_source tags
 */
export function generateFallbackSignal({
  symbol,
  exchange = 'HOSE',
  currentPrice,
  ohlcvData = [],
  side = 'LONG',
}) {
  const candles = Array.isArray(ohlcvData) ? ohlcvData : [];
  const atr14 = calcATRLocal(candles, 14);
  const ma20 = calcMA(candles, 20);
  const action = decideAction(currentPrice, ma20);

  let stopLoss;
  let takeProfit;
  let reason;

  if (atr14 != null && atr14 > 0) {
    // Đủ data ATR — tính SL/TP theo ATR × multiplier
    const mult = DEFAULT_ATR_MULTIPLIER;
    const rr = DEFAULT_RR_RATIO;
    if (side === 'LONG') {
      stopLoss = currentPrice - atr14 * mult;
      takeProfit = currentPrice + atr14 * mult * rr;
    } else {
      stopLoss = currentPrice + atr14 * mult;
      takeProfit = currentPrice - atr14 * mult * rr;
    }
    reason =
      `Fallback rule-based: ATR14 = ${Math.round(atr14).toLocaleString('vi-VN')}đ, ` +
      `SL cách ${mult} ATR, TP theo R:R 1:${rr}. Gemini tạm không khả dụng.`;
  } else {
    // Không đủ data — dùng % fixed 7%
    const pct = 0.07;
    if (side === 'LONG') {
      stopLoss = currentPrice * (1 - pct);
      takeProfit = currentPrice * (1 + pct);
    } else {
      stopLoss = currentPrice * (1 + pct);
      takeProfit = currentPrice * (1 - pct);
    }
    reason =
      `Fallback rule-based: Không đủ dữ liệu ATR (${candles.length}/${MIN_CANDLES_FOR_ATR} nến), ` +
      `dùng SL/TP ±${(pct * 100).toFixed(0)}% giá hiện tại. Gemini tạm không khả dụng.`;
  }

  // Snap tick + clamp dương
  const stopLossSnapped = safeSnap(stopLoss, exchange);
  const takeProfitSnapped = safeSnap(takeProfit, exchange);
  const entrySnapped = safeSnap(currentPrice, exchange);

  // Volume confirmation đơn giản
  const lastVol = candles.length > 0 ? (candles[candles.length - 1]?.volume ?? 0) : 0;
  const avgVol = candles.length >= 20
    ? candles.slice(-20).reduce((s, c) => s + (c.volume || 0), 0) / 20
    : 0;
  const volumeConfirmation = avgVol > 0 ? lastVol > avgVol * 0.8 : false;

  // Trend rule-based từ MA
  let trend = 'SIDEWAYS';
  if (ma20 != null) {
    if (currentPrice > ma20 * 1.02) trend = 'BULLISH';
    else if (currentPrice < ma20 * 0.98) trend = 'BEARISH';
  }

  return {
    action,
    entry_price: entrySnapped,
    stop_loss: stopLossSnapped,
    take_profit: takeProfitSnapped,
    confidence_score: DEFAULT_CONFIDENCE,
    timeframe: 'short',
    reason,
    technical_context: {
      trend,
      momentum: 'MODERATE',
      volume_confirmation: volumeConfirmation,
      key_pattern: atr14 != null ? 'ATR-based' : 'Fixed-pct',
    },
    risk_level: 'MEDIUM',
    expiry_hours: 24,
    source: 'rule-based-fallback',
    ai_source: 'rule-based', // backward compat FE
  };
}

/**
 * Generate fallback SL/TP suggestions — output match sltpSchema.
 * 3 mức aggressive/moderate/conservative dựa trên ATR multiplier 1.0 / 1.5 / 2.0.
 *
 * @param {object} params
 * @param {string} params.symbol
 * @param {string} [params.exchange='HOSE']
 * @param {number} params.currentPrice
 * @param {Array}  params.ohlcvData
 * @param {number} [params.rrRatio=2]
 * @param {'LONG'|'SHORT'} [params.side='LONG']
 * @returns {object} SLTP payload match sltpSchema
 */
export function generateFallbackSLTP({
  symbol,
  exchange = 'HOSE',
  currentPrice,
  ohlcvData = [],
  rrRatio = DEFAULT_RR_RATIO,
  side = 'LONG',
}) {
  const candles = Array.isArray(ohlcvData) ? ohlcvData : [];
  const atr14 = calcATRLocal(candles, 14) ?? 0;

  // Support/resistance đơn giản từ swing low/high
  const recent = candles.slice(-20);
  const lows = recent.map(c => c.low).filter(Boolean).sort((a, b) => a - b);
  const highs = recent.map(c => c.high).filter(Boolean).sort((a, b) => b - a);
  const supports = [...new Set(lows.slice(0, 3).map(v => Math.round(v)))];
  const resistances = [...new Set(highs.slice(0, 3).map(v => Math.round(v)))];

  const multipliers = { aggressive: 1.0, moderate: 1.5, conservative: 2.0 };
  const labels = {
    aggressive: 'Tích cực',
    moderate: 'Cân bằng',
    conservative: 'Thận trọng',
  };

  // Nếu ATR = 0 (không đủ data), dùng % fallback
  const hasAtr = atr14 > 0;
  const pctFallback = { aggressive: 0.03, moderate: 0.05, conservative: 0.07 };

  const suggestions = Object.entries(multipliers).map(([type, mult]) => {
    let slRaw;
    let tpRaw;
    if (hasAtr) {
      if (side === 'LONG') {
        slRaw = currentPrice - atr14 * mult;
        tpRaw = currentPrice + atr14 * mult * rrRatio;
      } else {
        slRaw = currentPrice + atr14 * mult;
        tpRaw = currentPrice - atr14 * mult * rrRatio;
      }
    } else {
      const pct = pctFallback[type];
      if (side === 'LONG') {
        slRaw = currentPrice * (1 - pct);
        tpRaw = currentPrice * (1 + pct * rrRatio);
      } else {
        slRaw = currentPrice * (1 + pct);
        tpRaw = currentPrice * (1 - pct * rrRatio);
      }
    }

    const stop_loss_vnd = safeSnap(slRaw, exchange);
    const take_profit_vnd = safeSnap(tpRaw, exchange);
    const slDist = Math.abs(currentPrice - stop_loss_vnd);
    const tpDist = Math.abs(take_profit_vnd - currentPrice);
    const actualRR = slDist > 0 ? tpDist / slDist : 0;

    return {
      type,
      label: labels[type],
      stop_loss_vnd,
      take_profit_vnd,
      stop_loss_pct: ((slDist / currentPrice) * 100).toFixed(2),
      take_profit_pct: ((tpDist / currentPrice) * 100).toFixed(2),
      rr_ratio: parseFloat(actualRR.toFixed(2)),
    };
  });

  const analysisText = hasAtr
    ? 'Fallback rule-based: SL/TP tính từ ATR14 × multiplier (1.0x / 1.5x / 2.0x). ' +
      'Gemini tạm không khả dụng — giá vẫn được snap về tick hợp lệ của sàn.'
    : `Fallback rule-based: Không đủ dữ liệu ATR (${candles.length} nến), ` +
      'dùng SL/TP theo % cố định. Gemini tạm không khả dụng.';

  return {
    suggestions,
    technical_score: {
      score: DEFAULT_CONFIDENCE,
      label: 'TRUNG_BINH',
      methodology: hasAtr
        ? `ATR14 = ${Math.round(atr14)}, multiplier [1.0, 1.5, 2.0]x`
        : 'Fallback %: [3%, 5%, 7%]',
    },
    key_levels: {
      support: supports,
      resistance: resistances,
      atr_14: Math.round(atr14),
    },
    analysis_text: analysisText,
    disclaimer: DISCLAIMER_TEXT,
    data_quality: {
      days_available: candles.length,
      is_sufficient: hasAtr,
    },
    source: 'rule-based-fallback',
    ai_source: 'rule-based',
  };
}

export default {
  generateFallbackSignal,
  generateFallbackSLTP,
};
