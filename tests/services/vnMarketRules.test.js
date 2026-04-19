/**
 * vnMarketRules — Unit tests (VND-native, VN market rules).
 *
 * Coverage target ≥90% statements.
 * All edge cases từ 02-CONTEXT.md §specifics phải có test case riêng.
 */

import { describe, it, expect } from 'vitest';
import {
  getTickSize, snapToTick, isValidTick,
  getLotSize, validateLotSize,
  getPriceBand, validatePriceInBand,
  getMarketSession, isMarketOpen,
  ERRORS,
  snapToTickSize, isValidTickSize,
} from '../../services/shared/vnMarketRules.js';

// Helper: tạo Date từ ISO string treated as VN wall time (UTC+7).
const vnDate = (iso) => new Date(iso + '+07:00');

describe('getTickSize — HOSE tiered tick', () => {
  it('priceVnd < 10_000 → 10', () => {
    expect(getTickSize(9_900, 'HOSE')).toBe(10);
    expect(getTickSize(1_000, 'HOSE')).toBe(10);
  });
  it('priceVnd = 9_999 (boundary dưới) → 10', () => {
    expect(getTickSize(9_999, 'HOSE')).toBe(10);
  });
  it('priceVnd 10_000..49_950 → 50', () => {
    expect(getTickSize(10_000, 'HOSE')).toBe(50);
    expect(getTickSize(25_000, 'HOSE')).toBe(50);
    expect(getTickSize(49_950, 'HOSE')).toBe(50); // boundary CONTEXT §specifics
  });
  it('priceVnd 50_000+ → 100 (boundary+1 CONTEXT §specifics)', () => {
    expect(getTickSize(50_000, 'HOSE')).toBe(100);
    expect(getTickSize(123_400, 'HOSE')).toBe(100);
  });
  it('HNX toàn dải → 100', () => {
    expect(getTickSize(5_000, 'HNX')).toBe(100);
    expect(getTickSize(500_000, 'HNX')).toBe(100);
  });
  it('UPCOM toàn dải → 100', () => {
    expect(getTickSize(5_000, 'UPCOM')).toBe(100);
    expect(getTickSize(500_000, 'UPCOM')).toBe(100);
  });
  it('default exchange = HOSE', () => {
    expect(getTickSize(9_900)).toBe(10);
  });
  it('unknown exchange → fallback HOSE', () => {
    expect(getTickSize(9_900, 'FOOBAR')).toBe(10);
  });
});

describe('snapToTick — direction variants', () => {
  it('nearest rounds to closest valid tick', () => {
    expect(snapToTick(50_123, 'HOSE', 'nearest')).toBe(50_100);
    expect(snapToTick(50_175, 'HOSE', 'nearest')).toBe(50_200);
  });
  it('up snaps upward', () => {
    expect(snapToTick(50_001, 'HOSE', 'up')).toBe(50_100);
    expect(snapToTick(50_100, 'HOSE', 'up')).toBe(50_100); // on-tick stays
  });
  it('down snaps downward', () => {
    expect(snapToTick(50_099, 'HOSE', 'down')).toBe(50_000);
    expect(snapToTick(50_100, 'HOSE', 'down')).toBe(50_100);
  });
  it('default direction = nearest', () => {
    expect(snapToTick(50_123, 'HOSE')).toBe(50_100);
  });
});

describe('isValidTick', () => {
  it('returns true on-tick', () => {
    expect(isValidTick(50_000, 'HOSE')).toBe(true);
    expect(isValidTick(50_100, 'HOSE')).toBe(true);
    expect(isValidTick(9_990, 'HOSE')).toBe(true);
  });
  it('returns false off-tick', () => {
    expect(isValidTick(50_050, 'HOSE')).toBe(false); // tick 100 bucket
    expect(isValidTick(9_995, 'HOSE')).toBe(false);  // tick 10 bucket
  });
});

