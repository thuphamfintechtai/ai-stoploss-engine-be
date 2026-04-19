/**
 * Tests cho closePosition handler — tick + band validation.
 *
 * RED phase: Hiện tại handler KHÔNG có tick/band validation → test reject phải fail.
 * GREEN phase: Sau khi wire vnMarketRules, handler reject sai tick/band với HTTP 400.
 *
 * Mocks: Portfolio.findById (ownership), RealPositionService (service layer),
 *        marketPriceService.getMarketData (reference_price lookup).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Portfolio model — ownership check pass
vi.mock('../../models/Portfolio.js', () => ({
  default: {
    findById: vi.fn(),
  },
}));

// Mock RealPositionService — chứa position lookup + service call
vi.mock('../../services/portfolio/realPositionService.js', () => ({
  default: {
    closePosition: vi.fn(),
    getOpenPositions: vi.fn(),
    findPositionForClose: vi.fn(),
  },
}));

// Mock marketPriceService (shared) — reference price lookup
vi.mock('../../services/shared/marketPriceService.js', () => ({
  getMarketData: vi.fn(),
  getMarketPrice: vi.fn(),
  default: {
    getMarketData: vi.fn(),
    getMarketPrice: vi.fn(),
  },
}));

// Mock Position model — direct findById lookup ở handler
vi.mock('../../models/Position.js', () => ({
  default: {
    findById: vi.fn(),
  },
}));

import Portfolio from '../../models/Portfolio.js';
import Position from '../../models/Position.js';
import RealPositionService from '../../services/portfolio/realPositionService.js';
import { getMarketData } from '../../services/shared/marketPriceService.js';
import { closePosition } from '../../controllers/portfolio/realPosition.controller.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

function mockReq(overrides = {}) {
  return {
    params: { portfolioId: 'port-1', positionId: 'pos-1' },
    user: { userId: 'user-1' },
    validatedBody: {
      sell_price: 80000,
      sell_date: new Date().toISOString(),
      ...overrides,
    },
  };
}

describe('closePosition handler — tick + band validation (server authority)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Portfolio.findById.mockResolvedValue({ id: 'port-1', user_id: 'user-1' });
    Position.findById.mockResolvedValue({
      id: 'pos-1',
      portfolio_id: 'port-1',
      symbol: 'VNM',
      exchange: 'HOSE',
      status: 'OPEN',
    });
    RealPositionService.closePosition.mockResolvedValue({
      position: { id: 'pos-1' },
      pnl: { net_pnl_vnd: 100_000 },
      sellOrder: { id: 'ord-1' },
    });
    getMarketData.mockResolvedValue({ reference: 78_000 });
  });

  it('accept valid close (tick OK, band OK)', async () => {
    const req = mockReq({ sell_price: 80_000 });
    const res = mockRes();
    await closePosition(req, res, vi.fn());
    expect(res.statusCode).toBe(200);
    expect(res.body?.success).toBe(true);
  });

  it('reject sell_price sai tick với HTTP 400 (80050 HOSE >=50k cần tick 100đ)', async () => {
    const req = mockReq({ sell_price: 80_050 });
    const res = mockRes();
    await closePosition(req, res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body?.success).toBe(false);
    expect(res.body?.message).toContain('HOSE');
  });

  it('reject sell_price ngoài band (ref 78k HOSE → ceiling = 83500; sell 100000 out)', async () => {
    const req = mockReq({ sell_price: 100_000 });
    const res = mockRes();
    await closePosition(req, res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body?.success).toBe(false);
    expect(res.body?.message).toContain('biên độ');
  });

  it('graceful degrade khi DB không có reference_price (skip band, tick vẫn check)', async () => {
    getMarketData.mockResolvedValue({ reference: null });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = mockReq({ sell_price: 80_000 });
    const res = mockRes();
    await closePosition(req, res, vi.fn());
    expect(res.statusCode).toBe(200);
    const logged = warnSpy.mock.calls.some((args) =>
      args.join(' ').includes('No reference_price for')
    );
    expect(logged).toBe(true);
    warnSpy.mockRestore();
  });

  it('dùng position.exchange (không trust client-provided exchange)', async () => {
    Position.findById.mockResolvedValue({
      id: 'pos-1',
      portfolio_id: 'port-1',
      symbol: 'VNM',
      exchange: 'UPCOM',  // UPCOM tick 100, 80050 sai tick
      status: 'OPEN',
    });
    const req = mockReq({ sell_price: 80_050 });
    const res = mockRes();
    await closePosition(req, res, vi.fn());
    expect(res.statusCode).toBe(400);
    expect(res.body?.message).toContain('UPCOM');
  });

  it('return 404 khi position không tồn tại', async () => {
    Position.findById.mockResolvedValue(null);
    const req = mockReq({ sell_price: 80_000 });
    const res = mockRes();
    await closePosition(req, res, vi.fn());
    expect(res.statusCode).toBe(404);
    expect(res.body?.success).toBe(false);
  });

  it('return 403 khi position không thuộc portfolio của user', async () => {
    Position.findById.mockResolvedValue({
      id: 'pos-1',
      portfolio_id: 'port-OTHER',
      symbol: 'VNM',
      exchange: 'HOSE',
      status: 'OPEN',
    });
    const req = mockReq({ sell_price: 80_000 });
    const res = mockRes();
    await closePosition(req, res, vi.fn());
    expect(res.statusCode).toBe(403);
    expect(res.body?.success).toBe(false);
  });
});
