/**
 * aiResponseSchemas — Unit tests (AIT-01).
 *
 * Mỗi reject case map tới 1 threat cụ thể:
 *   - unknown action         → T-04-01 (Gemini hallucinate enum)
 *   - missing required field → T-04-01 (shape mismatch)
 *   - out-of-sane-range      → T-04-05 (giá phi lý → user mất tiền)
 */

import { describe, it, expect } from 'vitest';
import {
  AI_SCHEMAS,
  validateAiResponse,
  signalSchema,
  sltpSchema,
  reviewSchema,
  trendSchema,
  evaluateRiskSchema,
} from '../../services/ai/aiResponseSchemas.js';

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Build a valid signal payload for mutation in tests. */
function validSignal(overrides = {}) {
  return {
    action: 'BUY',
    entry_price: 50_000,
    stop_loss: 48_000,
    take_profit: 55_000,
    confidence_score: 75,
    timeframe: 'short',
    reason: 'Mẫu hình tăng giá rõ ràng',
    technical_context: {
      trend: 'BULLISH',
      momentum: 'STRONG',
      volume_confirmation: true,
      key_pattern: 'Breakout',
    },
    risk_level: 'MEDIUM',
    expiry_hours: 24,
    ...overrides,
  };
}

function validReviewItem(overrides = {}) {
  return {
    position_id: 'pos-123',
    symbol: 'VNM',
    action: 'HOLD',
    new_stop_loss: null,
    new_take_profit: null,
    reasoning: 'Giữ nguyên, chưa đến ngưỡng điều chỉnh',
    urgency: 'LOW',
    key_concern: 'Không có',
    ...overrides,
  };
}

function validTrend(overrides = {}) {
  return {
    trend: 'BULLISH',
    strength: 70,
    timeframe: 'short',
    analysis: 'Giá đóng cửa trên MA20, volume xác nhận.',
    signals: [{ type: 'BUY', indicator: 'MA20', message: 'Giá trên MA20' }],
    key_levels: { support: [48_000, 46_000], resistance: [55_000, 58_000] },
    volume_analysis: 'Volume tăng',
    recommendation: 'BUY',
    summary: 'Xu hướng tăng',
    ...overrides,
  };
}

function validEvaluateRisk(overrides = {}) {
  return {
    risk_level: 'LOW',
    risk_score: 25,
    verdict: 'APPROVED',
    factors: [],
    strengths: ['R:R 1:2 hợp lý'],
    weaknesses: [],
    recommendations: ['Theo sát SL'],
    position_sizing: { current_quantity: 100, suggested_max_quantity: 200, reasoning: 'OK' },
    summary: 'Giao dịch phù hợp với hạn mức rủi ro',
    ...overrides,
  };
}

// ─── Schema export surface ─────────────────────────────────────────────────

describe('AI_SCHEMAS export surface', () => {
  it('exports 5 core schemas via AI_SCHEMAS map', () => {
    expect(AI_SCHEMAS.signal).toBeDefined();
    expect(AI_SCHEMAS.sltp).toBeDefined();
    expect(AI_SCHEMAS.review).toBeDefined();
    expect(AI_SCHEMAS.trend).toBeDefined();
    expect(AI_SCHEMAS.evaluateRisk).toBeDefined();
  });

  it('exports named schemas directly', () => {
    expect(signalSchema).toBeDefined();
    expect(sltpSchema).toBeDefined();
    expect(reviewSchema).toBeDefined();
    expect(trendSchema).toBeDefined();
    expect(evaluateRiskSchema).toBeDefined();
  });

  it('validateAiResponse returns {ok, value, errors} shape', () => {
    const res = validateAiResponse('signal', validSignal());
    expect(res).toHaveProperty('ok');
    expect(res).toHaveProperty('value');
    expect(res).toHaveProperty('errors');
  });

  it('validateAiResponse với schemaKey unknown → ok:false', () => {
    const res = validateAiResponse('unknown_key', {});
    expect(res.ok).toBe(false);
  });
});

// ─── signalSchema reject cases (T-04-01 + T-04-05) ─────────────────────────

describe('signalSchema reject cases (AIT-01)', () => {
  it('Test 1.1: action=MAYBE → reject với error path chứa "action"', () => {
    const res = validateAiResponse('signal', validSignal({ action: 'MAYBE' }));
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.path.includes('action'))).toBe(true);
  });

  it('Test 1.2: thiếu confidence_score → reject', () => {
    const payload = validSignal();
    delete payload.confidence_score;
    const res = validateAiResponse('signal', payload);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.path.includes('confidence_score'))).toBe(true);
  });

  it('Test 1.3: stop_loss=0 → reject (out-of-sane-range)', () => {
    const res = validateAiResponse('signal', validSignal({ stop_loss: 0 }));
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.path.includes('stop_loss'))).toBe(true);
  });

  it('Test 1.4: take_profit > 10× entry_price → reject', () => {
    // entry 50_000 → cap = 500_000; take_profit > 500_000 must reject.
    const res = validateAiResponse('signal', validSignal({ entry_price: 50_000, take_profit: 500_001 }));
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.path.includes('take_profit'))).toBe(true);
  });

  it('Test 1.5: confidence_score=150 → reject', () => {
    const res = validateAiResponse('signal', validSignal({ confidence_score: 150 }));
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.path.includes('confidence_score'))).toBe(true);
  });
});

