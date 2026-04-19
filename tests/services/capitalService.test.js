import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDbMock, mockQuery, mockTransaction, resetDbMocks } from '../helpers/db.js';

// Setup DB mock before module import
setupDbMock();

import CapitalService, { addBusinessDays } from '../../services/portfolio/capitalService.js';

describe('addBusinessDays', () => {
  it('skip weekends: next business day after Friday is Monday', () => {
    // 2026-01-02 is Friday
    const result = addBusinessDays(new Date('2026-01-02'), 1);
    const dayOfWeek = result.getDay();
    // Must be Monday (1)
    expect(dayOfWeek).toBe(1);
  });

  it('skip VN holiday: 2026-01-01 Tet Duong Lich', () => {
    // Start: 2025-12-31 (Wednesday), add 1 business day
    // 2026-01-01 is holiday, next is 2026-01-02 (Friday)
    const result = addBusinessDays(new Date('2025-12-31'), 1);
    const dateStr = result.toISOString().split('T')[0];
    expect(dateStr).toBe('2026-01-02');
  });

  it('returns date object', () => {
    const result = addBusinessDays(new Date('2026-03-27'), 2);
    expect(result).toBeInstanceOf(Date);
  });

  it('VN_HOLIDAYS has at least 10 entries (documented in module)', () => {
    // addBusinessDays will skip VN holidays; verify it skips Tet period
    // 2026-01-26 to 2026-01-30 are Tet holidays
    // Start: 2026-01-23 (Friday), add 1 business day
    // Expect to skip 26-27-28-29-30, next business day: 2026-02-02 (Mon)
    const result = addBusinessDays(new Date('2026-01-23'), 1);
    const dateStr = result.toISOString().split('T')[0];
    expect(dateStr).toBe('2026-02-02');
  });
});

describe('CapitalService.deductForBuy (state=FILLED default)', () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it('deducts available_cash when sufficient funds', async () => {
    // Mock transaction to call callback with a mock client
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ available_cash: '100000000', pending_buy_lock: '0' }] }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }),                                         // UPDATE
      };
      return callback(mockClient);
    });

    await expect(CapitalService.deductForBuy('portfolio-1', 50000000)).resolves.not.toThrow();
  });

  it('throws 422 when insufficient funds', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ available_cash: '10000000', pending_buy_lock: '0' }] })
          .mockResolvedValueOnce({ rows: [] }),
      };
      return callback(mockClient);
    });

    let err;
    try {
      await CapitalService.deductForBuy('portfolio-1', 50000000);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(422);
    expect(err.message).toMatch(/Khong du tien mat kha dung/);
  });

  it('throws 422 when portfolio not found (no rows)', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rows: [] }),
      };
      return callback(mockClient);
    });

    let err;
    try {
      await CapitalService.deductForBuy('non-existent', 1000);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(422);
  });

  it('default state is FILLED (backward-compat with 2-arg callers)', async () => {
    let updateSql = null;
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql) => {
          if (sql.includes('FOR UPDATE')) {
            return Promise.resolve({ rows: [{ available_cash: '100000000', pending_buy_lock: '0' }] });
          }
          if (sql.includes('UPDATE')) {
            updateSql = sql;
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [] });
        }),
      };
      return callback(mockClient);
    });

    await CapitalService.deductForBuy('portfolio-1', 1000000);
    // Default state FILLED → update available_cash (KHONG update pending_buy_lock)
    expect(updateSql).toMatch(/available_cash = available_cash -/);
    expect(updateSql).not.toMatch(/pending_buy_lock = pending_buy_lock \+/);
  });
});

