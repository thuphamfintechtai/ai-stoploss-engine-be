/**
 * aiPostProcess — Unit tests (AIT-02).
 *
 * Threat mitigated: T-04-02 (Gemini hallucinate giá ngoài biên độ sàn).
 * SC 1+2 trực tiếp từ ROADMAP được phủ bởi Test 2.1 + 2.2.
 *
 * Convention:
 *   - Unit: VND integer
 *   - HOSE tick: 10 (<10k) / 50 (10k-49.95k) / 100 (≥50k)
 *   - HNX/UPCOM tick: 100 toàn dải
 *   - HOSE band ±7%, HNX ±10%, UPCOM ±15%
 */

import { describe, it, expect } from 'vitest';
import { snapAndClampPrices, snapAndClampReview } from '../../services/ai/aiPostProcess.js';
import { getPriceBand, snapToTick } from '../../services/shared/vnMarketRules.js';

describe('snapAndClampPrices — clamp to band (AIT-02)', () => {
  it('Test 2.1 (SC 1): stop_loss=10 với ref=80_000 HOSE → clamp về floor', () => {
    const ref = 80_000;
    const { floor } = getPriceBand(ref, 'HOSE');
    // HOSE floor ~ 74_400 (80_000 × 0.93 = 74_400, đã là tick-100)
    const res = snapAndClampPrices(
      { entry_price: 80_000, stop_loss: 10, take_profit: 82_000 },
      { exchange: 'HOSE', referencePrice: ref }
    );
    expect(res.clamped.stop_loss).toBe(true);
    expect(res.original.stop_loss).toBe(10);
    expect(res.adjusted.stop_loss).toBe(floor);
    expect(res.adjusted.stop_loss).toBe(74_400);
  });

  it('Test 2.2 (SC 2): take_profit=100_000 với ref=80_000 HOSE → clamp về ceiling', () => {
    const ref = 80_000;
    const { ceiling } = getPriceBand(ref, 'HOSE');
    // HOSE ceiling ~ 85_600 (80_000 × 1.07 = 85_600, tick-100)
    const res = snapAndClampPrices(
      { entry_price: 80_000, take_profit: 100_000 },
      { exchange: 'HOSE', referencePrice: ref }
    );
    expect(res.clamped.take_profit).toBe(true);
    expect(res.original.take_profit).toBe(100_000);
    expect(res.adjusted.take_profit).toBe(ceiling);
    expect(res.adjusted.take_profit).toBe(85_600);
  });

  it('Test 2.3: giá hợp lệ trong band, on-tick → no clamp, echo đúng', () => {
    const res = snapAndClampPrices(
      { entry_price: 50_100, stop_loss: 48_000, take_profit: 52_000 },
      { exchange: 'HOSE', referencePrice: 50_000 }
    );
    expect(res.clamped.entry_price).toBeFalsy();
    expect(res.clamped.stop_loss).toBeFalsy();
    expect(res.clamped.take_profit).toBeFalsy();
    expect(res.adjusted.entry_price).toBe(50_100);
    expect(res.adjusted.stop_loss).toBe(48_000);
    expect(res.adjusted.take_profit).toBe(52_000);
  });

  it('Test 2.4: off-tick HOSE 50_137 → snap về 50_100 (nearest), no clamp nếu trong band', () => {
    const res = snapAndClampPrices(
      { entry_price: 50_137 },
      { exchange: 'HOSE', referencePrice: 50_000 }
    );
    expect(res.adjusted.entry_price).toBe(50_100); // nearest tick-100
    expect(res.clamped.entry_price).toBeFalsy();
    expect(res.original.entry_price).toBeUndefined();
  });

  it('Test 2.5: referencePrice=null → không clamp (skip band check), vẫn snap tick', () => {
    const res = snapAndClampPrices(
      { entry_price: 50_137 },
      { exchange: 'HOSE', referencePrice: null }
    );
    expect(res.adjusted.entry_price).toBe(50_100);
    expect(res.clamped.entry_price).toBeFalsy();
    expect(res.meta.reference_price).toBeNull();
    expect(res.meta.band).toBeNull();
  });

  it('Test 2.6: field null/undefined/0/NaN → skip, không crash', () => {
    const res = snapAndClampPrices(
      {
        entry_price: 50_000,
        stop_loss: null,
        take_profit: undefined,
        current_price: 0,
        new_stop_loss: NaN,
      },
      { exchange: 'HOSE', referencePrice: 50_000 }
    );
    expect(res.adjusted.entry_price).toBe(50_000);
    // Non-finite fields skipped — không xuất hiện trong adjusted
    expect(res.adjusted.stop_loss).toBeUndefined();
    expect(res.adjusted.take_profit).toBeUndefined();
    expect(res.adjusted.current_price).toBeUndefined();
    expect(res.adjusted.new_stop_loss).toBeUndefined();
  });

  it('Test 2.7: HNX take_profit 25_000 với ref=20_000 → clamp về ceiling 22_000', () => {
    const ref = 20_000;
    const { ceiling } = getPriceBand(ref, 'HNX');
    const res = snapAndClampPrices(
      { take_profit: 25_000 },
      { exchange: 'HNX', referencePrice: ref }
    );
    expect(ceiling).toBe(22_000);
    expect(res.adjusted.take_profit).toBe(22_000);
    expect(res.clamped.take_profit).toBe(true);
    expect(res.original.take_profit).toBe(25_000);
  });

  it('Test 2.8: UPCOM stop_loss 7_000 với ref=10_000 → clamp về floor 8_500', () => {
    const ref = 10_000;
    const { floor } = getPriceBand(ref, 'UPCOM');
    const res = snapAndClampPrices(
      { stop_loss: 7_000 },
      { exchange: 'UPCOM', referencePrice: ref }
    );
    expect(floor).toBe(8_500);
    expect(res.adjusted.stop_loss).toBe(8_500);
    expect(res.clamped.stop_loss).toBe(true);
  });

  it('meta exposes band info để UI hiển thị', () => {
    const res = snapAndClampPrices(
      { entry_price: 50_000 },
      { exchange: 'HOSE', referencePrice: 50_000 }
    );
    expect(res.meta).toEqual({
      exchange: 'HOSE',
      reference_price: 50_000,
      band: {
        floor: expect.any(Number),
        ceiling: expect.any(Number),
        pct: 0.07,
        reference: 50_000,
      },
    });
  });

  it('only allowlisted fields snap — non-price field bỏ qua', () => {
    const res = snapAndClampPrices(
      { entry_price: 50_137, symbol: 'VNM', confidence_score: 75 },
      { exchange: 'HOSE', referencePrice: 50_000 }
    );
    expect(res.adjusted.entry_price).toBe(50_100);
    expect(res.adjusted.symbol).toBeUndefined();
    expect(res.adjusted.confidence_score).toBeUndefined();
  });
});

