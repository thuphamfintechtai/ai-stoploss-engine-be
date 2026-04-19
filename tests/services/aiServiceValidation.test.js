/**
 * aiServiceValidation — Integration tests cho callGeminiJSONValidated (Task 3).
 *
 * Cover:
 *   - Schema reject → throw AI_SCHEMA_REJECT
 *   - Schema pass + out-of-band → snap+clamp gắn _clamped/_original
 *
 * Strategy: mock @google/generative-ai module để model.generateContent trả
 * JSON text theo kịch bản (controller-style hoisted mock).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Queue các response JSON theo thứ tự Test chạy. Mỗi test push 1 payload.
const __geminiQueue = [];

vi.mock('@google/generative-ai', () => {
  class FakeModel {
    async generateContent(_prompt) {
      const payload = __geminiQueue.shift();
      if (payload === undefined) {
        throw new Error('[test] no queued Gemini payload');
      }
      return {
        response: {
          text: () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
        },
      };
    }
  }
  class GoogleGenerativeAI {
    constructor() {}
    getGenerativeModel() {
      return new FakeModel();
    }
  }
  return { GoogleGenerativeAI };
});

// Đảm bảo có API key dummy để qua guard getModel().
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key';

const { callGeminiJSONValidated } = await import('../../services/aiService.js');

describe('callGeminiJSONValidated — integration (AIT-01 + AIT-02)', () => {
  beforeEach(() => {
    __geminiQueue.length = 0;
  });

  it('Test 3.1: Gemini trả signal với confidence_score=150 → throw AI_SCHEMA_REJECT', async () => {
    __geminiQueue.push({
      action: 'BUY',
      entry_price: 80_000,
      stop_loss: 78_000,
      take_profit: 82_000,
      confidence_score: 150, // invalid
      timeframe: 'short',
      reason: 'breakout pattern confirmed',
      risk_level: 'MEDIUM',
      expiry_hours: 24,
    });

    await expect(
      callGeminiJSONValidated('dummy prompt', 'signal', {
        exchange: 'HOSE',
        referencePrice: 80_000,
        priceFields: ['entry_price', 'stop_loss', 'take_profit'],
      })
    ).rejects.toThrow(/AI_SCHEMA_REJECT/);
  });

  it('Test 3.2: Gemini trả signal hợp lệ nhưng stop_loss=10 (out-of-band) → _clamped.stop_loss=true', async () => {
    __geminiQueue.push({
      action: 'BUY',
      entry_price: 80_000,
      stop_loss: 10,
      take_profit: 82_000,
      confidence_score: 75,
      timeframe: 'short',
      reason: 'support level holding',
      risk_level: 'MEDIUM',
      expiry_hours: 24,
    });

    const result = await callGeminiJSONValidated('dummy prompt', 'signal', {
      exchange: 'HOSE',
      referencePrice: 80_000,
      priceFields: ['entry_price', 'stop_loss', 'take_profit'],
    });

    expect(result.stop_loss).toBe(74_400); // HOSE floor = 80_000 × 0.93
    expect(result._clamped.stop_loss).toBe(true);
    expect(result._original.stop_loss).toBe(10);
    expect(result._clamp_meta.exchange).toBe('HOSE');
    expect(result._clamp_meta.reference_price).toBe(80_000);
    expect(result._clamp_meta.band).toBeTruthy();
    expect(result.action).toBe('BUY');
    expect(result.confidence_score).toBe(75);
  });

  it('Test 3.3: Gemini trả shape hợp lệ + in-band → no clamp, _clamped empty', async () => {
    __geminiQueue.push({
      action: 'HOLD',
      entry_price: 80_000,
      stop_loss: 77_000,
      take_profit: 83_000,
      confidence_score: 60,
      timeframe: 'short',
      reason: 'consolidation range',
      risk_level: 'LOW',
      expiry_hours: 12,
    });

    const result = await callGeminiJSONValidated('dummy', 'signal', {
      exchange: 'HOSE',
      referencePrice: 80_000,
      priceFields: ['entry_price', 'stop_loss', 'take_profit'],
    });

    expect(result.action).toBe('HOLD');
    expect(result._clamped).toEqual({});
    expect(result._original).toEqual({});
    expect(result.stop_loss).toBe(77_000);
    expect(result.take_profit).toBe(83_000);
  });

  it('Test 3.4: Gemini trả TP > 10× entry → reject sanity check (T-04-05)', async () => {
    __geminiQueue.push({
      action: 'BUY',
      entry_price: 50_000,
      stop_loss: 48_000,
      take_profit: 600_000, // 12× entry → sanity reject
      confidence_score: 80,
      timeframe: 'short',
      reason: 'moonshot target detected',
      risk_level: 'HIGH',
      expiry_hours: 24,
    });

    await expect(
      callGeminiJSONValidated('dummy', 'signal', {
        exchange: 'HOSE',
        referencePrice: 50_000,
        priceFields: ['entry_price', 'stop_loss', 'take_profit'],
      })
    ).rejects.toThrow(/AI_SCHEMA_REJECT/);
  });

  it('Test 3.5: regime schema — regime=HYPERBULL → reject', async () => {
    __geminiQueue.push({
      regime: 'HYPERBULL', // invalid enum
      confidence: 80,
      vnindex_outlook: 'TÍCH CỰC',
      risk_level: 'MEDIUM',
    });

    await expect(
      callGeminiJSONValidated('dummy', 'regime')
    ).rejects.toThrow(/AI_SCHEMA_REJECT/);
  });

  it('Test 3.6: regime schema valid → trả payload as-is (no price clamp)', async () => {
    __geminiQueue.push({
      regime: 'BULL',
      confidence: 75,
      description: 'VNINDEX vượt MA20, MA5 dốc lên',
      vnindex_outlook: 'TÍCH CỰC',
      recommendations: ['Tăng tỷ trọng', 'Ưu tiên leader ngành'],
      risk_level: 'MEDIUM',
      sector_focus: 'Ngân hàng, BĐS',
      key_levels: { support: 1200, resistance: 1280 },
      market_bias: 'Tăng nhẹ 5-10 phiên',
    });

    const result = await callGeminiJSONValidated('dummy', 'regime');
    expect(result.regime).toBe('BULL');
    expect(result.confidence).toBe(75);
    expect(result._clamped).toBeUndefined(); // không priceFields
  });
});