describe('CapitalService.deductForBuy state=PENDING', () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it('sufficient buying_power → tang pending_buy_lock, khong tru available_cash', async () => {
    let updateSql = null;
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql) => {
          if (sql.includes('FOR UPDATE')) {
            // available=100M, locked=20M → buying_power=80M
            return Promise.resolve({ rows: [{ available_cash: '100000000', pending_buy_lock: '20000000' }] });
          }
          if (sql.includes('UPDATE')) {
            updateSql = sql;
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [] });
        }),
      };
      return callback(mockClient);
    });

    // Cost = 50M < buying_power (80M) → OK
    await expect(CapitalService.deductForBuy('portfolio-1', 50000000, 'PENDING')).resolves.not.toThrow();
    expect(updateSql).toMatch(/pending_buy_lock = pending_buy_lock \+/);
    expect(updateSql).not.toMatch(/available_cash = available_cash -/);
  });

  it('insufficient buying_power → throw 422', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql) => {
          if (sql.includes('FOR UPDATE')) {
            // available=30M, locked=20M → buying_power=10M
            return Promise.resolve({ rows: [{ available_cash: '30000000', pending_buy_lock: '20000000' }] });
          }
          return Promise.resolve({ rows: [] });
        }),
      };
      return callback(mockClient);
    });

    let err;
    try {
      // Cost 50M > buying_power 10M → 422
      await CapitalService.deductForBuy('portfolio-1', 50000000, 'PENDING');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(422);
    expect(err.message).toMatch(/suc mua/i);
  });

  it('invalid state → throw Error', async () => {
    let err;
    try {
      await CapitalService.deductForBuy('portfolio-1', 1000, 'INVALID_STATE');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.message).toMatch(/Invalid state/);
  });

  it('PENDING state: portfolio not found throws 422', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rows: [] }),
      };
      return callback(mockClient);
    });

    let err;
    try {
      await CapitalService.deductForBuy('non-existent', 1000, 'PENDING');
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(422);
  });
});

describe('CapitalService.confirmBuyFill', () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it('success: pending_buy_lock -= lockedAmount, available_cash -= actualCost', async () => {
    const queries = [];
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql, params) => {
          queries.push({ sql, params });
          if (sql.includes('FOR UPDATE')) {
            return Promise.resolve({ rows: [{ available_cash: '100000000', pending_buy_lock: '40000000' }] });
          }
          return Promise.resolve({ rows: [] });
        }),
      };
      return callback(mockClient);
    });

    await expect(
      CapitalService.confirmBuyFill('portfolio-1', 29_500_000, 30_000_000)
    ).resolves.not.toThrow();

    // Verify UPDATE query touches cả 2 columns
    const updateQuery = queries.find(q => q.sql.includes('UPDATE') && !q.sql.includes('FOR UPDATE'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery.sql).toMatch(/available_cash = available_cash -/);
    expect(updateQuery.sql).toMatch(/pending_buy_lock = pending_buy_lock -/);
  });

  it('throws 404 when portfolio not found', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rows: [] }),
      };
      return callback(mockClient);
    });

    let err;
    try {
      await CapitalService.confirmBuyFill('non-existent', 1000, 1000);
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(404);
  });

  it('throws 422 when locked < lockedAmount', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({
          rows: [{ available_cash: '100000000', pending_buy_lock: '5000000' }]
        }),
      };
      return callback(mockClient);
    });

    let err;
    try {
      // lockedAmount 30M > actual locked 5M → 422
      await CapitalService.confirmBuyFill('portfolio-1', 30_000_000, 30_000_000);
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(422);
    expect(err.message).toMatch(/Pending buy lock insufficient/);
  });

  it('throws 422 when available < actualCost', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({
          // locked sufficient, nhung available insufficient
          rows: [{ available_cash: '10000000', pending_buy_lock: '50000000' }]
        }),
      };
      return callback(mockClient);
    });

    let err;
    try {
      await CapitalService.confirmBuyFill('portfolio-1', 30_000_000, 30_000_000);
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(422);
    expect(err.message).toMatch(/Khong du tien mat kha dung/);
  });
});

