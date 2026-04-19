/**
 * E2E Integration — PENDING order lifecycle (MAP-01, D-05).
 *
 * Reproduces success criterion #1 của plan 03-01:
 *   Given: portfolio co available_cash = 100M, pending_buy_lock = 0
 *   Step 1: Create 2 PENDING buy orders (VNM 300×100k ≈ 30M, HPG 1600×25k ≈ 40M)
 *   Expect: available_cash KHONG DOI (100M), pending_buy_lock ≈ 70M, buying_power ≈ 30M
 *   Step 2: Confirm fill cho order VNM tai actual_price = 100k
 *   Expect: available_cash = 100M - 30_045_000 (= 69_955_000), pending_buy_lock = 40_060_000
 *   Step 3: Cancel order HPG
 *   Expect: pending_buy_lock = 0, available_cash khong doi (van 69_955_000)
 *
 * Flow di qua:
 *   RealOrderService.recordBuyOrder → CapitalService.deductForBuy (PENDING lock)
 *   RealOrderService.confirmOrderFill → CapitalService.confirmBuyFill
 *   RealOrderService.cancelBuyOrder  → CapitalService.releaseBuyLock
 *
 * CapitalService chay THAT (khong mock) — chi mock DB layer (query + transaction client).
 * T-03-02 mitigation verify: _computeLockedAmount tu DB order row, khong nhan tu caller.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── DB mock: simulate portfolio state transitions ───────────────────────────
const state = {
  available_cash: 0,
  pending_buy_lock: 0,
  buy_fee_percent: 0.0015,
};

vi.mock('../../config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn(),
  default: {},
}));

// Mock models — Order + Position
vi.mock('../../models/Order.js', () => ({
  default: {
    create: vi.fn(),
    findById: vi.fn(),
  },
}));

vi.mock('../../models/Position.js', () => ({
  default: {
    create: vi.fn(),
  },
}));

// fee engine: chay THAT (khong mock) de dam bao integer VND math
// marketPriceService khong can mock — service layer khong goi

import { query, transaction } from '../../config/database.js';
import Order from '../../models/Order.js';
import Position from '../../models/Position.js';
import RealOrderService from '../../services/portfolio/realOrderService.js';
import CapitalService from '../../services/portfolio/capitalService.js';

/**
 * Setup DB mocks de simulate state transitions.
 * - query(SELECT portfolios) → tra ve state hien tai
 * - transaction(cb) → cap client ma query() update state in-memory
 */
