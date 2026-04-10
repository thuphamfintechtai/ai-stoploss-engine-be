import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupDbMock, mockQuery, mockTransaction, resetDbMocks } from '../helpers/db.js';

// Setup DB mock truoc khi import PaperCapitalService
setupDbMock();

import PaperCapitalService from '../../services/paper/paperCapitalService.js';

beforeEach(() => {
  resetDbMocks();
});

// ============================================================
// deductForBuy
// ============================================================
describe('PaperCapitalService.deductForBuy', () => {
  it('giam paper_available_cash khi co du tien (happy path)', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ paper_available_cash: '100000000' }] }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ rows: [], rowCount: 1 }),                         // UPDATE
      };
      return callback(mockClient);
    });

    await expect(
      PaperCapitalService.deductForBuy('portfolio-1', 50_000_000)
    ).resolves.not.toThrow();
  });

  it('throw 422 khi paper_available_cash khong du', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ paper_available_cash: '10000000' }] }) // SELECT FOR UPDATE
          .mockResolvedValueOnce({ rows: [] }),
      };
      return callback(mockClient);
    });

    let err;
    try {
      await PaperCapitalService.deductForBuy('portfolio-1', 50_000_000);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(422);
    expect(err.message).toMatch(/Khong du so du paper trading/);
  });

  it('throw 422 khi portfolio khong ton tai (no rows)', async () => {
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockResolvedValueOnce({ rows: [] }), // Portfolio not found
      };
      return callback(mockClient);
    });

    let err;
    try {
      await PaperCapitalService.deductForBuy('non-existent', 1000);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.statusCode).toBe(422);
  });

  it('su dung SELECT FOR UPDATE de tranh race condition', async () => {
    const capturedQueries = [];
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql, params) => {
          capturedQueries.push(sql);
          // First call is SELECT FOR UPDATE, return cash data
          if (sql && sql.toLowerCase().includes('select')) {
            return Promise.resolve({ rows: [{ paper_available_cash: '100000000' }] });
          }
          return Promise.resolve({ rows: [], rowCount: 1 });
        }),
      };
      return callback(mockClient);
    });

    try {
      await PaperCapitalService.deductForBuy('portfolio-1', 50_000_000);
    } catch (_) {}

    // At least one query must contain FOR UPDATE
    const hasForUpdate = capturedQueries.some(q => /FOR UPDATE/i.test(q));
    expect(hasForUpdate).toBe(true);
  });
});

// ============================================================
// addPendingSettlement
// ============================================================
describe('PaperCapitalService.addPendingSettlement', () => {
  it('tang paper_pending_settlement va insert paper_settlement_events record', async () => {
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })                    // UPDATE pending_settlement
        .mockResolvedValueOnce({ rows: [{ id: 'evt-1' }] }),   // INSERT settlement_events
    };
    mockTransaction.mockImplementationOnce(async (callback) => callback(mockClient));

    await expect(
      PaperCapitalService.addPendingSettlement('portfolio-1', 5_000_000, 'order-1')
    ).resolves.not.toThrow();

    expect(mockClient.query).toHaveBeenCalledTimes(2);
  });

  it('hoat dong dung voi orderId = null (optional)', async () => {
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'evt-2' }] }),
    };
    mockTransaction.mockImplementationOnce(async (callback) => callback(mockClient));

    await expect(
      PaperCapitalService.addPendingSettlement('portfolio-1', 3_000_000)
    ).resolves.not.toThrow();
  });

  it('su dung addBusinessDays de tinh settlement_date T+2', async () => {
    let capturedInsertSql = '';
    let capturedParams = [];

    const mockClient = {
      query: vi.fn().mockImplementation((sql, params) => {
        if (sql && sql.toLowerCase().includes('insert')) {
          capturedInsertSql = sql;
          capturedParams = params;
        }
        return Promise.resolve({ rows: [] });
      }),
    };
    mockTransaction.mockImplementationOnce(async (callback) => callback(mockClient));

    await PaperCapitalService.addPendingSettlement('portfolio-1', 5_000_000);

    // settlement_date phai la Date object (T+2 business days)
    const settlementDate = capturedParams[3]; // portfolio_id, order_id, amount, settlement_date
    expect(settlementDate).toBeInstanceOf(Date);
  });
});

// ============================================================
// processSettlements
// ============================================================
describe('PaperCapitalService.processSettlements', () => {
  it('return 0 khi khong co pending settlements', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const count = await PaperCapitalService.processSettlements();
    expect(count).toBe(0);
  });

  it('xu ly pending settlements va return so luong da xu ly', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'evt-1', portfolio_id: 'p-1', amount: '5000000' },
        { id: 'evt-2', portfolio_id: 'p-2', amount: '3000000' },
      ],
    });

    mockTransaction
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const count = await PaperCapitalService.processSettlements();
    expect(count).toBe(2);
    expect(mockTransaction).toHaveBeenCalledTimes(2);
  });

  it('chuyen amount tu paper_pending_settlement sang paper_available_cash', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'evt-1', portfolio_id: 'p-1', amount: '5000000' }],
    });

    const capturedUpdateSqls = [];
    mockTransaction.mockImplementationOnce(async (callback) => {
      const mockClient = {
        query: vi.fn().mockImplementation((sql) => {
          if (sql && sql.toLowerCase().includes('update')) capturedUpdateSqls.push(sql);
          return Promise.resolve({ rows: [] });
        }),
      };
      return callback(mockClient);
    });

    await PaperCapitalService.processSettlements();
    // It should update portfolios (available + pending) AND settlement_events (status=SETTLED)
    const portfolioUpdate = capturedUpdateSqls.find(s => /paper_available_cash/i.test(s));
    expect(portfolioUpdate).toBeDefined();
    expect(portfolioUpdate).toMatch(/paper_pending_settlement/i);
  });
});

// ============================================================
// getVirtualBalance
// ============================================================
describe('PaperCapitalService.getVirtualBalance', () => {
  it('return null khi portfolio khong ton tai', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await PaperCapitalService.getVirtualBalance('non-existent');
    expect(result).toBeNull();
  });

  it('tinh paper_deployed = virtual_balance - available - pending', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        virtual_balance: '1000000000',
        paper_available_cash: '600000000',
        paper_pending_settlement: '100000000',
      }],
    });

    const balance = await PaperCapitalService.getVirtualBalance('portfolio-1');
    expect(balance.virtual_balance).toBe(1_000_000_000);
    expect(balance.paper_available_cash).toBe(600_000_000);
    expect(balance.paper_pending_settlement).toBe(100_000_000);
    expect(balance.paper_deployed).toBe(300_000_000); // 1B - 600M - 100M
  });
});

// ============================================================
// refundForCancel
// ============================================================
describe('PaperCapitalService.refundForCancel', () => {
  it('cong lai paper_available_cash khi cancel order', async () => {
    let capturedSql = '';
    mockQuery.mockImplementationOnce((sql) => {
      capturedSql = sql;
      return Promise.resolve({ rows: [], rowCount: 1 });
    });

    await PaperCapitalService.refundForCancel('portfolio-1', 5_000_000);
    expect(capturedSql).toMatch(/paper_available_cash/i);
    expect(capturedSql).toMatch(/\+ \$2/);
  });

  it('khong throw khi refund thanh cong', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    await expect(
      PaperCapitalService.refundForCancel('portfolio-1', 5_000_000)
    ).resolves.not.toThrow();
  });
});