describe('CapitalService.releaseBuyLock', () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it('success: pending_buy_lock -= amount', async () => {
    let updateSql = null;
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql) => {
          if (sql.includes('FOR UPDATE')) {
            return Promise.resolve({ rows: [{ pending_buy_lock: '40000000' }] });
          }
          if (sql.includes('UPDATE')) {
            updateSql = sql;
            return Promise.resolve({ rows: [] });
          }
          return Promise.resolve({ rows: [] });
        }),
      };
      return callback(mockClient);
    });

    await expect(CapitalService.releaseBuyLock('portfolio-1', 30_000_000)).resolves.not.toThrow();
    expect(updateSql).toMatch(/pending_buy_lock = pending_buy_lock -/);
    expect(updateSql).not.toMatch(/available_cash/);
  });

  it('throws 404 when portfolio not found', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rows: [] }),
      };
      return callback(mockClient);
    });

    let err;
    try {
      await CapitalService.releaseBuyLock('non-existent', 1000);
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(404);
  });

  it('throws 422 when locked < amount', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({
          rows: [{ pending_buy_lock: '5000000' }]
        }),
      };
      return callback(mockClient);
    });

    let err;
    try {
      await CapitalService.releaseBuyLock('portfolio-1', 30_000_000);
    } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(422);
    expect(err.message).toMatch(/insufficient/i);
  });
});

describe('CapitalService.addPendingSettlement', () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it('updates pending_settlement_cash and inserts settlement_event', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [] })  // UPDATE portfolios
          .mockResolvedValueOnce({ rows: [{ id: 'evt-1' }] }), // INSERT settlement_events
      };
      return callback(mockClient);
    });

    const settlementDate = new Date('2026-03-29');
    await expect(
      CapitalService.addPendingSettlement('portfolio-1', 5000000, settlementDate)
    ).resolves.not.toThrow();
  });
});

describe('CapitalService.processSettlements', () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it('returns 0 when no pending settlements', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const count = await CapitalService.processSettlements();
    expect(count).toBe(0);
  });

  it('processes pending settlements and returns count', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'evt-1', portfolio_id: 'p-1', amount: '5000000' },
        { id: 'evt-2', portfolio_id: 'p-2', amount: '3000000' },
      ]
    });

    mockTransaction
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const count = await CapitalService.processSettlements();
    expect(count).toBe(2);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });
});

describe('CapitalService.getBalance', () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it('returns null when portfolio not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await CapitalService.getBalance('non-existent');
    expect(result).toBeNull();
  });

  it('calculates deployed_cash correctly (MAP-05 integer VND)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        total_balance: '100000000',
        available_cash: '60000000',
        pending_settlement_cash: '10000000',
        pending_buy_lock: '0',
      }]
    });

    const balance = await CapitalService.getBalance('portfolio-1');
    expect(balance.total_balance).toBe(100000000);
    expect(balance.available_cash).toBe(60000000);
    expect(balance.pending_settlement_cash).toBe(10000000);
    expect(balance.deployed_cash).toBe(30000000); // 100M - 60M - 10M
  });

  it('buying_power = available_cash - pending_buy_lock (MAP-01)', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        total_balance: '100000000',
        available_cash: '60000000',
        pending_settlement_cash: '10000000',
        pending_buy_lock: '15000000',
      }]
    });

    const balance = await CapitalService.getBalance('portfolio-1');
    expect(balance.pending_buy_lock).toBe(15000000);
    expect(balance.buying_power).toBe(45000000); // 60M - 15M
  });

  it('getBalance uses integer math (round snap, no parseFloat accumulation)', async () => {
    // Gia tri co decimals thap (VND thuc te NUMERIC(20,2)) — phai round ve int
    mockQuery.mockResolvedValueOnce({
      rows: [{
        total_balance: '100000000.49',
        available_cash: '60000000.51',
        pending_settlement_cash: '10000000.00',
        pending_buy_lock: '0.00',
      }]
    });

    const balance = await CapitalService.getBalance('portfolio-1');
    expect(balance.total_balance).toBe(100000000);    // round down from .49
    expect(balance.available_cash).toBe(60000001);    // round up from .51
    expect(Number.isInteger(balance.buying_power)).toBe(true);
    expect(Number.isInteger(balance.deployed_cash)).toBe(true);
  });
});