function setupDbSimulation() {
  query.mockImplementation((sql, _params) => {
    // SELECT * FROM financial.portfolios WHERE id = $1 (realOrderService load cho fee calc)
    if (/FROM financial\.portfolios/i.test(sql) && /SELECT \*/i.test(sql)) {
      return Promise.resolve({
        rows: [{
          id: 'port-1',
          available_cash: String(state.available_cash),
          pending_buy_lock: String(state.pending_buy_lock),
          buy_fee_percent: state.buy_fee_percent,
        }],
      });
    }
    // UPDATE financial.orders (confirmOrderFill / cancelBuyOrder)
    if (/UPDATE financial\.orders/i.test(sql)) {
      return Promise.resolve({ rowCount: 1 });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  transaction.mockImplementation(async (cb) => {
    const mockClient = {
      query: vi.fn().mockImplementation((sql, params) => {
        // SELECT FOR UPDATE
        if (/SELECT .* FROM financial\.portfolios/i.test(sql) && /FOR UPDATE/i.test(sql)) {
          return Promise.resolve({
            rows: [{
              available_cash: String(state.available_cash),
              pending_buy_lock: String(state.pending_buy_lock),
            }],
          });
        }
        // UPDATE pending_buy_lock + $2  (deductForBuy PENDING)
        if (/SET pending_buy_lock = pending_buy_lock \+ \$2/i.test(sql)) {
          state.pending_buy_lock += Number(params[1]);
          return Promise.resolve({ rowCount: 1 });
        }
        // UPDATE pending_buy_lock - $2  (releaseBuyLock)
        if (/SET pending_buy_lock = pending_buy_lock - \$2/i.test(sql)) {
          state.pending_buy_lock -= Number(params[1]);
          return Promise.resolve({ rowCount: 1 });
        }
        // UPDATE confirmBuyFill (combined available_cash + pending_buy_lock)
        if (/SET available_cash = available_cash - \$2/i.test(sql)
            && /pending_buy_lock = pending_buy_lock - \$3/i.test(sql)) {
          state.available_cash -= Number(params[1]);
          state.pending_buy_lock -= Number(params[2]);
          return Promise.resolve({ rowCount: 1 });
        }
        // UPDATE deductForBuy FILLED
        if (/SET available_cash = available_cash - \$2/i.test(sql)) {
          state.available_cash -= Number(params[1]);
          return Promise.resolve({ rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };
    return cb(mockClient);
  });
}

describe('PENDING order lifecycle E2E (MAP-01, success criterion #1)', () => {
  beforeEach(() => {
    // Reset state
    state.available_cash = 100_000_000; // 100M
    state.pending_buy_lock = 0;
    state.buy_fee_percent = 0.0015;

    vi.clearAllMocks();
    setupDbSimulation();
  });

  it('2 PENDING buy orders → pending_buy_lock tang, available_cash KHONG DOI', async () => {
    // Order 1: VNM 300qty × 100_000 = 30M + fee 45k = 30_045_000
    Order.create.mockResolvedValueOnce({ id: 'ord-vnm', status: 'PENDING' });
    await RealOrderService.recordBuyOrder('port-1', {
      symbol: 'VNM', exchange: 'HOSE', quantity: 300,
      filledPrice: 100_000, filledDate: '2026-04-19',
      orderStatus: 'PENDING',
    });

    // Order 2: HPG 1600qty × 25_000 = 40M + fee 60k = 40_060_000
    Order.create.mockResolvedValueOnce({ id: 'ord-hpg', status: 'PENDING' });
    await RealOrderService.recordBuyOrder('port-1', {
      symbol: 'HPG', exchange: 'HOSE', quantity: 1600,
      filledPrice: 25_000, filledDate: '2026-04-19',
      orderStatus: 'PENDING',
    });

    // ASSERT: available_cash KHONG DOI (van 100M), pending_buy_lock = tong 2 cost
    expect(state.available_cash).toBe(100_000_000);
    expect(state.pending_buy_lock).toBe(30_045_000 + 40_060_000); // 70_105_000

    // buying_power = available - pending_lock = 100M - 70.105M = 29.895M
    const buyingPower = state.available_cash - state.pending_buy_lock;
    expect(buyingPower).toBe(29_895_000);

    // Position KHONG duoc tao cho PENDING (create 0 lan)
    expect(Position.create).not.toHaveBeenCalled();

    // Order.create goi 2 lan voi status=PENDING
    expect(Order.create).toHaveBeenCalledTimes(2);
    expect(Order.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING', orderType: 'LO' })
    );
  });

  it('full lifecycle: 2 PENDING → confirm 1 + cancel 1 → state nhat quan', async () => {
    // === Step 1: Create 2 PENDING orders ===
    Order.create.mockResolvedValueOnce({ id: 'ord-vnm' });
    await RealOrderService.recordBuyOrder('port-1', {
      symbol: 'VNM', exchange: 'HOSE', quantity: 300,
      filledPrice: 100_000, filledDate: '2026-04-19',
      orderStatus: 'PENDING',
    });

    Order.create.mockResolvedValueOnce({ id: 'ord-hpg' });
    await RealOrderService.recordBuyOrder('port-1', {
      symbol: 'HPG', exchange: 'HOSE', quantity: 1600,
      filledPrice: 25_000, filledDate: '2026-04-19',
      orderStatus: 'PENDING',
    });

    // After step 1: available = 100M, lock = 70.105M
    expect(state.available_cash).toBe(100_000_000);
    expect(state.pending_buy_lock).toBe(70_105_000);

    // === Step 2: Confirm fill VNM tai actual_price = 100_000 ===
    const vnmOrderRow = {
      id: 'ord-vnm',
      portfolio_id: 'port-1',
      symbol: 'VNM',
      exchange: 'HOSE',
      quantity: 300,
      limit_price: 100_000,
      status: 'PENDING',
      notes: null,
    };
    // findById: 1st call = initial load, 2nd call = reload after UPDATE
    Order.findById
      .mockResolvedValueOnce(vnmOrderRow)
      .mockResolvedValueOnce({ ...vnmOrderRow, status: 'RECORDED', avg_fill_price: 100_000 });
    Position.create.mockResolvedValueOnce({ id: 'pos-vnm', entry_price: 100_000 });

    await RealOrderService.confirmOrderFill('port-1', 'ord-vnm', {
      actualPrice: 100_000,
      actualDate: '2026-04-20',
    });

    // After confirm: available = 100M - 30_045_000 = 69_955_000, lock = 70.105M - 30.045M = 40.060M
    expect(state.available_cash).toBe(69_955_000);
    expect(state.pending_buy_lock).toBe(40_060_000);

    // Position tao cho VNM
    expect(Position.create).toHaveBeenCalledWith(
      expect.objectContaining({
        symbol: 'VNM',
        entryPrice: 100_000,
        context: 'REAL',
      })
    );

    // === Step 3: Cancel HPG ===
    const hpgOrderRow = {
      id: 'ord-hpg',
      portfolio_id: 'port-1',
      symbol: 'HPG',
      exchange: 'HOSE',
      quantity: 1600,
      limit_price: 25_000,
      status: 'PENDING',
    };
    Order.findById
      .mockResolvedValueOnce(hpgOrderRow)
      .mockResolvedValueOnce({ ...hpgOrderRow, status: 'CANCELLED' });

    await RealOrderService.cancelBuyOrder('port-1', 'ord-hpg');

    // After cancel: pending_buy_lock = 0, available_cash KHONG DOI (van 69_955_000)
    expect(state.pending_buy_lock).toBe(0);
    expect(state.available_cash).toBe(69_955_000);

    // Position chi duoc tao 1 lan (cho VNM) — cancel khong tao position
    expect(Position.create).toHaveBeenCalledTimes(1);
  });

  it('PENDING → reject khi buying_power khong du', async () => {
    // Lock 1 order 80M truoc
    Order.create.mockResolvedValueOnce({ id: 'ord-1' });
    await RealOrderService.recordBuyOrder('port-1', {
      symbol: 'VNM', exchange: 'HOSE', quantity: 800,
      filledPrice: 100_000, filledDate: '2026-04-19',
      orderStatus: 'PENDING',
    });

    // buying_power con: 100M - 80.12M = 19.88M
    // Try lock them 25M → should throw 422
    let err;
    try {
      await RealOrderService.recordBuyOrder('port-1', {
        symbol: 'HPG', exchange: 'HOSE', quantity: 1000,
        filledPrice: 25_000, filledDate: '2026-04-19',
        orderStatus: 'PENDING',
      });
    } catch (e) { err = e; }

    expect(err).toBeDefined();
    expect(err.statusCode).toBe(422);
    expect(err.message).toMatch(/buying_power|suc mua/i);

    // State khong doi (chi order 1 da lock)
    expect(state.available_cash).toBe(100_000_000);
    expect(state.pending_buy_lock).toBe(80_120_000);
  });
});

describe('PENDING lock vs FILLED cash deduction — buying_power semantics', () => {
  beforeEach(() => {
    state.available_cash = 50_000_000;
    state.pending_buy_lock = 0;
    state.buy_fee_percent = 0.0015;
    vi.clearAllMocks();
    setupDbSimulation();
  });

  it('FILLED tru truc tiep available_cash, khong cham pending_buy_lock', async () => {
    Order.create.mockResolvedValueOnce({ id: 'ord-filled' });
    Position.create.mockResolvedValueOnce({ id: 'pos-filled' });

    await RealOrderService.recordBuyOrder('port-1', {
      symbol: 'VNM', exchange: 'HOSE', quantity: 100,
      filledPrice: 100_000, filledDate: '2026-04-19',
      orderStatus: 'FILLED',
    });

    // available -= (10M + fee 15k) = 10_015_000
    expect(state.available_cash).toBe(50_000_000 - 10_015_000);
    expect(state.pending_buy_lock).toBe(0);

    // FILLED: Position.create duoc goi
    expect(Position.create).toHaveBeenCalledTimes(1);
  });

  it('default orderStatus (khong truyen) = FILLED — backward-compat', async () => {
    Order.create.mockResolvedValueOnce({ id: 'ord-default' });
    Position.create.mockResolvedValueOnce({ id: 'pos-default' });

    await RealOrderService.recordBuyOrder('port-1', {
      symbol: 'VNM', exchange: 'HOSE', quantity: 100,
      filledPrice: 100_000, filledDate: '2026-04-19',
      // KHONG truyen orderStatus
    });

    expect(state.available_cash).toBeLessThan(50_000_000); // tru cash
    expect(state.pending_buy_lock).toBe(0);                // khong lock
  });
});
