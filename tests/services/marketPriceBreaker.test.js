/**
 * Tests cho marketPriceService × CircuitBreaker integration (MDI-09, T-05-10).
 *
 * Behavior:
 *  - VPBS fetch success → breaker CLOSED + cache fresh data per-symbol
 *  - 3 VPBS fail liên tiếp trong 5 phút → breaker OPEN; calls kế tiếp return cached với stale:true
 *  - Breaker OPEN + no cache → shape cũ preserve với error rõ ràng "VPBS circuit open"
 *  - Sau cooldown 10 phút, probe success → breaker CLOSED + refresh cache (stale:false)
 *
 * Strategy:
 *  - Mock global.fetch (module-level singleton breaker dùng fetch trực tiếp)
 *  - Mỗi test tạo fresh module qua vi.resetModules() để reset breaker + cache
 *  - fake timers cho windowMs/cooldownMs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ADV_URL = /stockAdvancedInfo/;
const OB_URL = /matchingHistoryBuyUpSellDown/;

/**
 * Tạo mock Response object.
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
    text: async () => '<html><body>503 service down</body></html>',
  };
}

/**
 * Valid advanced info payload → yields price=85000, reference=84000.
 */
const ADV_OK = {
  status: 1,
  data: [
    {
      closePrice: 85000,
      reference: 84000,
      high: 86000,
      low: 83000,
      totalTrading: 120000,
    },
  ],
};

const OB_OK = { data: { priceStatistic: [] } };

/**
 * Import fresh marketPriceService module (reset module-scope breaker + cache).
 */
async function loadFreshService() {
  vi.resetModules();
  const mod = await import('../../services/shared/marketPriceService.js');
  return mod;
}

describe('marketPriceService × CircuitBreaker (MDI-09)', () => {
  let originalFetch;
  let fetchSpy;
  let logSpy;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-20T10:00:00Z'));
    originalFetch = globalThis.fetch;
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Scenario 1: fetch OK → data match expected, cache fresh', async () => {
    fetchSpy = vi.fn(async (url) => {
      if (ADV_URL.test(url)) return makeResponse(ADV_OK);
      if (OB_URL.test(url)) return makeResponse(OB_OK);
      return makeResponse({});
    });
    globalThis.fetch = fetchSpy;

    const { getMarketData } = await loadFreshService();
    const result = await getMarketData('VNM');

    expect(result.price).toBe(85000);
    expect(result.reference).toBe(84000);
    expect(result.stale).toBeFalsy();
    expect(fetchSpy).toHaveBeenCalledTimes(2); // advanced + orderbook
  });

  it('Scenario 2: 3 VPBS fail → breaker OPEN, 4th call returns cached with stale:true', async () => {
    let callCount = 0;
    fetchSpy = vi.fn(async (url) => {
      callCount += 1;
      // First 2 calls (both for 1st getMarketData invocation) succeed
      if (callCount <= 2) {
        if (ADV_URL.test(url)) return makeResponse(ADV_OK);
        if (OB_URL.test(url)) return makeResponse(OB_OK);
      }
      // Subsequent calls fail (HTML upstream error)
      return makeHtmlResponse(500);
    });
    globalThis.fetch = fetchSpy;

    const { getMarketData } = await loadFreshService();

    // Call 1: success → cache populated
    const r1 = await getMarketData('VNM');
    expect(r1.price).toBe(85000);
    expect(r1.stale).toBeFalsy();

    // Call 2, 3, 4: each getMarketData does Promise.all([adv, ob]) — both fail synchronously,
    // so Promise.all rejects ONCE per call, counting as 1 breaker failure.
    // Need 3 breaker failures to OPEN → calls 2/3/4 register as failures.
    const r2 = await getMarketData('VNM');
    expect(r2.error).toBeTruthy();

    const r3 = await getMarketData('VNM');
    expect(r3.error).toBeTruthy();

    const r4 = await getMarketData('VNM');
    expect(r4.error).toBeTruthy();

    // Now breaker should be OPEN. Call 5 → no fetch, return cached stale
    const fetchCountBefore = fetchSpy.mock.calls.length;
    const r5 = await getMarketData('VNM');

    expect(fetchSpy.mock.calls.length).toBe(fetchCountBefore); // no new fetch
    expect(r5.price).toBe(85000); // cached value
    expect(r5.stale).toBe(true);
    expect(r5.stale_reason).toBe('circuit_breaker_open');
    expect(typeof r5.cached_at).toBe('number');
  });

  it('Scenario 3: breaker OPEN + no cache → error shape preserved with circuit-open reason', async () => {
    fetchSpy = vi.fn(async () => makeHtmlResponse(500));
    globalThis.fetch = fetchSpy;

    const { getMarketData } = await loadFreshService();

    // 3 failures → OPEN
    await getMarketData('NEW_SYMBOL');
    await getMarketData('NEW_SYMBOL');
    await getMarketData('NEW_SYMBOL');

    // Call 4: breaker OPEN, no cache for this symbol → error message mentions circuit open
    const fetchCountBefore = fetchSpy.mock.calls.length;
    const r = await getMarketData('NEW_SYMBOL');
    expect(fetchSpy.mock.calls.length).toBe(fetchCountBefore); // no new fetch
    expect(r.price).toBeNull();
    expect(r.reference).toBeNull();
    expect(r.error).toMatch(/circuit open|circuit_breaker_open/i);
  });

  it('Scenario 4: after cooldown 10 min, probe success → breaker CLOSED + refresh cache', async () => {
    let shouldFail = true;
    fetchSpy = vi.fn(async (url) => {
      if (shouldFail) return makeHtmlResponse(500);
      if (ADV_URL.test(url)) return makeResponse(ADV_OK);
      if (OB_URL.test(url)) return makeResponse(OB_OK);
      return makeResponse({});
    });
    globalThis.fetch = fetchSpy;

    const { getMarketData } = await loadFreshService();

    // 3 fails → OPEN
    await getMarketData('VNM');
    await getMarketData('VNM');
    await getMarketData('VNM');

    // 4th call while OPEN — no fetch
    const callsBefore = fetchSpy.mock.calls.length;
    await getMarketData('VNM');
    expect(fetchSpy.mock.calls.length).toBe(callsBefore);

    // Advance past cooldown (10 min)
    vi.advanceTimersByTime(10 * 60_000 + 1_000);

    // Now upstream is healthy — probe should succeed and CLOSE breaker
    shouldFail = false;
    const probe = await getMarketData('VNM');
    expect(probe.price).toBe(85000);
    expect(probe.stale).toBeFalsy();
  });

  it('Scenario 5: log state change [CB:vpbs] khi chuyển OPEN', async () => {
    fetchSpy = vi.fn(async () => makeHtmlResponse(500));
    globalThis.fetch = fetchSpy;

    const { getMarketData } = await loadFreshService();

    await getMarketData('VNM');
    await getMarketData('VNM');
    await getMarketData('VNM');

    const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/\[CB:vpbs\]/);
    expect(logged).toMatch(/state=OPEN/);
  });
});