describe('getLotSize + validateLotSize — UPCOM lot = 100 FIX', () => {
  it('getLotSize returns 100 cho cả 3 sàn F0', () => {
    expect(getLotSize('HOSE')).toBe(100);
    expect(getLotSize('HNX')).toBe(100);
    expect(getLotSize('UPCOM')).toBe(100);
  });
  it('getLotSize unknown exchange → 100 fallback', () => {
    expect(getLotSize('FOOBAR')).toBe(100);
  });
  it('validateLotSize UPCOM 50 → rejected (FIX từ lot=1 cũ)', () => {
    const r = validateLotSize(50, 'UPCOM');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(ERRORS.LOT_INVALID);
  });
  it('validateLotSize UPCOM 100 → ok', () => {
    expect(validateLotSize(100, 'UPCOM').ok).toBe(true);
  });
  it('validateLotSize UPCOM 150 → rejected', () => {
    expect(validateLotSize(150, 'UPCOM').ok).toBe(false);
  });
  it('validateLotSize HOSE 200 → ok', () => {
    expect(validateLotSize(200, 'HOSE').ok).toBe(true);
  });
  it('qty 0 → rejected', () => {
    expect(validateLotSize(0, 'HOSE').ok).toBe(false);
  });
  it('qty negative → rejected', () => {
    expect(validateLotSize(-100, 'HOSE').ok).toBe(false);
  });
  it('qty non-integer → rejected', () => {
    expect(validateLotSize(100.5, 'HOSE').ok).toBe(false);
  });
  it('exact Vietnamese error message', () => {
    expect(validateLotSize(99, 'HOSE').reason)
      .toBe('Khối lượng phải là bội số 100 (tối thiểu 100 CP)');
  });
});

describe('getPriceBand — snap tick boundary CONTEXT §specifics', () => {
  it('HOSE reference 50_000 → ceiling 53_500 (1.07 = 53500 exact)', () => {
    const b = getPriceBand(50_000, 'HOSE');
    expect(b.ceiling).toBe(53_500);
    expect(b.floor).toBe(46_500);
    expect(b.pct).toBe(0.07);
    expect(b.reference).toBe(50_000);
  });
  it('HOSE reference 14_250 → ceiling 15_200, floor 13_300', () => {
    // 14250 × 1.07 = 15247.5, snap DOWN về tick 50 = 15200
    // (snap DOWN về tick 50 = 15200 — ceiling KHÔNG được vượt raw 7% band)
    // 14250 × 0.93 = 13252.5, snap UP về tick 50 = 13300 (floor không thấp hơn raw band)
    const b = getPriceBand(14_250, 'HOSE');
    expect(b.ceiling).toBe(15_200);
    expect(b.floor).toBe(13_300);
  });
  it('HNX reference 20_000 → ±10% = [18_000, 22_000]', () => {
    const b = getPriceBand(20_000, 'HNX');
    expect(b.ceiling).toBe(22_000);
    expect(b.floor).toBe(18_000);
    expect(b.pct).toBe(0.10);
  });
  it('UPCOM reference 10_000 → ±15% = [8_500, 11_500]', () => {
    const b = getPriceBand(10_000, 'UPCOM');
    expect(b.ceiling).toBe(11_500);
    expect(b.floor).toBe(8_500);
    expect(b.pct).toBe(0.15);
  });
});

describe('validatePriceInBand', () => {
  it('reference 0 → ok (skip check)', () => {
    expect(validatePriceInBand(100_000, 'HOSE', 0).ok).toBe(true);
  });
  it('reference null → ok (skip check)', () => {
    expect(validatePriceInBand(100_000, 'HOSE', null).ok).toBe(true);
  });
  it('reference undefined → ok (skip check)', () => {
    expect(validatePriceInBand(100_000, 'HOSE').ok).toBe(true);
  });
  it('price in band → ok với floor/ceiling', () => {
    const r = validatePriceInBand(51_000, 'HOSE', 50_000);
    expect(r.ok).toBe(true);
    expect(r.ceiling).toBe(53_500);
    expect(r.floor).toBe(46_500);
  });
  it('price above ceiling → rejected, reason chứa tên sàn + "ngoài biên độ ngày"', () => {
    const r = validatePriceInBand(54_000, 'HOSE', 50_000);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('HOSE');
    expect(r.reason).toContain('ngoài biên độ ngày');
    expect(r.ceiling).toBe(53_500);
  });
  it('price below floor → rejected', () => {
    const r = validatePriceInBand(40_000, 'HOSE', 50_000);
    expect(r.ok).toBe(false);
    expect(r.floor).toBe(46_500);
  });
});

