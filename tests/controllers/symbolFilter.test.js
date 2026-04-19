/**
 * Tests cho symbol filter (MDI-03).
 *
 * Behavior:
 * - GET /api/market/symbols chỉ trả rows có is_enabled = TRUE AND is_listed = TRUE
 * - getSymbolInfo trả 404 cho mã delisted (is_listed = FALSE)
 * - getEntryInfo tra cứu exchange từ DB với cùng filter — nếu không thấy row, vẫn proceed
 *   (graceful degrade) nhưng query phải chứa is_listed clause
 *
 * Strategy: mock config/database.js `query` để intercept SQL + verify WHERE clauses
 * + trả rows theo scenario.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock pg query — intercept SQL + trả rows
vi.mock('../../config/database.js', () => ({
  query: vi.fn(),
}));

// Mock marketPriceService để getEntryInfo không gọi VPBS thật
vi.mock('../../services/marketPriceService.js', () => ({
  getMarketData: vi.fn(async () => ({ price: null, quantity: null, reference: null })),
}));

import { query } from '../../config/database.js';
import { getMarketData } from '../../services/marketPriceService.js';
import {
  getSymbols,
  getSymbolInfo,
  getEntryInfo,
} from '../../controllers/market.controller.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

describe('getSymbols — filter is_listed + is_enabled (MDI-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('query SQL chứa is_listed filter (backward-compat NULL OR TRUE)', async () => {
    query.mockResolvedValue({ rows: [] });

    const req = { query: {} };
    const res = mockRes();
    await getSymbols(req, res, vi.fn());

    expect(query).toHaveBeenCalled();
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('is_listed');
  });

  it('query SQL mặc định filter is_enabled = TRUE (không cần query param)', async () => {
    query.mockResolvedValue({ rows: [] });
    const req = { query: {} };
    const res = mockRes();
    await getSymbols(req, res, vi.fn());

    const sql = query.mock.calls[0][0];
    // default filter: is_enabled phải hiện diện kể cả user không pass query.is_enabled
    expect(sql).toContain('is_enabled');
  });

  it('trả về rows đã lọc (DB sẽ loại delisted/disabled — controller chỉ relay)', async () => {
    // Mock DB đã apply WHERE → chỉ trả 2 rows active
    query.mockResolvedValue({
      rows: [
        { symbol: 'ABC', exchange: 'HOSE' },
        { symbol: 'DEF', exchange: 'HNX' },
      ],
    });
    const req = { query: {} };
    const res = mockRes();
    await getSymbols(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.count).toBe(2);
    expect(res.body.data.map(r => r.symbol)).toEqual(['ABC', 'DEF']);
  });

  it('empty khi không có row match filter (all delisted case)', async () => {
    query.mockResolvedValue({ rows: [] });
    const req = { query: {} };
    const res = mockRes();
    await getSymbols(req, res, vi.fn());

    expect(res.body.count).toBe(0);
    expect(res.body.data).toEqual([]);
  });
});

describe('getSymbolInfo — 404 khi symbol delisted (MDI-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('query SQL chứa is_listed clause', async () => {
    query.mockResolvedValue({ rows: [{ symbol: 'ABC', exchange: 'HOSE' }] });
    const req = { params: { symbol: 'ABC' } };
    const res = mockRes();
    await getSymbolInfo(req, res, vi.fn());

    const sql = query.mock.calls[0][0];
    expect(sql).toContain('is_listed');
  });

  it('200 khi symbol active (is_enabled=TRUE, is_listed=TRUE)', async () => {
    query.mockResolvedValue({ rows: [{ symbol: 'ABC', exchange: 'HOSE' }] });
    const req = { params: { symbol: 'ABC' } };
    const res = mockRes();
    await getSymbolInfo(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.symbol).toBe('ABC');
  });

  it('404 khi symbol không thấy (DB đã lọc delisted ở WHERE)', async () => {
    // Mock DB đã apply WHERE is_listed = TRUE → row delisted bị lọc → rows empty
    query.mockResolvedValue({ rows: [] });
    const req = { params: { symbol: 'DELISTED' } };
    const res = mockRes();
    await getSymbolInfo(req, res, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('DELISTED');
  });

  it('400 khi symbol thiếu/empty', async () => {
    const req = { params: { symbol: '' } };
    const res = mockRes();
    await getSymbolInfo(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('getEntryInfo — SQL lookup filter is_listed (MDI-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMarketData.mockResolvedValue({ price: null, quantity: null, reference: null });
  });

  it('query SQL lookup exchange chứa is_listed clause', async () => {
    query.mockResolvedValue({ rows: [{ exchange: 'HOSE' }] });
    const req = { params: { symbol: 'ABC' }, query: {} };
    const res = mockRes();
    await getEntryInfo(req, res, vi.fn());

    // First query call should be the exchange lookup
    const sql = query.mock.calls[0]?.[0] ?? '';
    expect(sql).toContain('is_listed');
  });

  it('400 khi symbol empty', async () => {
    const req = { params: { symbol: '   ' }, query: {} };
    const res = mockRes();
    await getEntryInfo(req, res, vi.fn());

    expect(res.statusCode).toBe(400);
  });
});
