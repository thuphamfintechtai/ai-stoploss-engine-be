/**
 * Tests cho priceAlertMonitor isMarketOpen guard (MDI-01).
 *
 * Behavior:
 * - checkPriceAlerts() skip khi market closed theo exchange (weekend, sau 15:00, trước 9:00, lunch)
 * - Log format D-01: `[alert] evaluateAlerts skipped — exchange=HOSE session=CLOSED ts=...`
 * - Per-exchange: mixed HOSE+HNX, skip exchange đóng, proceed exchange mở
 * - broadcastWatchlistPrices KHÔNG bị gate (giá stale tự nhiên ngoài giờ)
 *
 * Strategy: mock config/database, notificationService, websocket, fetch fetchPriceVND.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../config/database.js', () => ({
  query: vi.fn(),
}));

vi.mock('../../services/notificationService.js', () => ({
  createNotification: vi.fn(async () => ({ id: 'notif-1' })),
}));

vi.mock('../../services/websocket.js', () => ({
  broadcastPriceUpdate: vi.fn(),
}));

import { query } from '../../config/database.js';
import { createNotification } from '../../services/notificationService.js';
import { __test__ as alertInternals } from '../../services/priceAlertMonitor.js';

const vnDate = (iso) => new Date(iso + '+07:00');

// Stub global fetch — trả giá cố định cho mọi symbol
function stubFetch(priceVnd) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      data: {
        price: priceVnd,
        change: 0,
        percentChange: 0,
        volume: 0,
      },
    }),
  }));
}

describe('checkPriceAlerts — isMarketOpen guard (MDI-01)', () => {
  let originalFetch;
  let logSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(100_000);
    // Reset module-scope priceCache to avoid test bleed
    alertInternals.priceCache.clear();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    logSpy.mockRestore();
  });

  it('Saturday 10:00 → skip, không evaluate, log market_closed', async () => {
    // 2026-04-18 = Saturday
    vi.setSystemTime(vnDate('2026-04-18T10:00:00'));
    query.mockResolvedValue({
      rows: [
        {
          id: 'a1',
          user_id: 'u1',
          symbol: 'VNM',
          exchange: 'HOSE',
          condition: 'ABOVE',
          target_value: '80000',
          reference_price: null,
          note: null,
          is_active: true,
          is_triggered: false,
        },
      ],
    });

    await alertInternals.checkPriceAlerts();

    expect(createNotification).not.toHaveBeenCalled();
    // Tất cả UPDATE là DB write → vì skip toàn bộ, chỉ có 1 SELECT query ban đầu
    expect(query).toHaveBeenCalledTimes(1);
    const sqlCalls = query.mock.calls.map(c => c[0]);
    expect(sqlCalls.some(s => s.includes('UPDATE'))).toBe(false);

    // Log chứa "skipped" và "market_closed" hoặc "session=CLOSED"
    const logged = logSpy.mock.calls.map(args => args.join(' ')).join('\n');
    expect(logged).toContain('skipped');
    expect(logged).toMatch(/exchange=HOSE/);
    expect(logged).toMatch(/session=CLOSED/);
  });

  it('Tuesday 22:00 → skip (sau giờ), không evaluate', async () => {
    // 2026-04-21 = Tuesday 22:00 → CLOSED
    vi.setSystemTime(vnDate('2026-04-21T22:00:00'));
    query.mockResolvedValue({
      rows: [
        {
          id: 'a1',
          user_id: 'u1',
          symbol: 'VNM',
          exchange: 'HOSE',
          condition: 'ABOVE',
          target_value: '80000',
          reference_price: null,
          note: null,
          is_active: true,
          is_triggered: false,
        },
      ],
    });

    await alertInternals.checkPriceAlerts();

    expect(createNotification).not.toHaveBeenCalled();
  });

  it('Tuesday 10:00 (CONTINUOUS_1) → proceed evaluate, trigger ABOVE khi giá đủ', async () => {
    // 2026-04-21 = Tuesday 10:00 → CONTINUOUS_1
    vi.setSystemTime(vnDate('2026-04-21T10:00:00'));
    // currentPrice 100_000 ≥ target 80_000 → trigger
    query.mockResolvedValue({
      rows: [
        {
          id: 'a1',
          user_id: 'u1',
          symbol: 'VNM',
          exchange: 'HOSE',
          condition: 'ABOVE',
          target_value: '80000',
          reference_price: null,
          note: null,
          is_active: true,
          is_triggered: false,
        },
      ],
    });

    await alertInternals.checkPriceAlerts();

    expect(createNotification).toHaveBeenCalledTimes(1);
    const call = createNotification.mock.calls[0][0];
    expect(call.type).toBe('PRICE_ALERT');
    expect(call.metadata.symbol).toBe('VNM');
  });

  it('Mixed HOSE+UPCOM — Saturday: cả 2 skip', async () => {
    vi.setSystemTime(vnDate('2026-04-18T10:00:00'));
    query.mockResolvedValue({
      rows: [
        { id: 'a1', user_id: 'u1', symbol: 'VNM', exchange: 'HOSE', condition: 'ABOVE', target_value: '80000', reference_price: null, note: null, is_active: true, is_triggered: false },
        { id: 'a2', user_id: 'u2', symbol: 'BSR', exchange: 'UPCOM', condition: 'ABOVE', target_value: '30000', reference_price: null, note: null, is_active: true, is_triggered: false },
      ],
    });

    await alertInternals.checkPriceAlerts();

    expect(createNotification).not.toHaveBeenCalled();

    const logged = logSpy.mock.calls.map(args => args.join(' ')).join('\n');
    expect(logged).toMatch(/exchange=HOSE/);
    expect(logged).toMatch(/exchange=UPCOM/);
  });

  it('Mixed — Tuesday 12:00 HOSE LUNCH closed, UPCOM LUNCH closed → cả 2 skip', async () => {
    // 2026-04-21 12:00 → HOSE LUNCH, UPCOM LUNCH (both closed)
    vi.setSystemTime(vnDate('2026-04-21T12:00:00'));
    query.mockResolvedValue({
      rows: [
        { id: 'a1', user_id: 'u1', symbol: 'VNM', exchange: 'HOSE', condition: 'ABOVE', target_value: '80000', reference_price: null, note: null, is_active: true, is_triggered: false },
        { id: 'a2', user_id: 'u2', symbol: 'BSR', exchange: 'UPCOM', condition: 'ABOVE', target_value: '30000', reference_price: null, note: null, is_active: true, is_triggered: false },
      ],
    });

    await alertInternals.checkPriceAlerts();

    expect(createNotification).not.toHaveBeenCalled();
  });

  it('Tuesday 14:40 → HOSE ATC (open) + UPCOM CONTINUOUS_2 (open) → cả 2 proceed', async () => {
    // 2026-04-21 14:40 → HOSE ATC, UPCOM CONTINUOUS_2
    vi.setSystemTime(vnDate('2026-04-21T14:40:00'));
    query.mockResolvedValue({
      rows: [
        { id: 'a1', user_id: 'u1', symbol: 'VNM', exchange: 'HOSE', condition: 'ABOVE', target_value: '80000', reference_price: null, note: null, is_active: true, is_triggered: false },
        { id: 'a2', user_id: 'u2', symbol: 'BSR', exchange: 'UPCOM', condition: 'ABOVE', target_value: '30000', reference_price: null, note: null, is_active: true, is_triggered: false },
      ],
    });

    await alertInternals.checkPriceAlerts();

    expect(createNotification).toHaveBeenCalledTimes(2);
  });

  it('empty alerts → return sớm, không log skip', async () => {
    vi.setSystemTime(vnDate('2026-04-18T10:00:00'));
    query.mockResolvedValue({ rows: [] });

    await alertInternals.checkPriceAlerts();

    expect(createNotification).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.map(args => args.join(' ')).join('\n');
    expect(logged).not.toContain('skipped');
  });
});
