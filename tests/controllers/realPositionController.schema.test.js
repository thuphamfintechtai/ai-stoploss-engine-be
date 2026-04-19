/**
 * Tests cho closePositionSchema + handler tick/band logic.
 *
 * Schema tests: minimal body (sell_price, sell_date, notes); client exchange/reference_price stripped.
 * Handler tick/band validation được test qua integration — ở đây chỉ verify schema shape + helper export.
 */

import { describe, it, expect } from 'vitest';
import { closePositionSchema } from '../../controllers/portfolio/realPosition.controller.js';

const baseValid = {
  sell_price: 80000,
  sell_date: new Date().toISOString(),
};

describe('closePositionSchema — minimal body (server authority cho exchange)', () => {
  it('accept minimal body (sell_price + sell_date)', () => {
    const { error } = closePositionSchema.validate(baseValid);
    expect(error).toBeUndefined();
  });

  it('accept body với notes', () => {
    const { error } = closePositionSchema.validate({ ...baseValid, notes: 'test close' });
    expect(error).toBeUndefined();
  });

  it('reject sell_price âm', () => {
    const { error } = closePositionSchema.validate({ ...baseValid, sell_price: -100 });
    expect(error).toBeDefined();
  });

  it('reject sell_price = 0', () => {
    const { error } = closePositionSchema.validate({ ...baseValid, sell_price: 0 });
    expect(error).toBeDefined();
  });

  it('strip unknown client exchange (policy: server authority từ position record)', () => {
    const raw = { ...baseValid, exchange: 'HOSE' };
    const { error, value } = closePositionSchema.validate(raw, { stripUnknown: true });
    expect(error).toBeUndefined();
    expect(value.exchange).toBeUndefined();
  });

  it('strip unknown client reference_price (policy: server lookup từ DB)', () => {
    const raw = { ...baseValid, reference_price: 78000 };
    const { error, value } = closePositionSchema.validate(raw, { stripUnknown: true });
    expect(error).toBeUndefined();
    expect(value.reference_price).toBeUndefined();
  });

  it('reject sell_date không phải ISO', () => {
    const { error } = closePositionSchema.validate({ ...baseValid, sell_date: 'not-a-date' });
    expect(error).toBeDefined();
  });
});
