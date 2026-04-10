import { describe, it, expect } from 'vitest';
import { calculateTPProbabilities } from '../../services/ai/probabilityTP.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Tao mock OHLCV data voi closes tang nhe ~0.1%/day + noise
 * De sigma > 0 (can thiet cho log-normal distribution)
 * @param {number} count - So nen
 * @param {number} startPrice - Gia ban dau
 */
function generateMockOHLCV(count, startPrice = 25000) {
  const candles = [];
  let price = startPrice;
  // Dung seed de tao noise co dinh (reproducible)
  const noisePattern = [0.015, -0.008, 0.022, -0.011, 0.018, -0.005, 0.012, -0.019, 0.007, -0.003];
  for (let i = 0; i < count; i++) {
    const noise = noisePattern[i % noisePattern.length]; // ~1-2% noise
    price = price * (1 + 0.001 + noise); // +0.1%/ngay + noise
    candles.push({
      timestamp: Date.now() - (count - i) * 86400000,
      open: price * 0.999,
      high: price * 1.005,
      low: price * 0.995,
      close: price,
      volume: 1000000
    });
  }
  return candles;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('calculateTPProbabilities', () => {
  it('tra ve null khi ohlcvData empty', () => {
    const result = calculateTPProbabilities([], 25000);
    expect(result).toBeNull();
  });

  it('tra ve null khi ohlcvData.length < 60', () => {
    const data = generateMockOHLCV(59, 25000);
    const result = calculateTPProbabilities(data, 25000);
    expect(result).toBeNull();
  });

  it('tra ve null voi chinh xac 59 candles', () => {
    const data = generateMockOHLCV(59, 25000);
    expect(calculateTPProbabilities(data, 25000)).toBeNull();
  });

  it('tra ve object hop le voi 100 candles', () => {
    const data = generateMockOHLCV(100, 25000);
    const result = calculateTPProbabilities(data, 25000);
    expect(result).not.toBeNull();
    expect(typeof result).toBe('object');
  });

  it('tra ve levels la array', () => {
    const data = generateMockOHLCV(100, 25000);
    const result = calculateTPProbabilities(data, 25000);
    expect(Array.isArray(result.levels)).toBe(true);
  });

  it('levels co 3-5 items', () => {
    const data = generateMockOHLCV(100, 25000);
    const result = calculateTPProbabilities(data, 25000);
    expect(result.levels.length).toBeGreaterThanOrEqual(3);
    expect(result.levels.length).toBeLessThanOrEqual(5);
  });

  it('moi level co price la number > currentPrice', () => {
    const currentPrice = 25000;
    const data = generateMockOHLCV(100, currentPrice);
    const result = calculateTPProbabilities(data, currentPrice);
    for (const level of result.levels) {
      expect(typeof level.price).toBe('number');
      expect(level.price).toBeGreaterThan(currentPrice);
    }
  });

  it('moi level co probability la number trong khoang 1-100', () => {
    const data = generateMockOHLCV(100, 25000);
    const result = calculateTPProbabilities(data, 25000);
    for (const level of result.levels) {
      expect(typeof level.probability).toBe('number');
      expect(level.probability).toBeGreaterThanOrEqual(1);
      expect(level.probability).toBeLessThanOrEqual(100);
    }
  });

  it('moi level co timeframe_days la number', () => {
    const data = generateMockOHLCV(100, 25000);
    const result = calculateTPProbabilities(data, 25000);
    for (const level of result.levels) {
      expect(typeof level.timeframe_days).toBe('number');
    }
  });

  it('moi level co label la string', () => {
    const data = generateMockOHLCV(100, 25000);
    const result = calculateTPProbabilities(data, 25000);
    for (const level of result.levels) {
      expect(typeof level.label).toBe('string');
      expect(level.label.length).toBeGreaterThan(0);
    }
  });

  it('experimental === true', () => {
    const data = generateMockOHLCV(100, 25000);
    const result = calculateTPProbabilities(data, 25000);
    expect(result.experimental).toBe(true);
  });

  it('data_quality.days_used bang so closes', () => {
    const data = generateMockOHLCV(100, 25000);
    const result = calculateTPProbabilities(data, 25000);
    expect(result.data_quality).toBeDefined();
    expect(result.data_quality.days_used).toBe(100);
  });

  it('data_quality co mu_daily va sigma_daily la number', () => {
    const data = generateMockOHLCV(100, 25000);
    const result = calculateTPProbabilities(data, 25000);
    expect(typeof result.data_quality.mu_daily).toBe('number');
    expect(typeof result.data_quality.sigma_daily).toBe('number');
  });

  it('tra ve null voi 60 candles (< 60 la null, >= 60 la hop le)', () => {
    const data60 = generateMockOHLCV(60, 25000);
    const result = calculateTPProbabilities(data60, 25000);
    // 60 candles -> 59 log returns -> du lieu hop le
    expect(result).not.toBeNull();
  });

  it('label co chu "ngay" tieng Viet', () => {
    const data = generateMockOHLCV(100, 25000);
    const result = calculateTPProbabilities(data, 25000);
    for (const level of result.levels) {
      expect(level.label).toMatch(/ngay/);
    }
  });
});
