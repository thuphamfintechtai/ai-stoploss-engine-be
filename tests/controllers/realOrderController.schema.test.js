/**
 * Tests cho createRealOrderSchema — Joi validators wire vnMarketRules.
 *
 * RED phase: Viết test PHẢI fail với schema hiện tại (chưa có custom validators).
 * GREEN phase: Sau khi wire validators, tests MUST pass.
 */

import { describe, it, expect } from 'vitest';
import { createRealOrderSchema } from '../../controllers/portfolio/realOrder.controller.js';

const baseValid = {
  symbol: 'VNM',
  exchange: 'HOSE',
  side: 'BUY',
  quantity: 100,
  filled_price: 80000,
  filled_date: new Date().toISOString(),
};

describe('createRealOrderSchema — vnMarketRules validators', () => {
  it('accept valid order (lot=100 HOSE, tick 100đ)', () => {
    const { error } = createRealOrderSchema.validate(baseValid);
    expect(error).toBeUndefined();
  });

  it('reject quantity 150 HOSE (lot invalid)', () => {
    const { error } = createRealOrderSchema.validate({ ...baseValid, quantity: 150 });
    expect(error).toBeDefined();
    expect(error.message).toContain('Khối lượng');
  });

  it('reject quantity 50 UPCOM (lot=100, 50 < lot)', () => {
    const { error } = createRealOrderSchema.validate({ ...baseValid, exchange: 'UPCOM', quantity: 50 });
    expect(error).toBeDefined();
    expect(error.message).toContain('Khối lượng');
  });

  it('accept quantity 100 UPCOM (lot valid)', () => {
    const { error } = createRealOrderSchema.validate({ ...baseValid, exchange: 'UPCOM', quantity: 100 });
    expect(error).toBeUndefined();
  });

  it('reject filled_price 80050 HOSE (tick invalid, >=50k cần 100đ)', () => {
    const { error } = createRealOrderSchema.validate({ ...baseValid, filled_price: 80050 });
    expect(error).toBeDefined();
    expect(error.message).toContain('HOSE');
  });

  it('accept filled_price 49950 HOSE (tick 50đ bucket cuối)', () => {
    const { error } = createRealOrderSchema.validate({ ...baseValid, filled_price: 49950 });
    expect(error).toBeUndefined();
  });

  it('reject filled_price 49975 HOSE (tick 50, 49975 không chia hết 50)', () => {
    const { error } = createRealOrderSchema.validate({ ...baseValid, filled_price: 49975 });
    expect(error).toBeDefined();
    expect(error.message).toContain('HOSE');
  });

  it('reject filled_price 80050 HNX (tick 100đ, 80050 không chia hết 100)', () => {
    const { error } = createRealOrderSchema.validate({ ...baseValid, exchange: 'HNX', filled_price: 80050 });
    expect(error).toBeDefined();
    expect(error.message).toContain('HNX');
  });

  it('strip unknown reference_price client-provided (policy: không trust client)', () => {
    // stripUnknown:true sẽ strip field không khai báo. Nếu schema accept reference_price là fail.
    const raw = { ...baseValid, reference_price: 78000 };
    const { error, value } = createRealOrderSchema.validate(raw, { stripUnknown: true });
    expect(error).toBeUndefined();
    expect(value.reference_price).toBeUndefined();
  });

  it('still validate other required fields (symbol required)', () => {
    const { error } = createRealOrderSchema.validate({ ...baseValid, symbol: undefined });
    expect(error).toBeDefined();
  });

  it('still validate other required fields (exchange valid enum)', () => {
    const { error } = createRealOrderSchema.validate({ ...baseValid, exchange: 'NYSE' });
    expect(error).toBeDefined();
  });
});
