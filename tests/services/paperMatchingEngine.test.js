import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock tickSizeEngine truoc khi import PaperMatchingEngine
vi.mock('../../services/shared/tickSizeEngine.js', () => ({
  snapToTickSize: vi.fn((price) => price), // tra ve nguyen gia de test logic chinh
  validatePriceInBand: vi.fn(() => ({ valid: true })),
  default: {
    snapToTickSize: vi.fn((price) => price),
    validatePriceInBand: vi.fn(() => ({ valid: true })),
  },
}));

import PaperMatchingEngine from '../../services/paper/paperMatchingEngine.js';
import { snapToTickSize, validatePriceInBand } from '../../services/shared/tickSizeEngine.js';

beforeEach(() => {
  vi.clearAllMocks();
  snapToTickSize.mockImplementation((price) => price);
  validatePriceInBand.mockReturnValue({ valid: true });
});

// ============================================================
// calculateSlippage
// ============================================================
describe('PaperMatchingEngine.calculateSlippage', () => {
  it('HIGH liquidity tier (avgDailyVolume > 1M): base_spread=0.001, returns slippage > 0', () => {
    const slippage = PaperMatchingEngine.calculateSlippage(25000, 1000, 500000, 'HOSE');
    expect(slippage).toBeGreaterThan(0);
  });

  it('HIGH liquidity tier: base_spread=0.001, volumeImpact small', () => {
    // avgDailyVolume = 2_000_000 (HIGH tier), quantity = 1000
    // volumeImpact = 1000/2000000 = 0.0005
    // slippagePct = 0.001 * (1 + 0.0005) = 0.0010005
    // slippage = Math.round(25000 * 0.0010005) = Math.round(25.0125) = 25
    const slippage = PaperMatchingEngine.calculateSlippage(25000, 1000, 2_000_000, 'HOSE');
    expect(slippage).toBe(25);
  });

  it('LOW liquidity tier (avgDailyVolume <= 100K): base_spread=0.003, higher than HIGH tier', () => {
    const slippageHigh = PaperMatchingEngine.calculateSlippage(25000, 1000, 500_000, 'HOSE');
    const slippageLow = PaperMatchingEngine.calculateSlippage(25000, 1000, 50_000, 'HOSE');
    expect(slippageLow).toBeGreaterThan(slippageHigh);
  });

  it('MEDIUM liquidity tier (100K < avgDailyVolume <= 1M): base_spread=0.002', () => {
    // avgDailyVolume = 500_000 (MEDIUM tier), quantity = 1000
    // volumeImpact = 1000/500000 = 0.002
    // slippagePct = 0.002 * (1 + 0.002) = 0.002004
    // slippage = Math.round(25000 * 0.002004) = Math.round(50.1) = 50
    const slippage = PaperMatchingEngine.calculateSlippage(25000, 1000, 500_000, 'HOSE');
    expect(slippage).toBe(50);
  });

  it('LOW liquidity tier: correct base_spread=0.003', () => {
    // avgDailyVolume = 50_000 (LOW tier), quantity = 1000
    // volumeImpact = 1000/50000 = 0.02
    // slippagePct = 0.003 * (1 + 0.02) = 0.00306
    // slippage = Math.round(25000 * 0.00306) = Math.round(76.5) = 77
    const slippage = PaperMatchingEngine.calculateSlippage(25000, 1000, 50_000, 'HOSE');
    expect(slippage).toBe(77);
  });
});

// ============================================================
// calculateFillProbability
// ============================================================
describe('PaperMatchingEngine.calculateFillProbability', () => {
  it('ratio < 0.001: returns 0.95', () => {
    // orderQty=100, avgDailyVolume=500000 → ratio=0.0002 < 0.001
    const prob = PaperMatchingEngine.calculateFillProbability(100, 500_000);
    expect(prob).toBe(0.95);
  });

  it('ratio = 0.001: returns 0.80 (>= 0.001)', () => {
    // orderQty=500, avgDailyVolume=500000 → ratio=0.001, >= 0.001 -> 0.80
    const prob = PaperMatchingEngine.calculateFillProbability(500, 500_000);
    expect(prob).toBe(0.80);
  });

  it('ratio ~0.05 (0.01 <= ratio < 0.05): returns 0.50', () => {
    // orderQty=25000, avgDailyVolume=500000 → ratio=0.05, >= 0.05 -> 0.25? No...
    // 0.01 <= ratio < 0.05 → 0.50
    // ratio=0.02: orderQty=10000, avgDailyVolume=500000
    const prob = PaperMatchingEngine.calculateFillProbability(10_000, 500_000);
    expect(prob).toBe(0.50);
  });

  it('ratio = 0.05: returns 0.25 (>= 0.05)', () => {
    // orderQty=25000, avgDailyVolume=500000 → ratio=0.05 >= 0.05 -> 0.25
    const prob = PaperMatchingEngine.calculateFillProbability(25_000, 500_000);
    expect(prob).toBe(0.25);
  });

  it('ratio > 0.10: returns 0.10', () => {
    // orderQty=60000, avgDailyVolume=500000 → ratio=0.12 > 0.10 -> 0.10
    const prob = PaperMatchingEngine.calculateFillProbability(60_000, 500_000);
    expect(prob).toBe(0.10);
  });
});

