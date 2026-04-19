/**
 * feeEngine — MAP-05 D-06 LOCKED scope: integer VND guards at input.
 *
 * Verify:
 *   - calculateFees / calculateBuyFee / calculateBreakEven ep integer VND dau vao
 *     (Math.round(Number(x))) → defense-in-depth khi caller truyen float (vd parseFloat
 *     tu worker, string tu DB NUMERIC).
 *   - Khong parseFloat cong don noi bo.
 *   - Ket qua integer cho phi, tax va pnl.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateFees,
  calculateBuyFee,
  calculateBreakEven,
} from '../../services/shared/feeEngine.js';

describe('feeEngine.calculateFees — integer VND guards (MAP-05 D-06)', () => {
  const portfolio = {
    buy_fee_percent: 0.0015,
    sell_fee_percent: 0.0015,
    sell_tax_percent: 0.001,
  };

  it('integer input: ket qua dung, tat ca field integer', () => {
    const result = calculateFees(80000, 85000, 100, portfolio);
    // buy_fee = round(80000*100*0.0015) = 12000
    expect(result.buy_fee_vnd).toBe(12000);
    // sell_fee = round(85000*100*0.0015) = 12750
    expect(result.sell_fee_vnd).toBe(12750);
    // sell_tax = round(85000*100*0.001) = 8500
    expect(result.sell_tax_vnd).toBe(8500);
    // gross_pnl = (85000-80000)*100 = 500000
    expect(result.gross_pnl_vnd).toBe(500000);
    // net_pnl = 500000 - 12000 - 12750 - 8500 = 466750
    expect(result.net_pnl_vnd).toBe(466750);

    // Tat ca field phai la integer
    expect(Number.isInteger(result.buy_fee_vnd)).toBe(true);
    expect(Number.isInteger(result.sell_fee_vnd)).toBe(true);
    expect(Number.isInteger(result.sell_tax_vnd)).toBe(true);
    expect(Number.isInteger(result.gross_pnl_vnd)).toBe(true);
    expect(Number.isInteger(result.net_pnl_vnd)).toBe(true);
    expect(Number.isInteger(result.total_fee_vnd)).toBe(true);
  });

  it('string input tu DB NUMERIC: ep Number + Math.round, khong NaN', () => {
    const result = calculateFees('80000.00', '85000.00', '100', portfolio);
    expect(result.gross_pnl_vnd).toBe(500000);
    expect(Number.isInteger(result.gross_pnl_vnd)).toBe(true);
    expect(Number.isInteger(result.net_pnl_vnd)).toBe(true);
  });

  it('float input co decimals (parseFloat chain): ket qua van integer sau Math.round', () => {
    // Input .49 → round down 80000, .51 → round up 85001
    const result = calculateFees(80000.49, 85000.51, 100, portfolio);
    // entryRound=80000, closeRound=85001 → gross=(85001-80000)*100=500100
    expect(result.gross_pnl_vnd).toBe(500100);
    expect(Number.isInteger(result.gross_pnl_vnd)).toBe(true);
    expect(Number.isInteger(result.net_pnl_vnd)).toBe(true);
  });

  it('default fallback khi portfolio empty: dung DEFAULT_* percents', () => {
    const result = calculateFees(80000, 85000, 100, {});
    // Dung default: buy=0.0015, sell=0.0015, tax=0.001 — cung value nhu co config
    expect(result.buy_fee_vnd).toBe(12000);
    expect(result.sell_fee_vnd).toBe(12750);
    expect(result.sell_tax_vnd).toBe(8500);
  });

  it('gross_pnl_vnd tinh tren integer (khong float drift)', () => {
    // Test edge case: gia tri lon de phat hien float precision
    const result = calculateFees(100000, 100001, 1000000, portfolio);
    // gross = 1*1000000 = 1,000,000 — phai chinh xac, khong float
    expect(result.gross_pnl_vnd).toBe(1_000_000);
    expect(Number.isInteger(result.gross_pnl_vnd)).toBe(true);
  });
});

describe('feeEngine.calculateBuyFee — integer VND guards', () => {
  it('integer input → integer fee', () => {
    const fee = calculateBuyFee(80000, 100, { buy_fee_percent: 0.0015 });
    expect(fee).toBe(12000);
    expect(Number.isInteger(fee)).toBe(true);
  });

  it('string input → ep Number + round → integer', () => {
    const fee = calculateBuyFee('80000.00', '100', { buy_fee_percent: '0.0015' });
    expect(Number.isInteger(fee)).toBe(true);
    expect(fee).toBe(12000);
  });

  it('default percent khi portfolio empty', () => {
    const fee = calculateBuyFee(80000, 100, {});
    expect(fee).toBe(12000); // DEFAULT 0.0015
    expect(Number.isInteger(fee)).toBe(true);
  });

  it('float input co decimals: Math.round dau vao → integer result', () => {
    const fee = calculateBuyFee(80000.49, 100, { buy_fee_percent: 0.0015 });
    // Math.round(80000.49) = 80000, fee = round(80000*100*0.0015) = 12000
    expect(fee).toBe(12000);
    expect(Number.isInteger(fee)).toBe(true);
  });
});

describe('feeEngine.calculateBreakEven — integer VND guards', () => {
  const portfolio = {
    buy_fee_percent: 0.0015,
    sell_fee_percent: 0.0015,
    sell_tax_percent: 0.001,
  };

  it('integer input → integer break-even price', () => {
    const be = calculateBreakEven(80000, 100, portfolio);
    expect(Number.isInteger(be)).toBe(true);
    // break-even > entry (vi phai phu phi)
    expect(be).toBeGreaterThan(80000);
  });

  it('string input: ep Number → khong NaN, integer result', () => {
    const be = calculateBreakEven('80000', '100', portfolio);
    expect(Number.isInteger(be)).toBe(true);
    expect(be).toBeGreaterThan(80000);
  });

  it('Math.ceil giu nguyen semantics (round up break-even)', () => {
    // Formula: breakEven >= (entryVnd * qty + buyFee) / qty / (1 - sellPct - taxPct)
    // entry=10000, qty=100, buyFee=round(10000*100*0.0015)=1500
    // denominator = 1 - 0.0015 - 0.001 = 0.9975
    // breakEven = ceil((10000*100 + 1500) / 100 / 0.9975) = ceil(1001500/99.75) = ceil(10040.1002...) = 10041
    const be = calculateBreakEven(10000, 100, portfolio);
    expect(be).toBe(10041);
  });
});