describe('snapAndClampReview — array over review items', () => {
  it('Test 2.9: 2 positions, 1 có new_stop_loss out-of-band → clamp riêng item đó', () => {
    const items = [
      {
        position_id: 'pos-A',
        symbol: 'VNM',
        action: 'TIGHTEN_SL',
        new_stop_loss: 10, // out of band vs entry 80_000 HOSE
        new_take_profit: null,
      },
      {
        position_id: 'pos-B',
        symbol: 'HPG',
        action: 'HOLD',
        new_stop_loss: 18_000,
        new_take_profit: 22_000,
      },
    ];
    const pricesByPosition = {
      'pos-A': { entry_price: 80_000, exchange: 'HOSE' },
      'pos-B': { entry_price: 20_000, exchange: 'HOSE' },
    };

    const out = snapAndClampReview(items, pricesByPosition);
    expect(out).toHaveLength(2);

    const a = out.find(x => x.position_id === 'pos-A');
    expect(a.new_stop_loss).toBe(74_400); // clamp to HOSE floor
    expect(a._clamped.new_stop_loss).toBe(true);
    expect(a._original.new_stop_loss).toBe(10);

    const b = out.find(x => x.position_id === 'pos-B');
    expect(b.new_stop_loss).toBe(18_000);
    expect(b.new_take_profit).toBe(22_000);
    expect(b._clamped.new_stop_loss).toBeFalsy();
    expect(b._clamped.new_take_profit).toBeFalsy();
  });

  it('review item thiếu price map → giữ nguyên, không crash', () => {
    const out = snapAndClampReview(
      [{ position_id: 'pos-X', symbol: 'XXX', action: 'HOLD', new_stop_loss: 50_137 }],
      {} // no price info
    );
    expect(out[0].position_id).toBe('pos-X');
    // Không reference price → vẫn snap tick nhưng không clamp
    expect(out[0].new_stop_loss).toBe(50_100);
  });
});

// ─── Boundary: verify snap direction on clamp edge ─────────────────────────

describe('Clamp direction snap correctness', () => {
  it('clamp ceiling dùng snapToTick(..., down) để không vượt band raw', () => {
    // Ref 99_999 HOSE → ceiling raw = 107_000 tick 100 → snap down = 107_000
    const ref = 99_999;
    const { ceiling } = getPriceBand(ref, 'HOSE');
    expect(ceiling).toBe(snapToTick(Math.floor(ref * 1.07), 'HOSE', 'down'));
    const res = snapAndClampPrices({ take_profit: 200_000 }, { exchange: 'HOSE', referencePrice: ref });
    expect(res.adjusted.take_profit).toBe(ceiling);
    expect(res.adjusted.take_profit).toBeLessThanOrEqual(Math.floor(ref * 1.07));
  });
});