// ============================================================
// tryFillLimitOrder
// ============================================================
describe('PaperMatchingEngine.tryFillLimitOrder', () => {
  it('BUY LO: fill khi currentPrice <= limitPrice va random < fillProb', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // < 0.95

    const order = { side: 'BUY', limit_price: 25000, quantity: 100 };
    const result = PaperMatchingEngine.tryFillLimitOrder(order, 24000, 500_000);

    expect(result.filled).toBe(true);
    expect(result.fillPrice).toBe(25000);
    expect(result.slippage).toBe(0);

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('BUY LO: KHÔNG fill khi currentPrice > limitPrice', () => {
    const order = { side: 'BUY', limit_price: 25000, quantity: 100 };
    const result = PaperMatchingEngine.tryFillLimitOrder(order, 26000, 500_000);

    expect(result.filled).toBe(false);
  });

  it('SELL LO: fill khi currentPrice >= limitPrice va random < fillProb', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);

    const order = { side: 'SELL', limit_price: 25000, quantity: 100 };
    const result = PaperMatchingEngine.tryFillLimitOrder(order, 26000, 500_000);

    expect(result.filled).toBe(true);
    expect(result.fillPrice).toBe(25000);

    vi.spyOn(Math, 'random').mockRestore();
  });

  it('SELL LO: KHÔNG fill khi currentPrice < limitPrice', () => {
    const order = { side: 'SELL', limit_price: 25000, quantity: 100 };
    const result = PaperMatchingEngine.tryFillLimitOrder(order, 24000, 500_000);

    expect(result.filled).toBe(false);
  });

  it('BUY LO: KHÔNG fill khi random >= fillProb (LOW_FILL_PROBABILITY)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99); // > 0.95

    const order = { side: 'BUY', limit_price: 25000, quantity: 100 };
    const result = PaperMatchingEngine.tryFillLimitOrder(order, 24000, 500_000);

    expect(result.filled).toBe(false);
    expect(result.reason).toBe('LOW_FILL_PROBABILITY');

    vi.spyOn(Math, 'random').mockRestore();
  });
});

// ============================================================
// fillMarketOrder
// ============================================================
describe('PaperMatchingEngine.fillMarketOrder', () => {
  it('BUY MP: fillPrice = currentPrice + slippage, snapped to tick size', () => {
    snapToTickSize.mockImplementation((price) => Math.round(price / 100) * 100);

    const order = { side: 'BUY', quantity: 100, symbol: 'VNM' };
    const result = PaperMatchingEngine.fillMarketOrder(order, 25000, 500_000, 'HOSE');

    expect(result.filled).toBe(true);
    expect(result.fillPrice).toBeGreaterThan(25000);
    expect(result.slippage).toBeGreaterThan(0);
    expect(snapToTickSize).toHaveBeenCalled();
  });

  it('SELL MP: fillPrice = currentPrice - slippage, snapped to tick size', () => {
    snapToTickSize.mockImplementation((price) => price);

    const order = { side: 'SELL', quantity: 100, symbol: 'VNM' };
    const result = PaperMatchingEngine.fillMarketOrder(order, 25000, 500_000, 'HOSE');

    expect(result.filled).toBe(true);
    expect(result.fillPrice).toBeLessThan(25000);
    expect(result.slippage).toBeGreaterThan(0);
  });

  it('BUY MP: fillPrice clamped khi vuot bien do gia san', () => {
    // Mock validatePriceInBand return invalid (vuot bien)
    validatePriceInBand.mockReturnValue({ valid: false, ceil: 26750 });
    snapToTickSize.mockImplementation((price) => price);

    const order = { side: 'BUY', quantity: 10_000, symbol: 'VNM', reference_price: 25000 };
    const result = PaperMatchingEngine.fillMarketOrder(order, 25000, 50_000, 'HOSE');

    // fillPrice should be clamped to ceil
    expect(result.filled).toBe(true);
    expect(result.fillPrice).toBeLessThanOrEqual(26750);
  });
});

// ============================================================
// fillATOOrder / fillATCOrder
// ============================================================
describe('PaperMatchingEngine.fillATOOrder', () => {
  it('returns fillPrice = openPrice', () => {
    const order = { side: 'BUY', quantity: 100 };
    const result = PaperMatchingEngine.fillATOOrder(order, 24800);

    expect(result.filled).toBe(true);
    expect(result.fillPrice).toBe(24800);
    expect(result.slippage).toBe(0);
  });
});

describe('PaperMatchingEngine.fillATCOrder', () => {
  it('returns fillPrice = closePrice', () => {
    const order = { side: 'SELL', quantity: 100 };
    const result = PaperMatchingEngine.fillATCOrder(order, 25200);

    expect(result.filled).toBe(true);
    expect(result.fillPrice).toBe(25200);
    expect(result.slippage).toBe(0);
  });
});
