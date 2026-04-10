import { describe, it, expect, beforeEach } from 'vitest';
import { detectRegime, REGIME_MULTIPLIERS } from '../../services/ai/regimeDetector.js';
import { getOrCreateIndicators, feedCandle, clearCache } from '../../services/ai/indicatorCache.js';
import { getFloorPrice, getCeilingPrice, clampToBand } from '../../services/shared/priceBandValidator.js';
import { createMockIndicators } from '../helpers/indicatorMocks.js';

// ============================================================
// detectRegime
// ============================================================
describe('detectRegime', () => {
  it('tra ve SIDEWAYS khi bb.isStable = false', () => {
    const indicators = createMockIndicators({ bb: { isStable: false } });
    expect(detectRegime(indicators)).toBe('SIDEWAYS');
  });

  it('tra ve SIDEWAYS khi sma50.isStable = false', () => {
    const indicators = createMockIndicators({ sma50: { isStable: false } });
    expect(detectRegime(indicators)).toBe('SIDEWAYS');
  });

  it('tra ve VOLATILE khi BB percentile > 70', () => {
    // bbPercentile = (upper - lower) / middle * 100
    // (upper=200, lower=0, middle=100) -> 200/100*100 = 200 > 70
    const indicators = createMockIndicators({
      bb: { isStable: true, result: { upper: 200, lower: 0, middle: 100 } },
    });
    expect(detectRegime(indicators)).toBe('VOLATILE');
  });

  it('tra ve BULLISH khi sma50 > sma200', () => {
    // BB percentile nho: (30100 - 29900) / 30000 * 100 = 0.67 < 70
    const indicators = createMockIndicators({
      bb: { isStable: true, result: { upper: 30100, lower: 29900, middle: 30000 } },
      sma50: { isStable: true, result: 31000 },
      sma200: { isStable: true, result: 28000 },
    });
    expect(detectRegime(indicators)).toBe('BULLISH');
  });

  it('tra ve BEARISH khi sma50 < sma200', () => {
    const indicators = createMockIndicators({
      bb: { isStable: true, result: { upper: 30100, lower: 29900, middle: 30000 } },
      sma50: { isStable: true, result: 26000 },
      sma200: { isStable: true, result: 29000 },
    });
    expect(detectRegime(indicators)).toBe('BEARISH');
  });

  it('tra ve SIDEWAYS khi sma200 chua stable va BB percentile <= 70', () => {
    const indicators = createMockIndicators({
      bb: { isStable: true, result: { upper: 30100, lower: 29900, middle: 30000 } },
      sma50: { isStable: true, result: 30000 },
      sma200: { isStable: false, result: 29000 },
    });
    expect(detectRegime(indicators)).toBe('SIDEWAYS');
  });
});

// ============================================================
// REGIME_MULTIPLIERS
// ============================================================
describe('REGIME_MULTIPLIERS', () => {
  it('VOLATILE multiplier = 2.5', () => {
    expect(REGIME_MULTIPLIERS.VOLATILE).toBe(2.5);
  });

  it('BULLISH multiplier = 1.5', () => {
    expect(REGIME_MULTIPLIERS.BULLISH).toBe(1.5);
  });

  it('BEARISH multiplier = 1.5', () => {
    expect(REGIME_MULTIPLIERS.BEARISH).toBe(1.5);
  });

  it('SIDEWAYS multiplier = 1.0', () => {
    expect(REGIME_MULTIPLIERS.SIDEWAYS).toBe(1.0);
  });
});

// ============================================================
// indicatorCache
// ============================================================
describe('indicatorCache', () => {
  beforeEach(() => {
    clearCache();
  });

  it('getOrCreateIndicators tao moi entry cho symbol chua co', () => {
    const indicators = getOrCreateIndicators('VCB');
    expect(indicators).toBeDefined();
    expect(indicators.bb).toBeDefined();
    expect(indicators.sma50).toBeDefined();
    expect(indicators.sma200).toBeDefined();
    expect(indicators.atr).toBeDefined();
  });

  it('getOrCreateIndicators tra ve cached entry cho same symbol', () => {
    const first = getOrCreateIndicators('TCB');
    const second = getOrCreateIndicators('TCB');
    expect(first).toBe(second);
  });

  it('getOrCreateIndicators tao entry rieng cho symbol khac nhau', () => {
    const vcb = getOrCreateIndicators('VCB');
    const tcb = getOrCreateIndicators('TCB');
    expect(vcb).not.toBe(tcb);
  });

  it('feedCandle khong throw error', () => {
    expect(() =>
      feedCandle('VCB', { high: 96000, low: 94000, close: 95000 })
    ).not.toThrow();
  });

  it('feedCandle update lastUpdate', () => {
    const before = Date.now();
    feedCandle('HPG', { high: 26000, low: 25000, close: 25500 });
    const indicators = getOrCreateIndicators('HPG');
    expect(indicators.lastUpdate).toBeGreaterThanOrEqual(before);
  });
});

// ============================================================
// priceBandValidator
// ============================================================
describe('priceBandValidator - HOSE', () => {
  it('getFloorPrice HOSE = refPrice * 0.93 (snap to tick)', () => {
    // refPrice = 100000 HOSE -> floor = 93000, tick = 100 -> snap = 93000
    const floor = getFloorPrice(100000, 'HOSE');
    expect(floor).toBe(93000);
  });

  it('getCeilingPrice HOSE = refPrice * 1.07 (snap to tick)', () => {
    // refPrice = 100000 HOSE -> ceiling = 107000, tick = 100 -> snap = 107000
    const ceiling = getCeilingPrice(100000, 'HOSE');
    expect(ceiling).toBe(107000);
  });

  it('clampToBand price < floor -> tra ve floor', () => {
    const clamped = clampToBand(80000, 100000, 'HOSE');
    expect(clamped).toBe(93000);
  });

  it('clampToBand price > ceiling -> tra ve ceiling', () => {
    const clamped = clampToBand(120000, 100000, 'HOSE');
    expect(clamped).toBe(107000);
  });

  it('clampToBand price trong bien do -> giu nguyen (snap tick)', () => {
    const clamped = clampToBand(100000, 100000, 'HOSE');
    expect(clamped).toBe(100000);
  });
});

describe('priceBandValidator - HNX', () => {
  it('getFloorPrice HNX = refPrice * 0.90', () => {
    const floor = getFloorPrice(100000, 'HNX');
    expect(floor).toBe(90000);
  });

  it('getCeilingPrice HNX = refPrice * 1.10', () => {
    const ceiling = getCeilingPrice(100000, 'HNX');
    expect(ceiling).toBe(110000);
  });

  it('clampToBand HNX: price < floor -> floor', () => {
    const clamped = clampToBand(80000, 100000, 'HNX');
    expect(clamped).toBe(90000);
  });

  it('clampToBand HNX: price > ceiling -> ceiling', () => {
    const clamped = clampToBand(120000, 100000, 'HNX');
    expect(clamped).toBe(110000);
  });
});
