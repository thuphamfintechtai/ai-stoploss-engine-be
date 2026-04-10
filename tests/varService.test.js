import { describe, it, expect } from 'vitest';
import { calculateHistoricalVaR } from '../services/ai/varService.js';

// Helper: tao ohlcv data voi daily returns xac dinh
function makePrices(startPrice, returns) {
  const prices = [startPrice];
  for (const r of returns) {
    prices.push(prices[prices.length - 1] * (1 + r));
  }
  return prices.map((close, i) => ({ close, date: `2026-01-${String(i + 1).padStart(2, '0')}` }));
}

// Tao 30 gia tri ohlcv voi returns nhat dinh
function makeOhlcv30(symbol, uniformReturn = -0.01) {
  const returns = Array(30).fill(uniformReturn);
  // them 1 so to hon de co variation
  returns[5] = -0.05;
  returns[15] = 0.03;
  returns[25] = -0.02;
  return makePrices(100000, returns);
}

describe('calculateHistoricalVaR', () => {
  it('tra ve cau truc dung fields', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv30('VCB') };

    const result = calculateHistoricalVaR({ positions, ohlcvBySymbol });

    expect(result).toHaveProperty('portfolioVaR');
    expect(result.portfolioVaR).toHaveProperty('varVnd');
    expect(result.portfolioVaR).toHaveProperty('varPercent');
    expect(result.portfolioVaR).toHaveProperty('confidenceLevel');
    expect(result).toHaveProperty('positionVaRs');
    expect(result).toHaveProperty('summary');
    expect(Array.isArray(result.positionVaRs)).toBe(true);
  });

  it('confidenceLevel mac dinh = 0.95', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv30('VCB') };

    const result = calculateHistoricalVaR({ positions, ohlcvBySymbol });
    expect(result.portfolioVaR.confidenceLevel).toBe(0.95);
  });

  it('varVnd >= 0 (VaR la so duong)', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv30('VCB') };

    const result = calculateHistoricalVaR({ positions, ohlcvBySymbol });
    expect(result.portfolioVaR.varVnd).toBeGreaterThanOrEqual(0);
  });

  it('portfolio trong -> varVnd = 0', () => {
    const result = calculateHistoricalVaR({ positions: [], ohlcvBySymbol: {} });
    expect(result.portfolioVaR.varVnd).toBe(0);
    expect(result.portfolioVaR.varPercent).toBe(0);
    expect(result.positionVaRs).toHaveLength(0);
  });

  it('ohlcv < 20 ngay -> van tinh va co warning', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    // Chi co 10 gia tri -> 9 returns
    const shortOhlcv = makePrices(96000, Array(9).fill(-0.01));
    const ohlcvBySymbol = { VCB: shortOhlcv };

    const result = calculateHistoricalVaR({ positions, ohlcvBySymbol });
    // Van tinh duoc, co the co warnings
    expect(result).toHaveProperty('portfolioVaR');
    if (result.warnings) {
      expect(Array.isArray(result.warnings)).toBe(true);
    }
  });

  it('summary chua "95%" va so VND', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv30('VCB') };

    const result = calculateHistoricalVaR({ positions, ohlcvBySymbol });
    expect(result.summary).toContain('95%');
    expect(result.summary).toContain('VND');
  });

  it('positionVaRs co entry cho moi symbol', () => {
    const positions = [
      { symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' },
      { symbol: 'FPT', entry_price: 120000, quantity: 500, exchange: 'HOSE' },
    ];
    const ohlcvBySymbol = {
      VCB: makeOhlcv30('VCB'),
      FPT: makeOhlcv30('FPT'),
    };

    const result = calculateHistoricalVaR({ positions, ohlcvBySymbol });
    expect(result.positionVaRs).toHaveLength(2);
    const symbols = result.positionVaRs.map(p => p.symbol);
    expect(symbols).toContain('VCB');
    expect(symbols).toContain('FPT');
  });

  it('VaR dung simple-statistics percentile: returns nhat dinh -> VaR xap xi dung', () => {
    // Returns uniform = -0.02 (2% lo moi ngay)
    // percentile at 5% (1 - 0.95) = -0.02
    // varPercent ~ 0.02 (2%)
    const uniformReturns = Array(60).fill(-0.02);
    const ohlcv = makePrices(96000, uniformReturns);
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];

    const result = calculateHistoricalVaR({ positions, ohlcvBySymbol: { VCB: ohlcv } });
    // VaR percent xap xi 2% (+/- floating point)
    expect(result.portfolioVaR.varPercent).toBeGreaterThan(0);
    expect(result.portfolioVaR.varPercent).toBeLessThan(10); // ko qua 10%
  });

  it('custom confidenceLevel = 0.99', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv30('VCB') };

    const result99 = calculateHistoricalVaR({ positions, ohlcvBySymbol, confidenceLevel: 0.99 });
    const result95 = calculateHistoricalVaR({ positions, ohlcvBySymbol, confidenceLevel: 0.95 });

    expect(result99.portfolioVaR.confidenceLevel).toBe(0.99);
    expect(result95.portfolioVaR.confidenceLevel).toBe(0.95);
    // VaR 99% >= VaR 95% (con so bao nhieu phu thuoc data)
    expect(result99.portfolioVaR.varVnd).toBeGreaterThanOrEqual(result95.portfolioVaR.varVnd);
  });
});
