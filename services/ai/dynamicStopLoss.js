/**
 * Dynamic Stop Loss Service
 *
 * Tinh toan SL dong dua tren ATR streaming + regime-adaptive multiplier.
 * Trailing stop chi duoc di chuyen co loi cho user:
 *   - LONG: SL chi tang (tighten stop tu phia duoi)
 *   - SHORT: SL chi giam (tighten stop tu phia tren)
 *
 * Per D-01, D-03, D-06, D-07.
 */

import { detectRegime, REGIME_MULTIPLIERS } from './regimeDetector.js';
import { clampToBand } from '../shared/priceBandValidator.js';
import { snapToTickSize } from '../tickSizeEngine.js';
import { callGeminiJSON } from '../aiService.js';

// Timeout Gemini 5 giac per D-07
const GEMINI_TIMEOUT_MS = 5000;

/**
 * Tinh toan Stop Loss dong dua tren ATR va regime.
 *
 * @param {{ id: string, symbol: string, side?: string, stop_loss: number, exchange?: string }} position
 * @param {{ high: number, low: number, close: number }} candle
 * @param {{ atr: { getResult: () => number }, bb: object, sma50: object, sma200: object }} indicators
 * @returns {{ newSL: number, oldSL: number, regime: string, atrValue: number, multiplier: number, changed: boolean, reason: string }}
 */
export function calculateDynamicSL(position, candle, indicators) {
  const isLong = (position.side ?? 'LONG') === 'LONG';
  const currentSL = parseFloat(position.stop_loss);
  const exchange = position.exchange ?? 'HOSE';

  // Phat hien regime thi truong hien tai
  const regime = detectRegime(indicators);
  const multiplier = REGIME_MULTIPLIERS[regime];

  // Lay ATR hien tai tu streaming cache
  const atrValue = Number(indicators.atr.getResult());

  // Tinh SL moi dua tren close price va ATR
  let computedSL;
  if (isLong) {
    // LONG: SL nam duoi gia dong cua
    computedSL = candle.close - atrValue * multiplier;
  } else {
    // SHORT: SL nam tren gia dong cua
    computedSL = candle.close + atrValue * multiplier;
  }

  // Clamp SL trong bien do gia giao dong cua san (7% HOSE, 10% HNX, ...)
  // Su dung close price lam reference price
  computedSL = clampToBand(computedSL, candle.close, exchange);

  // Snap ve tick size hop le
  computedSL = snapToTickSize(computedSL, exchange);

  // Trailing logic: chi di chuyen co loi cho user
  let newSL;
  if (isLong) {
    // LONG: chi tang SL (khong bao gio ha xuong)
    newSL = Math.max(computedSL, currentSL);
  } else {
    // SHORT: chi giam SL (khong bao gio tang len)
    newSL = Math.min(computedSL, currentSL);
  }

  const changed = newSL !== currentSL;

  const reason = changed
    ? `ATR=${atrValue}, regime=${regime}, multiplier=${multiplier}x`
    : 'Trailing stop khong thay doi (computed SL khong co loi hon currentSL)';

  return {
    newSL,
    oldSL: currentSL,
    regime,
    atrValue,
    multiplier,
    changed,
    reason,
  };
}

/**
 * Tao narrative ve su thay doi SL bang Gemini.
 * Timeout 5 giay — fallback sang generateFallbackNarrative.
 *
 * @param {{ symbol: string, oldSL: number, newSL: number, atrValue: number, regime: string, multiplier: number }} data
 * @returns {Promise<string>}
 */
export async function generateSLNarrative(data) {
  const prompt = `Ban la expert phan tich ky thuat cho thi truong chung khoan Viet Nam.

Hay giai thich ngan gon (2-3 cau) bang tieng Viet tai sao Stop Loss cua vi the ${data.symbol} duoc dieu chinh.

Thong tin:
- Stop Loss cu: ${data.oldSL?.toLocaleString('vi-VN')} VND
- Stop Loss moi: ${data.newSL?.toLocaleString('vi-VN')} VND
- ATR hien tai: ${data.atrValue} VND
- Regime thi truong: ${data.regime}
- Multiplier: ${data.multiplier}x

Tra loi JSON: { "narrative": "giai thich bang tieng Viet" }`;

  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini timeout')), GEMINI_TIMEOUT_MS)
    );

    const geminiCall = callGeminiJSON(prompt);
    const result = await Promise.race([geminiCall, timeout]);

    if (result?.narrative && typeof result.narrative === 'string') {
      return { narrative: result.narrative, ai_source: 'gemini' };
    }

    // Fallback neu response khong hop le
    return { narrative: generateFallbackNarrative(data), ai_source: 'rule-based' };
  } catch (_err) {
    return { narrative: generateFallbackNarrative(data), ai_source: 'rule-based' };
  }
}

/**
 * Tao narrative rule-based khi Gemini khong kha dung.
 *
 * @param {{ oldSL: number, newSL: number, atrValue: number, regime: string, multiplier: number }} data
 * @returns {string}
 */
export function generateFallbackNarrative(data) {
  const { oldSL, newSL, atrValue, regime, multiplier } = data;

  const regimeExtras = {
    VOLATILE: 'Thi truong dang bien dong manh, trailing stop duoc mo rong de tranh bi bat dung som.',
    BULLISH: 'Xu huong tang gia, trailing stop duoc siet chat de bao ve loi nhuan.',
    BEARISH: 'Xu huong giam gia, trailing stop duoc dieu chinh phu hop xu huong.',
    SIDEWAYS: 'Thi truong di ngang, trailing stop gia tri toi thieu.',
  };

  const extra = regimeExtras[regime] ?? '';

  return (
    `Stop Loss dieu chinh ${oldSL} -> ${newSL}. ` +
    `Ly do: ATR hien tai ${atrValue} VND, regime ${regime} (multiplier ${multiplier}x). ` +
    extra
  );
}
