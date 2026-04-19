/**
 * fallbackSuggestor.test.js — AIT-07 (D-07)
 *
 * Test rule-based fallback generator:
 * - Output match signalSchema / sltpSchema từ 04-01
 * - ATR-based SL/TP đúng hướng cho LONG / SHORT
 * - Graceful khi < 14 nến (không throw)
 * - source='rule-based-fallback' + ai_source='rule-based' (backward compat)
 *
 * Threat mitigated: T-04-07 (Gemini fail → UI trắng), T-04-08 (shape mismatch).
 */
import { describe, it, expect } from 'vitest';
import {
  generateFallbackSignal,
  generateFallbackSLTP,
} from '../../services/ai/fallbackSuggestor.js';
import { validateAiResponse } from '../../services/ai/aiResponseSchemas.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Tạo mock 20 nến OHLCV với trend tăng rõ ràng (giá tăng 1k/phiên).
 * Đủ data cho ATR14, MA20.
 */
function makeBullishCandles(startClose = 48_000, n = 20) {
  const out = [];
  let close = startClose;
  for (let i = 0; i < n; i++) {
    const open = close;
    const high = close + 500;
    const low = close - 300;
    const newClose = close + 100; // trend tăng nhẹ
    out.push({ open, high, low, close: newClose, volume: 100_000 + i * 1000 });
    close = newClose;
  }
  return out;
}

function makeBearishCandles(startClose = 52_000, n = 20) {
  const out = [];
  let close = startClose;
  for (let i = 0; i < n; i++) {
    const open = close;
    const high = close + 200;
    const low = close - 500;
    const newClose = close - 150; // trend giảm
    out.push({ open, high, low, close: newClose, volume: 100_000 });
    close = newClose;
  }
  return out;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('generateFallbackSignal — AIT-07 (D-07)', () => {
  it('Test 2.1: VNM currentPrice=50000 với 20 nến → output valid shape + source tag', () => {
    const candles = makeBullishCandles(48_000, 20);
    const out = generateFallbackSignal({
      symbol: 'VNM',
      exchange: 'HOSE',
      currentPrice: 50_000,
      ohlcvData: candles,
    });

    expect(['BUY', 'SELL', 'HOLD']).toContain(out.action);
    expect(out.stop_loss).toBeGreaterThan(0);
    expect(out.take_profit).toBeGreaterThan(0);
    expect(out.source).toBe('rule-based-fallback');
    expect(out.ai_source).toBe('rule-based'); // backward compat FE
    expect(typeof out.reason).toBe('string');
    expect(out.confidence_score).toBeLessThanOrEqual(100);
    expect(out.confidence_score).toBeGreaterThanOrEqual(0);

    // Snap-tick HOSE: giá 50k → tick 100 (TICK_TABLE maxPrice 49_950 → 100)
    // SL/TP phải chia hết cho tick
    expect(out.stop_loss % 100).toBe(0);
    expect(out.take_profit % 100).toBe(0);
  });

  it('Test 2.2: Integration — output fallback pass validateAiResponse("signal")', () => {
    const candles = makeBullishCandles(48_000, 20);
    const out = generateFallbackSignal({
      symbol: 'VNM',
      exchange: 'HOSE',
      currentPrice: 50_000,
      ohlcvData: candles,
    });

    const { ok, errors } = validateAiResponse('signal', out);
    if (!ok) {
      // Log ra để debug nếu fail
      console.log('Validation errors:', JSON.stringify(errors, null, 2));
      console.log('Payload:', JSON.stringify(out, null, 2));
    }
    expect(ok).toBe(true);
  });

  it('Test 2.3: < 14 nến → vẫn trả output (HOLD fallback), không throw', () => {
    const shortCandles = makeBullishCandles(48_000, 5);
    const out = generateFallbackSignal({
      symbol: 'ABC',
      exchange: 'HOSE',
      currentPrice: 50_000,
      ohlcvData: shortCandles,
    });

    expect(out.action).toBe('HOLD');
    // SL khoảng ~7% dưới giá, TP ~7% trên (LONG default)
    expect(out.stop_loss).toBeGreaterThan(0);
    expect(out.stop_loss).toBeLessThan(50_000);
    expect(out.take_profit).toBeGreaterThan(50_000);
    expect(out.reason).toMatch(/không đủ|ATR/i);
    expect(out.source).toBe('rule-based-fallback');

    // Vẫn pass schema validate
    const { ok } = validateAiResponse('signal', out);
    expect(ok).toBe(true);
  });

  it('Test 2.4: SHORT side → stop_loss > currentPrice, take_profit < currentPrice', () => {
    const candles = makeBearishCandles(52_000, 20);
    const out = generateFallbackSignal({
      symbol: 'HPG',
      exchange: 'HOSE',
      currentPrice: 50_000,
      ohlcvData: candles,
      side: 'SHORT',
    });

    expect(out.stop_loss).toBeGreaterThan(50_000);
    expect(out.take_profit).toBeLessThan(50_000);
    expect(out.take_profit).toBeGreaterThan(0);
    expect(out.source).toBe('rule-based-fallback');

    const { ok } = validateAiResponse('signal', out);
    expect(ok).toBe(true);
  });
});

describe('generateFallbackSLTP — AIT-07 (D-07)', () => {
  it('Test 2.5: output có suggestions array với 3 item aggressive/moderate/conservative', () => {
    const candles = makeBullishCandles(48_000, 20);
    const out = generateFallbackSLTP({
      symbol: 'VNM',
      exchange: 'HOSE',
      currentPrice: 50_000,
      ohlcvData: candles,
      rrRatio: 2,
      side: 'LONG',
    });

    expect(Array.isArray(out.suggestions)).toBe(true);
    expect(out.suggestions.length).toBe(3);

    const types = out.suggestions.map(s => s.type);
    expect(types).toContain('aggressive');
    expect(types).toContain('moderate');
    expect(types).toContain('conservative');

    for (const s of out.suggestions) {
      expect(s.stop_loss_vnd).toBeGreaterThan(0);
      expect(s.take_profit_vnd).toBeGreaterThan(0);
    }

    expect(out.source).toBe('rule-based-fallback');
    expect(out.ai_source).toBe('rule-based');
  });

  it('Test 2.6: Integration — generateFallbackSLTP pass validateAiResponse("sltp")', () => {
    const candles = makeBullishCandles(48_000, 20);
    const out = generateFallbackSLTP({
      symbol: 'VNM',
      exchange: 'HOSE',
      currentPrice: 50_000,
      ohlcvData: candles,
      rrRatio: 2,
      side: 'LONG',
    });

    const { ok, errors } = validateAiResponse('sltp', out);
    if (!ok) {
      console.log('SLTP validation errors:', JSON.stringify(errors, null, 2));
      console.log('Payload keys:', Object.keys(out));
    }
    expect(ok).toBe(true);
  });
});
