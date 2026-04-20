/**
 * Tests cho GET /api/market/indices (MDI-06, T-05-12, T-05-14).
 *
 * Behavior:
 *  - Thành công: 3 indices VNINDEX/VN30/HNXINDEX, shape { indexCode, success, value, change, changePercent, timestamp }.
 *  - Partial fail (1/3 fail upstream) → vẫn 200, item fail có success=false + error string.
 *  - Toàn bộ fail → 503 + code=UPSTREAM_UNAVAILABLE.
 *
 * Strategy:
 *  - Mock global.fetch (controller dùng fetchJson → fetch bên dưới).
 *  - Gọi handler trực tiếp với mock req/res (không cần supertest).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Mock Response cho fetch.
 */
function makeResponse(bodyObj, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(bodyObj),
  };
}

function makeHtmlResponse(status = 500) {
  return {
    ok: false,
    status,
    text: async () => '<html><body>503 gateway</body></html>',
  };
}

/**
 * Payload chuẩn VPBS intradayMarketIndex — dùng field giống getMarketIndexDetail.
 */
function vpbsIndexPayload({ indexCode, value, change, percent, time = '2026-04-18T10:15:00Z' }) {
  return {
    status: 1,
    data: {
      indexCode,
      indexValue: value,
      indexChange: change,
      indexPercentChange: percent,
      indexTime: time,
    },
  };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.headersSent = true; return this; },
  };
  return res;
}

function mockReq() {
  return { query: {}, params: {}, ip: '127.0.0.1' };
}

describe('GET /api/market/indices — getMarketIndices handler', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    global.fetch = fetchMock;
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it('Scenario 1: 3 indices success → 200 + data array 3 items with normalized shape', async () => {
    // Arrange: 3 VPBS responses OK
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('VNINDEX')) {
        return makeResponse(vpbsIndexPayload({ indexCode: 'VNINDEX', value: 1234.56, change: 5.67, percent: 0.46 }));
      }
      if (String(url).includes('VN30')) {
        return makeResponse(vpbsIndexPayload({ indexCode: 'VN30', value: 1300.00, change: -1.23, percent: -0.09 }));
      }
      if (String(url).includes('HNXINDEX')) {
        return makeResponse(vpbsIndexPayload({ indexCode: 'HNXINDEX', value: 234.12, change: 0.12, percent: 0.05 }));
      }
      return makeHtmlResponse(500);
    });

    const { getMarketIndices } = await import('../../controllers/market.controller.js');
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    // Act
    await getMarketIndices(req, res, next);

    // Assert
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(3);

    const vn = res.body.data.find((d) => d.indexCode === 'VNINDEX');
    expect(vn).toBeDefined();
    expect(vn.success).toBe(true);
    expect(vn.value).toBe(1234.56);
    expect(vn.change).toBe(5.67);
    expect(vn.changePercent).toBe(0.46);
    expect(vn.timestamp).toBe('2026-04-18T10:15:00Z');

    const codes = res.body.data.map((d) => d.indexCode);
    expect(codes).toEqual(['VNINDEX', 'VN30', 'HNXINDEX']);
  });

  it('Scenario 2: Partial fail (HNXINDEX down) → 200 với 3 items, fail item success=false', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (String(url).includes('VNINDEX')) {
        return makeResponse(vpbsIndexPayload({ indexCode: 'VNINDEX', value: 1234.56, change: 5.67, percent: 0.46 }));
      }
      if (String(url).includes('VN30')) {
        return makeResponse(vpbsIndexPayload({ indexCode: 'VN30', value: 1300.00, change: -1.23, percent: -0.09 }));
      }
      // HNXINDEX fail upstream (HTML)
      return makeHtmlResponse(500);
    });

    const { getMarketIndices } = await import('../../controllers/market.controller.js');
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await getMarketIndices(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(3);

    const hnx = res.body.data.find((d) => d.indexCode === 'HNXINDEX');
    expect(hnx).toBeDefined();
    expect(hnx.success).toBe(false);
    expect(hnx.error).toBeTruthy();
    expect(typeof hnx.error).toBe('string');

    // Indices thành công vẫn OK
    const vn = res.body.data.find((d) => d.indexCode === 'VNINDEX');
    expect(vn.success).toBe(true);
    expect(vn.value).toBe(1234.56);
  });

  it('Scenario 3: Tất cả 3 indices fail → 503 UPSTREAM_UNAVAILABLE', async () => {
    fetchMock.mockImplementation(async () => makeHtmlResponse(503));

    const { getMarketIndices } = await import('../../controllers/market.controller.js');
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await getMarketIndices(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(res.body.message).toMatch(/temporarily unavailable/i);
  });
});
