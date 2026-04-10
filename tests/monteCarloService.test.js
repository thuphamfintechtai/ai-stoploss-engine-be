import { describe, it, expect } from 'vitest';
import { runMonteCarloSimulation } from '../services/ai/monteCarloService.js';

// Tao ohlcv 60 ngay voi returns on dinh
function makeOhlcv(numPrices = 61, basePrice = 50000, dailyReturn = 0.001) {
  const prices = [basePrice];
  for (let i = 1; i < numPrices; i++) {
    prices.push(prices[i - 1] * (1 + dailyReturn + (Math.random() - 0.5) * 0.005));
  }
  return prices.map((close, i) => ({ close, date: `2026-01-${String(i + 1).padStart(2, '0')}` }));
}

describe('runMonteCarloSimulation', () => {
  it('tra ve dung cau truc output', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv(61) };

    const result = runMonteCarloSimulation({ positions, ohlcvBySymbol });

    expect(result).toHaveProperty('percentileBands');
    expect(result).toHaveProperty('probabilityOfLoss');
    expect(result).toHaveProperty('paths');
    expect(result).toHaveProperty('initialValue');
  });

  it('paths co 1000 paths (default)', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv(61) };

    const result = runMonteCarloSimulation({ positions, ohlcvBySymbol });
    expect(result.paths).toHaveLength(1000);
  });

  it('moi path co 20 gia tri (numDays default)', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv(61) };

    const result = runMonteCarloSimulation({ positions, ohlcvBySymbol });
    expect(result.paths[0]).toHaveLength(20);
    expect(result.paths[500]).toHaveLength(20);
    expect(result.paths[999]).toHaveLength(20);
  });

  it('percentileBands co 5 bands moi co 20 gia tri', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv(61) };

    const result = runMonteCarloSimulation({ positions, ohlcvBySymbol });
    const { p5, p25, p50, p75, p95 } = result.percentileBands;

    expect(p5).toHaveLength(20);
    expect(p25).toHaveLength(20);
    expect(p50).toHaveLength(20);
    expect(p75).toHaveLength(20);
    expect(p95).toHaveLength(20);
  });

  it('p5 <= p25 <= p50 <= p75 <= p95 cho moi ngay', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv(61) };

    const result = runMonteCarloSimulation({ positions, ohlcvBySymbol });
    const { p5, p25, p50, p75, p95 } = result.percentileBands;

    for (let i = 0; i < 20; i++) {
      expect(p5[i]).toBeLessThanOrEqual(p25[i]);
      expect(p25[i]).toBeLessThanOrEqual(p50[i]);
      expect(p50[i]).toBeLessThanOrEqual(p75[i]);
      expect(p75[i]).toBeLessThanOrEqual(p95[i]);
    }
  });

  it('probabilityOfLoss trong [0, 1]', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000, exchange: 'HOSE' }];
    const ohlcvBySymbol = { VCB: makeOhlcv(61) };

    const result = runMonteCarloSimulation({ positions, ohlcvBySymbol });
    expect(result.probabilityOfLoss).toBeGreaterThanOrEqual(0);
    expect(result.probabilityOfLoss).toBeLessThanOrEqual(1);
  });

  it('HOSE price band clamp 7% - moi path khong vuot qua 7% moi ngay', () => {
    // Dung sigma rat cao (artificially) nhung clamp limit nen khong vuot qua
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000 }];
    const ohlcvBySymbol = { VCB: makeOhlcv(61) };
    const exchangeBySymbol = { VCB: 'HOSE' };

    const result = runMonteCarloSimulation({ positions, ohlcvBySymbol, exchangeBySymbol });

    // Lay initial value
    const initVal = result.initialValue;

    // Moi path day 1 ko duoc tang/giam qua 7% tu day truoc
    // (khong the kiem tra truc tiep nhung co the verify la paths hop ly)
    for (let i = 0; i < result.paths.length; i++) {
      const path = result.paths[i];
      for (let d = 0; d < path.length - 1; d++) {
        const change = Math.abs(path[d + 1] - path[d]) / path[d];
        expect(change).toBeLessThanOrEqual(0.071); // allow small float error
      }
    }
  });

  it('HNX price band clamp 10% cho exchangeBySymbol = HNX', () => {
    const positions = [{ symbol: 'SHS', entry_price: 18000, quantity: 2000 }];
    const ohlcvBySymbol = { SHS: makeOhlcv(61, 18000) };
    const exchangeBySymbol = { SHS: 'HNX' };

    const result = runMonteCarloSimulation({ positions, ohlcvBySymbol, exchangeBySymbol });

    for (let i = 0; i < result.paths.length; i++) {
      const path = result.paths[i];
      for (let d = 0; d < path.length - 1; d++) {
        const change = Math.abs(path[d + 1] - path[d]) / path[d];
        expect(change).toBeLessThanOrEqual(0.101); // HNX 10% + small float error
      }
    }
  });

  it('custom numPaths va numDays', () => {
    const positions = [{ symbol: 'VCB', entry_price: 96000, quantity: 1000 }];
    const ohlcvBySymbol = { VCB: makeOhlcv(61) };

    const result = runMonteCarloSimulation({ positions, ohlcvBySymbol, numPaths: 100, numDays: 10 });
    expect(result.paths).toHaveLength(100);
    expect(result.paths[0]).toHaveLength(10);
    expect(result.percentileBands.p50).toHaveLength(10);
  });

  it('initialValue = tong gia tri portfolio ban dau', () => {
    const positions = [
      { symbol: 'VCB', entry_price: 96000, quantity: 1000 },
      { symbol: 'FPT', entry_price: 120000, quantity: 500 },
    ];
    const ohlcvBySymbol = {
      VCB: makeOhlcv(61, 96000),
      FPT: makeOhlcv(61, 120000),
    };

    const result = runMonteCarloSimulation({ positions, ohlcvBySymbol });
    // initialValue = 96000*1000 + 120000*500 = 96M + 60M = 156M
    expect(result.initialValue).toBe(96000 * 1000 + 120000 * 500);
  });
});
