/**
 * aiRateLimit.test.js — AIT-05 (D-05)
 *
 * Test middleware `aiRateLimit` (per-user rate limit 10 calls / 10 phút).
 *
 * Strategy: Gọi middleware trực tiếp với mock req/res (không cần supertest).
 * - req.user.userId làm key
 * - res mock capture status code + JSON body + headers
 *
 * Threat mitigated: T-04-04 (user spam /api/ai/* gây cost Gemini API cao).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tạo mock response object ghi lại status / body / headers.
 */
function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(data) { this.body = data; return this; },
    send(data) { this.body = data; return this; },
    end(data) { if (data !== undefined) this.body = data; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); return this; },
    getHeader(name) { return this.headers[name.toLowerCase()]; },
    removeHeader(name) { delete this.headers[name.toLowerCase()]; },
    // express-rate-limit v7 dùng res.setHeader chính — alias đủ
    header(name, value) { return this.setHeader(name, value); },
  };
  return res;
}

/**
 * Tạo mock request với user + path cho trước.
 */
function createMockReq({ userId = 'A', path = '/test', ip = '127.0.0.1' } = {}) {
  return {
    user: userId ? { userId } : undefined,
    path,
    ip,
    method: 'GET',
    headers: {},
    // Object dùng bởi express-rate-limit internals
    app: { get: () => undefined },
    url: path,
    originalUrl: path,
  };
}

/**
 * Helper: gọi middleware và trả về { res, nextCalled }.
 */
function invokeMiddleware(middleware, reqOverrides = {}) {
  return new Promise((resolve) => {
    const req = createMockReq(reqOverrides);
    const res = createMockRes();
    let nextCalled = false;
    const next = () => { nextCalled = true; };
    middleware(req, res, next);
    // express-rate-limit v7 là async (store.increment có thể là promise) → cần chờ
    setImmediate(() => resolve({ req, res, nextCalled }));
  });
}

/**
 * Reset module cache + env → load aiRateLimit mới.
 * Gọi trước mỗi test để store counter + env đọc lại fresh.
 */
async function loadMiddleware(envOverrides = {}) {
  vi.resetModules();
  // Clear all AI rate limit env vars
  delete process.env.AI_RATE_LIMIT_PER_10MIN;
  for (const [k, v] of Object.entries(envOverrides)) {
    process.env[k] = v;
  }
  const mod = await import('../../middleware/aiRateLimit.js');
  return mod.aiRateLimit || mod.default;
}

describe('aiRateLimit middleware — AIT-05 (D-05)', () => {
  beforeEach(() => {
    // reset env mỗi test để không leak
    delete process.env.AI_RATE_LIMIT_PER_10MIN;
  });

  it('Test 1.1 — 10 request đầu cùng 1 user → tất cả pass (next called)', async () => {
    const mw = await loadMiddleware();
    const results = [];
    for (let i = 0; i < 10; i++) {
      const r = await invokeMiddleware(mw, { userId: 'user-A', path: '/signals' });
      results.push(r);
    }
    expect(results.length).toBe(10);
    for (const r of results) {
      expect(r.nextCalled).toBe(true);
      expect(r.res.statusCode).toBe(200);
    }
  });

  it('Test 1.2 — Request thứ 11 cùng user → 429 với body tiếng Việt + Retry-After', async () => {
    const mw = await loadMiddleware();
    // Dùng 10 slot đầu
    for (let i = 0; i < 10; i++) {
      await invokeMiddleware(mw, { userId: 'user-B', path: '/signals' });
    }
    // Request thứ 11
    const { res, nextCalled } = await invokeMiddleware(mw, { userId: 'user-B', path: '/signals' });
    expect(res.statusCode).toBe(429);
    expect(nextCalled).toBe(false);
    expect(res.body).toMatchObject({
      success: false,
      retry_after_seconds: expect.any(Number),
    });
    expect(res.body.message).toMatch(/Bạn đã dùng hết lượt AI/);
    expect(res.body.message).toMatch(/thử lại sau/);
    expect(res.body.retry_after_seconds).toBeGreaterThanOrEqual(1);
    // Retry-After header
    const retryHeader = res.headers['retry-after'];
    expect(retryHeader).toBeDefined();
    expect(parseInt(retryHeader, 10)).toBeGreaterThanOrEqual(1);
  });

  it('Test 1.3 — Per-user isolation: A vượt limit → B vẫn pass', async () => {
    const mw = await loadMiddleware();
    // User A dùng hết 10 slot + 1 reject
    for (let i = 0; i < 10; i++) {
      await invokeMiddleware(mw, { userId: 'user-iso-A', path: '/signals' });
    }
    const aBlocked = await invokeMiddleware(mw, { userId: 'user-iso-A', path: '/signals' });
    expect(aBlocked.res.statusCode).toBe(429);

    // User B làm request đầu → phải pass
    const bPass = await invokeMiddleware(mw, { userId: 'user-iso-B', path: '/signals' });
    expect(bPass.nextCalled).toBe(true);
    expect(bPass.res.statusCode).toBe(200);
  });

  it('Test 1.4 — /health skip rate limit: 15 request /health đều pass', async () => {
    const mw = await loadMiddleware();
    const results = [];
    for (let i = 0; i < 15; i++) {
      const r = await invokeMiddleware(mw, { userId: 'user-health', path: '/health' });
      results.push(r);
    }
    for (const r of results) {
      expect(r.nextCalled).toBe(true);
      expect(r.res.statusCode).toBe(200);
    }
  });

  it('Test 1.5 — Env AI_RATE_LIMIT_PER_10MIN=3 override → request thứ 4 reject', async () => {
    const mw = await loadMiddleware({ AI_RATE_LIMIT_PER_10MIN: '3' });
    for (let i = 0; i < 3; i++) {
      const r = await invokeMiddleware(mw, { userId: 'user-env', path: '/signals' });
      expect(r.nextCalled).toBe(true);
    }
    const fourth = await invokeMiddleware(mw, { userId: 'user-env', path: '/signals' });
    expect(fourth.res.statusCode).toBe(429);
  });

  it('Test 1.6 — Retry-After header format là chuỗi số nguyên giây ≥ 1', async () => {
    const mw = await loadMiddleware();
    for (let i = 0; i < 10; i++) {
      await invokeMiddleware(mw, { userId: 'user-retry', path: '/signals' });
    }
    const { res } = await invokeMiddleware(mw, { userId: 'user-retry', path: '/signals' });
    expect(res.statusCode).toBe(429);
    const header = res.headers['retry-after'];
    expect(header).toBeDefined();
    // Phải là chuỗi chứa số nguyên
    expect(String(header)).toMatch(/^\d+$/);
    expect(parseInt(header, 10)).toBeGreaterThanOrEqual(1);
  });
});
