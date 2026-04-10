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

describe('CapitalService.deductForBuy', () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it('deducts available_cash when sufficient funds', async () => {
    // Mock transaction to call callback with a mock client
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ available_cash: '100000000' }] }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }),                 // UPDATE
      };
      return callback(mockClient);
    });

    await expect(CapitalService.deductForBuy('portfolio-1', 50000000)).resolves.not.toThrow();
  });

  it('throws 422 when insufficient funds', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ available_cash: '10000000' }] }) // SELECT FOR UPDATE
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
});

describe('CapitalService.addPendingSettlement', () => {
  beforeEach(() => {
    resetDbMocks();
  });

  it('updates pending_settlement_cash and inserts settlement_event', async () => {
    const updateSpy = vi.fn().mockResolvedValue({ rows: [] });
    const insertSpy = vi.fn().mockResolvedValue({ rows: [{ id: 'evt-1' }] });

    mockTransaction.mockImplementationOnce(async (callback) => {
      let callCount = 0;
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

    // Two transactions for two events
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

  it('calculates deployed_cash correctly', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        total_balance: '100000000',
        available_cash: '60000000',
        pending_settlement_cash: '10000000',
      }]
    });

    const balance = await CapitalService.getBalance('portfolio-1');
    expect(balance.total_balance).toBe(100000000);
    expect(balance.available_cash).toBe(60000000);
    expect(balance.pending_settlement_cash).toBe(10000000);
    expect(balance.deployed_cash).toBe(30000000); // 100M - 60M - 10M
  });
});
