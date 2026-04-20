/**
 * Tests cho symbolInfoRateLimit middleware (MDI-08, T-05-11).
 *
 * Behavior:
 *  - 60 req đầu trong cửa sổ 60s → pass (status handler-level, ở đây 200).
 *  - Request 61 từ cùng IP → 429 + body { success: false, code: 'RATE_LIMITED' }.
 *  - 2 IP khác nhau có counter riêng (IP-based key).
 *  - /indices KHÔNG bị chia sẻ counter (scope tách biệt) — ta test middleware cô lập
 *    không áp dụng cho path khác: nếu middleware không mount vào path đó thì counter không tăng.
 *
 * Strategy:
 *  - Dùng express app mini, mount middleware lên 1 route test, gọi handler trực tiếp.
 *  - Tạo fresh middleware instance per-test để reset counter.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';

/**
 * Start an ephemeral express server và trả về base URL + close handle.
 */
async function startServer(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

describe('symbolInfoRateLimit middleware — MDI-08', () => {
  let serverHandle;

  afterEach(async () => {
    if (serverHandle) {
      await serverHandle.close();
      serverHandle = null;
    }
  });

  it('Scenario 4a: 60 requests đầu đều qua (không 429)', async () => {
    // Fresh import per test để counter mới
    const { symbolInfoRateLimit } = await import('../../middleware/symbolInfoRateLimit.js?case=a');
    const app = express();
    app.set('trust proxy', true);
    app.get('/symbols/:symbol/info', symbolInfoRateLimit, (req, res) => {
      res.json({ ok: true, symbol: req.params.symbol });
    });
    serverHandle = await startServer(app);

    // Gửi 60 requests từ cùng IP — dùng X-Forwarded-For (express trust proxy)
    const results = [];
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`${serverHandle.url}/symbols/VNM/info`);
      results.push(r.status);
    }
    expect(results.every((s) => s === 200)).toBe(true);
  }, 15000);

  it('Scenario 4b: Request thứ 61 từ cùng IP → 429 + body code=RATE_LIMITED', async () => {
    const { symbolInfoRateLimit } = await import('../../middleware/symbolInfoRateLimit.js?case=b');
    const app = express();
    app.get('/symbols/:symbol/info', symbolInfoRateLimit, (req, res) => {
      res.json({ ok: true });
    });
    serverHandle = await startServer(app);

    // Consume 60 pass
    for (let i = 0; i < 60; i++) {
      await fetch(`${serverHandle.url}/symbols/VNM/info`);
    }
    // Request 61 must be 429
    const r = await fetch(`${serverHandle.url}/symbols/VNM/info`);
    expect(r.status).toBe(429);
    const body = await r.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('RATE_LIMITED');
    expect(typeof body.message).toBe('string');
  }, 20000);

  it('Scenario 5: Middleware không mount trên /indices → không ảnh hưởng path khác', async () => {
    const { symbolInfoRateLimit } = await import('../../middleware/symbolInfoRateLimit.js?case=c');
    const app = express();
    // Chỉ /symbols/:s/info bị rate limit — /indices không
    app.get('/symbols/:symbol/info', symbolInfoRateLimit, (req, res) => res.json({ path: 'info' }));
    app.get('/indices', (req, res) => res.json({ path: 'indices' }));
    serverHandle = await startServer(app);

    // Gọi /indices nhiều lần (hơn 60) → counter KHÔNG tăng cho /symbols/... và /indices luôn 200
    for (let i = 0; i < 65; i++) {
      const r = await fetch(`${serverHandle.url}/indices`);
      expect(r.status).toBe(200);
    }
    // Và /symbols/VNM/info vẫn còn full quota 60
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`${serverHandle.url}/symbols/VNM/info`);
      expect(r.status).toBe(200);
    }
  }, 25000);
});

// Import local afterEach from vitest (ESM hoisting safety — some setups need explicit import).
import { afterEach } from 'vitest';