describe('getMarketSession — session boundaries VN time', () => {
  it('HOSE 09:00:00 = ATO', () => {
    expect(getMarketSession('HOSE', vnDate('2026-04-20T09:00:00'))).toBe('ATO');
  });
  it('HOSE 09:14:59 = ATO (boundary)', () => {
    expect(getMarketSession('HOSE', vnDate('2026-04-20T09:14:59'))).toBe('ATO');
  });
  it('HOSE 09:15:00 = CONTINUOUS_1 (boundary+1)', () => {
    expect(getMarketSession('HOSE', vnDate('2026-04-20T09:15:00'))).toBe('CONTINUOUS_1');
  });
  it('HOSE 11:29:59 = CONTINUOUS_1', () => {
    expect(getMarketSession('HOSE', vnDate('2026-04-20T11:29:59'))).toBe('CONTINUOUS_1');
  });
  it('HOSE 11:30:00 = LUNCH', () => {
    expect(getMarketSession('HOSE', vnDate('2026-04-20T11:30:00'))).toBe('LUNCH');
  });
  it('HOSE 13:00:00 = CONTINUOUS_2', () => {
    expect(getMarketSession('HOSE', vnDate('2026-04-20T13:00:00'))).toBe('CONTINUOUS_2');
  });
  it('HOSE 14:30:00 = ATC', () => {
    expect(getMarketSession('HOSE', vnDate('2026-04-20T14:30:00'))).toBe('ATC');
  });
  it('HOSE 14:45:00 = PUT_THROUGH', () => {
    expect(getMarketSession('HOSE', vnDate('2026-04-20T14:45:00'))).toBe('PUT_THROUGH');
  });
  it('HOSE 15:00:00 = CLOSED', () => {
    expect(getMarketSession('HOSE', vnDate('2026-04-20T15:00:00'))).toBe('CLOSED');
  });
  it('UPCOM 14:44 = CONTINUOUS_2 (không có ATC)', () => {
    expect(getMarketSession('UPCOM', vnDate('2026-04-20T14:44:00'))).toBe('CONTINUOUS_2');
  });
  it('UPCOM 14:59 = CONTINUOUS_2', () => {
    expect(getMarketSession('UPCOM', vnDate('2026-04-20T14:59:00'))).toBe('CONTINUOUS_2');
  });
  it('UPCOM 15:00 = CLOSED', () => {
    expect(getMarketSession('UPCOM', vnDate('2026-04-20T15:00:00'))).toBe('CLOSED');
  });
  it('UPCOM 09:00 = CONTINUOUS_1 (no ATO)', () => {
    expect(getMarketSession('UPCOM', vnDate('2026-04-20T09:00:00'))).toBe('CONTINUOUS_1');
  });
  it('Saturday any time → CLOSED', () => {
    // 2026-04-18 = Thứ 7
    expect(getMarketSession('HOSE', vnDate('2026-04-18T10:00:00'))).toBe('CLOSED');
    expect(getMarketSession('UPCOM', vnDate('2026-04-18T14:00:00'))).toBe('CLOSED');
  });
  it('Sunday any time → CLOSED', () => {
    // 2026-04-19 = Chủ nhật
    expect(getMarketSession('HOSE', vnDate('2026-04-19T10:00:00'))).toBe('CLOSED');
  });
  it('Monday 08:59 = PRE_OPEN', () => {
    // 2026-04-20 = Thứ 2
    expect(getMarketSession('HOSE', vnDate('2026-04-20T08:59:00'))).toBe('PRE_OPEN');
  });
  it('HNX 09:00 = ATO', () => {
    expect(getMarketSession('HNX', vnDate('2026-04-20T09:00:00'))).toBe('ATO');
  });
  it('default exchange HOSE', () => {
    expect(getMarketSession(undefined, vnDate('2026-04-20T10:00:00'))).toBe('CONTINUOUS_1');
  });
  it('unknown exchange → HOSE fallback', () => {
    expect(getMarketSession('FOOBAR', vnDate('2026-04-20T10:00:00'))).toBe('CONTINUOUS_1');
  });
});

