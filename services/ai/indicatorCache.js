/**
 * Indicator Cache — Streaming indicator cache per symbol.
 *
 * Moi symbol co mot set indicators rieng: ATR(14), BollingerBands(20, 2), SMA(50), SMA(200).
 * Cache TTL: 30 phut. Stale entries bi xoa khi getter duoc goi.
 */

import { ATR, BollingerBands, SMA } from 'trading-signals';

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 phut cho indicators
const REGIME_CACHE_TTL_MS = 60 * 60 * 1000; // 60 phut cho regime (khong goi Gemini lien tuc)

/** @type {Map<string, {atr: ATR, bb: BollingerBands, sma50: SMA, sma200: SMA, lastUpdate: number, regime: string|null, regimeTimestamp: number|null}>} */
const cache = new Map();

/**
 * Lay hoac tao indicators cho mot symbol.
 * @param {string} symbol - Ma co phieu, e.g. 'VCB'
 * @param {number} [period=14] - Period cho ATR (hien tai khong dung, de mo rong sau)
 * @returns {{ atr: ATR, bb: BollingerBands, sma50: SMA, sma200: SMA, lastUpdate: number, regime: string|null, regimeTimestamp: number|null }}
 */
export function getOrCreateIndicators(symbol, period = 14) {
  const now = Date.now();

  // Xoa entry stale (chi xoa khi indicators het han, regime co TTL rieng 60 phut)
  const existing = cache.get(symbol);
  if (existing) {
    if (now - existing.lastUpdate > CACHE_TTL_MS) {
      // Indicators het han — xoa entry nhung giu lai regime neu con trong TTL 60 phut
      const regimeStillValid =
        existing.regime != null &&
        existing.regimeTimestamp != null &&
        now - existing.regimeTimestamp < REGIME_CACHE_TTL_MS;

      if (regimeStillValid) {
        // Reset indicators nhung giu regime cu
        const newEntry = {
          atr: new ATR(period),
          bb: new BollingerBands(20, 2),
          sma50: new SMA(50),
          sma200: new SMA(200),
          lastUpdate: now,
          regime: existing.regime,
          regimeTimestamp: existing.regimeTimestamp,
        };
        cache.set(symbol, newEntry);
        return newEntry;
      }

      cache.delete(symbol);
    } else {
      return existing;
    }
  }

  const entry = {
    atr: new ATR(period),
    bb: new BollingerBands(20, 2),
    sma50: new SMA(50),
    sma200: new SMA(200),
    lastUpdate: now,
    regime: null,
    regimeTimestamp: null,
  };

  cache.set(symbol, entry);
  return entry;
}

/**
 * Feed mot candle moi vao tat ca indicators cua symbol.
 * @param {string} symbol
 * @param {{ high: number, low: number, close: number }} candle
 */
export function feedCandle(symbol, candle) {
  const indicators = getOrCreateIndicators(symbol);
  const { high, low, close } = candle;

  indicators.atr.update({ high, low, close });
  indicators.bb.update(close);
  indicators.sma50.update(close);
  indicators.sma200.update(close);
  indicators.lastUpdate = Date.now();
}

/**
 * Xoa toan bo cache (dung cho testing).
 */
export function clearCache() {
  cache.clear();
}