// ─── reviewSchema reject cases ─────────────────────────────────────────────

describe('reviewSchema reject cases', () => {
  it('Test 1.6: item với action=PANIC_SELL → reject', () => {
    const res = validateAiResponse('review', [validReviewItem({ action: 'PANIC_SELL' })]);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => JSON.stringify(e.path).includes('action'))).toBe(true);
  });

  it('Test 1.7: new_stop_loss=-100 → reject (negative)', () => {
    const res = validateAiResponse('review', [validReviewItem({ new_stop_loss: -100 })]);
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => JSON.stringify(e.path).includes('new_stop_loss'))).toBe(true);
  });
});

// ─── trendSchema reject cases ──────────────────────────────────────────────

describe('trendSchema reject cases', () => {
  it('Test 1.8: strength=-5 → reject', () => {
    const res = validateAiResponse('trend', validTrend({ strength: -5 }));
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.path.includes('strength'))).toBe(true);
  });

  it('Test 1.9: recommendation=MAYBE → reject', () => {
    const res = validateAiResponse('trend', validTrend({ recommendation: 'MAYBE' }));
    expect(res.ok).toBe(false);
    expect(res.errors.some(e => e.path.includes('recommendation'))).toBe(true);
  });
});

// ─── MUST pass (valid payloads) ────────────────────────────────────────────

describe('Valid payloads MUST pass', () => {
  it('Test 1.10: valid signal payload → ok:true, value echo', () => {
    const payload = validSignal();
    const res = validateAiResponse('signal', payload);
    expect(res.ok).toBe(true);
    expect(res.errors).toBeNull();
    expect(res.value.action).toBe('BUY');
    expect(res.value.entry_price).toBe(50_000);
  });

  it('Test 1.11: valid review array với 2 items mix action → ok:true', () => {
    const payload = [
      validReviewItem({ action: 'HOLD' }),
      validReviewItem({
        position_id: 'pos-456',
        action: 'TIGHTEN_SL',
        new_stop_loss: 49_500,
        urgency: 'MEDIUM',
        reasoning: 'P&L tốt, nên kéo SL bảo vệ lợi nhuận',
      }),
    ];
    const res = validateAiResponse('review', payload);
    expect(res.ok).toBe(true);
    expect(res.value).toHaveLength(2);
  });

  it('Test 1.12: valid evaluateRisk response → ok:true', () => {
    const res = validateAiResponse('evaluateRisk', validEvaluateRisk());
    expect(res.ok).toBe(true);
  });

  it('unknown top-level field KHÔNG làm reject (LLM thường thêm field phụ)', () => {
    const payload = validSignal();
    payload.extra_hallucination = { foo: 'bar' };
    const res = validateAiResponse('signal', payload);
    expect(res.ok).toBe(true);
  });

  it('sltp schema pass với valid suggestStopLossTakeProfit output', () => {
    const payload = {
      suggestions: [
        {
          type: 'moderate',
          label: 'Cân bằng',
          stop_loss_vnd: 48_000,
          take_profit_vnd: 55_000,
          stop_loss_pct: '4.00',
          take_profit_pct: '10.00',
          rr_ratio: 2.5,
        },
      ],
      technical_score: { score: 65, label: 'HOP_LY', methodology: 'ATR tốt' },
      key_levels: { support: [48_000], resistance: [55_000], atr_14: 1_000 },
      analysis_text: 'Bối cảnh kỹ thuật ổn định',
      disclaimer: 'Không phải khuyến nghị đầu tư',
      data_quality: { days_available: 50, is_sufficient: true },
    };
    const res = validateAiResponse('sltp', payload);
    expect(res.ok).toBe(true);
  });
});

// ─── validateAiResponse không được throw ───────────────────────────────────

describe('validateAiResponse NEVER throws', () => {
  it('null payload → ok:false, không throw', () => {
    expect(() => validateAiResponse('signal', null)).not.toThrow();
    const res = validateAiResponse('signal', null);
    expect(res.ok).toBe(false);
  });

  it('string payload thay vì object → ok:false, không throw', () => {
    expect(() => validateAiResponse('signal', 'not an object')).not.toThrow();
    const res = validateAiResponse('signal', 'not an object');
    expect(res.ok).toBe(false);
  });
});
