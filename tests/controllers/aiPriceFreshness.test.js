/**
 * aiPriceFreshness.test.js — AIT-03 (D-03)
 *
 * Test in-memory price cache trong ai.controller.js:
 * - Cache hit/miss/expire behavior
 * - maxAgeMs override
 * - Không cache null result
 * - Key độc lập theo exchange
 *
 * Threat mitigated: T-04-03 (stale price → AI prompt dùng giá cũ).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock global.fetch (fetchCurrentPriceVND dùng fetch)
const mockFetch = vi.fn();

beforeEach(() => {
  vi.resetModules();
  mockFetch.mockReset();
  global.fetch = mockFetch;
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-04-19T09:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Helper: import module sau khi reset để cache fresh mỗi test.
 * Trả về { fetchCurrentPriceCached, aiPriceCache }.
 */
async function loadController() {
  const mod = await import('../../controllers/ai.controller.js');
  return mod;
}

/**
 * Helper: mock fetch trả giá VND từ /api/market/symbols/:symbol/price.
 */
function mockPriceResponse(priceVnd) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ data: { price: priceVnd } }),
  });
}

function mockPriceFail() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    json: async () => ({}),
  });
}

describe('fetchCurrentPriceCached — AIT-03 (D-03)', () => {
  it('Test 1.1 MISS: cache rỗng → gọi underlying 1 lần, trả mock giá', async () => {
    const { fetchCurrentPriceCached, __aiPriceCache } = await loadController();
    __aiPriceCache.clear();

    mockPriceResponse(50_000);
    const price = await fetchCurrentPriceCached('VNM', 'HOSE');

    expect(price).toBe(50_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/api/market/symbols/VNM/price');
    expect(mockFetch.mock.calls[0][0]).toContain('exchange=HOSE');
  });

  it('Test 1.2 HIT < 60s: gọi lại trong 30s → KHÔNG re-fetch, return cached', async () => {
    const { fetchCurrentPriceCached, __aiPriceCache } = await loadController();
    __aiPriceCache.clear();

    mockPriceResponse(50_000);
    const first = await fetchCurrentPriceCached('VNM', 'HOSE');
    expect(first).toBe(50_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Tăng time 30s — vẫn < 60s TTL
    vi.setSystemTime(new Date('2026-04-19T09:00:30Z'));

    const second = await fetchCurrentPriceCached('VNM', 'HOSE');
    expect(second).toBe(50_000);
    // fetch KHÔNG gọi thêm — cache hit
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('Test 1.3 EXPIRED > 60s: re-fetch underlying lần 2', async () => {
    const { fetchCurrentPriceCached, __aiPriceCache } = await loadController();
    __aiPriceCache.clear();

    mockPriceResponse(50_000);
    await fetchCurrentPriceCached('VNM', 'HOSE');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Tăng time 61s — vượt TTL 60s
    vi.setSystemTime(new Date('2026-04-19T09:01:01Z'));

    mockPriceResponse(52_000);
    const fresh = await fetchCurrentPriceCached('VNM', 'HOSE');
    expect(fresh).toBe(52_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('Test 1.4 null result KHÔNG cache: gọi lại ngay → underlying gọi lại', async () => {
    const { fetchCurrentPriceCached, __aiPriceCache } = await loadController();
    __aiPriceCache.clear();

    mockPriceFail();
    const first = await fetchCurrentPriceCached('ZZZ', 'HOSE');
    expect(first).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Gọi lại ngay lập tức — KHÔNG được hit cache null
    mockPriceResponse(10_000);
    const second = await fetchCurrentPriceCached('ZZZ', 'HOSE');
    expect(second).toBe(10_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('Test 1.5 maxAgeMs override: entry 30s trước, maxAgeMs=10_000 → treat expired', async () => {
    const { fetchCurrentPriceCached, __aiPriceCache } = await loadController();
    __aiPriceCache.clear();

    mockPriceResponse(50_000);
    await fetchCurrentPriceCached('VNM', 'HOSE');
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Tăng 30s — < default 60s nhưng > maxAgeMs=10_000
    vi.setSystemTime(new Date('2026-04-19T09:00:30Z'));

    mockPriceResponse(51_000);
    const override = await fetchCurrentPriceCached('VNM', 'HOSE', { maxAgeMs: 10_000 });
    expect(override).toBe(51_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('Test 1.6 different exchange: VNM:HOSE vs VNM:HNX cache độc lập', async () => {
    const { fetchCurrentPriceCached, __aiPriceCache } = await loadController();
    __aiPriceCache.clear();

    mockPriceResponse(50_000);
    const hose = await fetchCurrentPriceCached('VNM', 'HOSE');
    expect(hose).toBe(50_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Key khác — phải fetch lại
    mockPriceResponse(49_500);
    const hnx = await fetchCurrentPriceCached('VNM', 'HNX');
    expect(hnx).toBe(49_500);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Gọi lại VNM:HOSE ngay → cache hit, không fetch
    const hoseAgain = await fetchCurrentPriceCached('VNM', 'HOSE');
    expect(hoseAgain).toBe(50_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