describe('isMarketOpen', () => {
  it('ATO/CONTINUOUS/ATC → open', () => {
    expect(isMarketOpen('HOSE', vnDate('2026-04-20T09:00:00'))).toBe(true);  // ATO
    expect(isMarketOpen('HOSE', vnDate('2026-04-20T10:00:00'))).toBe(true);  // CONTINUOUS_1
    expect(isMarketOpen('HOSE', vnDate('2026-04-20T13:30:00'))).toBe(true);  // CONTINUOUS_2
    expect(isMarketOpen('HOSE', vnDate('2026-04-20T14:30:00'))).toBe(true);  // ATC
  });
  it('PRE_OPEN/LUNCH/PUT_THROUGH/CLOSED → closed', () => {
    expect(isMarketOpen('HOSE', vnDate('2026-04-20T08:59:00'))).toBe(false); // PRE_OPEN
    expect(isMarketOpen('HOSE', vnDate('2026-04-20T12:00:00'))).toBe(false); // LUNCH
    expect(isMarketOpen('HOSE', vnDate('2026-04-20T14:50:00'))).toBe(false); // PUT_THROUGH
    expect(isMarketOpen('HOSE', vnDate('2026-04-20T15:30:00'))).toBe(false); // CLOSED
    expect(isMarketOpen('HOSE', vnDate('2026-04-18T10:00:00'))).toBe(false); // Saturday
  });
  it('UPCOM continuous suốt ngày → open (09:00-15:00 trừ lunch)', () => {
    expect(isMarketOpen('UPCOM', vnDate('2026-04-20T09:00:00'))).toBe(true);
    expect(isMarketOpen('UPCOM', vnDate('2026-04-20T14:44:00'))).toBe(true);
    expect(isMarketOpen('UPCOM', vnDate('2026-04-20T12:00:00'))).toBe(false); // LUNCH
  });
});

describe('ERRORS — lock exact Vietnamese strings', () => {
  it('LOT_INVALID static string', () => {
    expect(ERRORS.LOT_INVALID).toBe('Khối lượng phải là bội số 100 (tối thiểu 100 CP)');
  });
  it('TICK_INVALID formatter', () => {
    expect(ERRORS.TICK_INVALID(100, 'HOSE'))
      .toBe('Giá phải là bội số 100đ theo quy tắc sàn HOSE');
  });
  it('BAND_INVALID formatter chứa price/floor/ceiling/exchange', () => {
    const msg = ERRORS.BAND_INVALID(54_000, 46_500, 53_500, 'HOSE');
    expect(msg).toContain('HOSE');
    expect(msg).toContain('ngoài biên độ ngày');
  });
  it('MARKET_CLOSED formatter', () => {
    expect(ERRORS.MARKET_CLOSED('ATO', '09:00'))
      .toBe('Thị trường đóng cửa. Phiên ATO mở lúc 09:00');
  });
});

describe('backward-compat aliases', () => {
  it('snapToTickSize = snapToTick(_, _, nearest)', () => {
    expect(snapToTickSize(50_123, 'HOSE')).toBe(50_100);
  });
  it('isValidTickSize = isValidTick', () => {
    expect(isValidTickSize(50_000, 'HOSE')).toBe(true);
    expect(isValidTickSize(50_050, 'HOSE')).toBe(false);
  });
});
