/**
 * Dynamic Stop Loss — Tests (TDD RED → GREEN)
 *
 * Test calculateDynamicSL, generateFallbackNarrative, generateSLNarrative
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock indicatorCache
vi.mock('../../services/ai/indicatorCache.js', () => ({
  getOrCreateIndicators: vi.fn(),
  feedCandle: vi.fn(),
}));

// Mock regimeDetector
vi.mock('../../services/ai/regimeDetector.js', () => ({
  detectRegime: vi.fn(() => 'BULLISH'),
  REGIME_MULTIPLIERS: {
    VOLATILE: 2.5,
    BULLISH: 1.5,
    BEARISH: 1.5,
    SIDEWAYS: 1.0,
  },
}));

// Mock priceBandValidator
vi.mock('../../services/shared/priceBandValidator.js', () => ({
  clampToBand: vi.fn((price) => price), // passthrough by default
}));

// Mock tickSizeEngine
vi.mock('../../services/tickSizeEngine.js', () => ({
  snapToTickSize: vi.fn((price) => price), // passthrough by default
}));

// Mock aiService
vi.mock('../../services/aiService.js', () => ({
  callGeminiJSON: vi.fn(),
}));

import { detectRegime, REGIME_MULTIPLIERS } from '../../services/ai/regimeDetector.js';
import { clampToBand } from '../../services/shared/priceBandValidator.js';
import { snapToTickSize } from '../../services/tickSizeEngine.js';
import { callGeminiJSON } from '../../services/aiService.js';
import { createMockIndicators } from '../helpers/indicatorMocks.js';

import {
  calculateDynamicSL,
  generateFallbackNarrative,
  generateSLNarrative,
} from '../../services/ai/dynamicStopLoss.js';

// ─── Helper ────────────────────────────────────────────────────────────────────

function makeLongPosition(overrides = {}) {
  return {
    id: 'pos-001',
    symbol: 'VCB',
    side: 'LONG',
    stop_loss: 90000,
    exchange: 'HOSE',
    portfolio_id: 'port-001',
    ...overrides,
  };
}

function makeShortPosition(overrides = {}) {
  return {
    id: 'pos-002',
    symbol: 'HPG',
    side: 'SHORT',
    stop_loss: 28000,
    exchange: 'HNX',
    portfolio_id: 'port-002',
    ...overrides,
  };
}

function makeCandle(overrides = {}) {
  return {
    high: 100000,
    low: 95000,
    close: 98000,
    open: 96000,
    volume: 100000,
    ...overrides,
  };
}

// ─── calculateDynamicSL — LONG ─────────────────────────────────────────────────

describe('calculateDynamicSL — LONG trailing logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectRegime.mockReturnValue('BULLISH');
    clampToBand.mockImplementation((price) => price);
    snapToTickSize.mockImplementation((price) => price);
  });

  it('LONG: newSL = close - ATR * multiplier', () => {
    const indicators = createMockIndicators(); // atr.getResult() = 500
    // ATR=500, BULLISH multiplier=1.5 → newSL = 98000 - 500*1.5 = 97250
    const pos = makeLongPosition({ stop_loss: 90000 });
    const candle = makeCandle({ close: 98000 });

    const result = calculateDynamicSL(pos, candle, indicators);

    expect(result.newSL).toBe(97250); // 98000 - 750
    expect(result.regime).toBe('BULLISH');
    expect(result.multiplier).toBe(1.5);
    expect(result.atrValue).toBe(500);
  });

  it('LONG: trailing chi tang — newSL phai >= currentSL', () => {
    const indicators = createMockIndicators(); // atr = 500
    // ATR=500, BULLISH → computed = 98000 - 750 = 97250 > currentSL=90000 → move
    const pos = makeLongPosition({ stop_loss: 90000 });
    const candle = makeCandle({ close: 98000 });

    const result = calculateDynamicSL(pos, candle, indicators);

    expect(result.newSL).toBeGreaterThanOrEqual(pos.stop_loss);
    expect(result.changed).toBe(true);
  });

  it('LONG: changed=false khi computed < currentSL (trailing khong di lui)', () => {
    const indicators = createMockIndicators(); // atr = 500
    // ATR=500, BULLISH → computed = 98000 - 750 = 97250
    // currentSL = 98000 (cao hon computed) → khong move
    const pos = makeLongPosition({ stop_loss: 98000 });
    const candle = makeCandle({ close: 98000 });

    const result = calculateDynamicSL(pos, candle, indicators);

    expect(result.changed).toBe(false);
    expect(result.newSL).toBe(98000); // giữ nguyên currentSL
  });

  it('LONG: tra ve oldSL trong result', () => {
    const indicators = createMockIndicators();
    const pos = makeLongPosition({ stop_loss: 90000 });
    const candle = makeCandle({ close: 98000 });

    const result = calculateDynamicSL(pos, candle, indicators);

    expect(result.oldSL).toBe(90000);
  });
});

// ─── calculateDynamicSL — SHORT ────────────────────────────────────────────────

describe('calculateDynamicSL — SHORT trailing logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectRegime.mockReturnValue('BEARISH');
    clampToBand.mockImplementation((price) => price);
    snapToTickSize.mockImplementation((price) => price);
  });

  it('SHORT: newSL = close + ATR * multiplier', () => {
    const indicators = createMockIndicators(); // atr = 500
    // ATR=500, BEARISH multiplier=1.5 → newSL = 26000 + 750 = 26750
    const pos = makeShortPosition({ stop_loss: 30000, exchange: 'HNX' });
    const candle = makeCandle({ close: 26000 });

    const result = calculateDynamicSL(pos, candle, indicators);

    expect(result.newSL).toBe(26750); // 26000 + 750
    expect(result.regime).toBe('BEARISH');
  });

  it('SHORT: trailing chi giam — newSL phai <= currentSL', () => {
    const indicators = createMockIndicators(); // atr = 500
    // ATR=500, BEARISH → computed = 26000 + 750 = 26750 < currentSL=30000 → move
    const pos = makeShortPosition({ stop_loss: 30000 });
    const candle = makeCandle({ close: 26000 });

    const result = calculateDynamicSL(pos, candle, indicators);

    expect(result.newSL).toBeLessThanOrEqual(pos.stop_loss);
    expect(result.changed).toBe(true);
  });

  it('SHORT: changed=false khi computed > currentSL (trailing khong di nguoc)', () => {
    const indicators = createMockIndicators(); // atr = 500
    // ATR=500, BEARISH → computed = 26000 + 750 = 26750
    // currentSL = 26000 (thap hon computed) → khong move (chi di xuong)
    const pos = makeShortPosition({ stop_loss: 26000 });
    const candle = makeCandle({ close: 26000 });

    const result = calculateDynamicSL(pos, candle, indicators);

    expect(result.changed).toBe(false);
    expect(result.newSL).toBe(26000);
  });
});

// ─── calculateDynamicSL — SL clamp ─────────────────────────────────────────────

describe('calculateDynamicSL — SL clamp trong price band', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detectRegime.mockReturnValue('SIDEWAYS');
    snapToTickSize.mockImplementation((price) => price);
  });

  it('SL duoc clamp khi vuot price band', () => {
    // clampToBand tra ve gia da duoc clamp
    clampToBand.mockReturnValue(93000);

    const indicators = createMockIndicators(); // atr = 500
    const pos = makeLongPosition({ stop_loss: 90000 });
    const candle = makeCandle({ close: 98000 });

    const result = calculateDynamicSL(pos, candle, indicators);

    expect(clampToBand).toHaveBeenCalled();
    expect(result.newSL).toBe(93000); // clamped value
  });

  it('clampToBand duoc goi voi (computedSL, candle.close, exchange)', () => {
    clampToBand.mockImplementation((price) => price);

    const indicators = createMockIndicators();
    const pos = makeLongPosition({ stop_loss: 90000, exchange: 'HNX' });
    const candle = makeCandle({ close: 98000 });

    calculateDynamicSL(pos, candle, indicators);

    expect(clampToBand).toHaveBeenCalledWith(expect.any(Number), 98000, 'HNX');
  });
});

// ─── calculateDynamicSL — VOLATILE regime ──────────────────────────────────────

describe('calculateDynamicSL — VOLATILE regime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clampToBand.mockImplementation((price) => price);
    snapToTickSize.mockImplementation((price) => price);
  });

  it('VOLATILE: multiplier = 2.5', () => {
    detectRegime.mockReturnValue('VOLATILE');
    const indicators = createMockIndicators(); // atr = 500
    // VOLATILE → multiplier = 2.5 → newSL = 98000 - 500*2.5 = 96750
    const pos = makeLongPosition({ stop_loss: 90000 });
    const candle = makeCandle({ close: 98000 });

    const result = calculateDynamicSL(pos, candle, indicators);

    expect(result.multiplier).toBe(2.5);
    expect(result.newSL).toBe(96750);
  });
});

// ─── generateFallbackNarrative ─────────────────────────────────────────────────

describe('generateFallbackNarrative', () => {
  it('tra ve string co chua ATR info', () => {
    const data = {
      oldSL: 90000,
      newSL: 97250,
      atrValue: 500,
      regime: 'BULLISH',
      multiplier: 1.5,
    };
    const text = generateFallbackNarrative(data);
    expect(typeof text).toBe('string');
    expect(text).toContain('500');
    expect(text.length).toBeGreaterThan(20);
  });

  it('tra ve string co chua regime', () => {
    const data = {
      oldSL: 90000,
      newSL: 97250,
      atrValue: 500,
      regime: 'VOLATILE',
      multiplier: 2.5,
    };
    const text = generateFallbackNarrative(data);
    expect(text).toContain('VOLATILE');
  });

  it('tra ve string co chua old va new SL', () => {
    const data = {
      oldSL: 90000,
      newSL: 97250,
      atrValue: 500,
      regime: 'BEARISH',
      multiplier: 1.5,
    };
    const text = generateFallbackNarrative(data);
    expect(text).toContain('90000');
    expect(text).toContain('97250');
  });

  it('VOLATILE: narrative de cap den thanh khoan cao', () => {
    const data = {
      oldSL: 90000,
      newSL: 96750,
      atrValue: 500,
      regime: 'VOLATILE',
      multiplier: 2.5,
    };
    const text = generateFallbackNarrative(data);
    expect(text.length).toBeGreaterThan(20);
  });
});

// ─── generateSLNarrative — Gemini + fallback ──────────────────────────────────

describe('generateSLNarrative', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tra ve Gemini narrative khi callGeminiJSON thanh cong', async () => {
    callGeminiJSON.mockResolvedValue({ narrative: 'Gemini explanation text' });

    const data = {
      symbol: 'VCB',
      oldSL: 90000,
      newSL: 97250,
      atrValue: 500,
      regime: 'BULLISH',
      multiplier: 1.5,
    };

    const result = await generateSLNarrative(data);
    expect(typeof result).toBe('object');
    expect(result).toHaveProperty('narrative');
    expect(result).toHaveProperty('ai_source');
    expect(result.narrative.length).toBeGreaterThan(0);
  });

  it('tra ve fallback narrative khi Gemini timeout', async () => {
    // Simulate timeout bằng cách reject sau delay
    callGeminiJSON.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 100))
    );

    const data = {
      symbol: 'VCB',
      oldSL: 90000,
      newSL: 97250,
      atrValue: 500,
      regime: 'BULLISH',
      multiplier: 1.5,
    };

    const result = await generateSLNarrative(data);
    expect(typeof result).toBe('object');
    expect(result.ai_source).toBe('rule-based');
    expect(result.narrative.length).toBeGreaterThan(0);
    // Fallback narrative phai chua ATR info
    expect(result.narrative).toContain('500');
  });

  it('tra ve fallback narrative khi Gemini throw error', async () => {
    callGeminiJSON.mockRejectedValue(new Error('API error'));

    const data = {
      symbol: 'VCB',
      oldSL: 90000,
      newSL: 97250,
      atrValue: 500,
      regime: 'BEARISH',
      multiplier: 1.5,
    };

    const result = await generateSLNarrative(data);
    expect(typeof result).toBe('object');
    expect(result.ai_source).toBe('rule-based');
    // fallback narrative
    expect(result.narrative).toContain('BEARISH');
  });
});
