import { describe, it, expect, beforeEach, vi } from 'vitest';

// Setup DB mock TRUOC khi import service
vi.mock('../../config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  transaction: vi.fn().mockImplementation(async (callback) => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    return callback(mockClient);
  }),
  default: {},
}));

vi.mock('../../models/Order.js', () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock('../../services/shared/feeEngine.js', () => ({
  calculateFees: vi.fn().mockReturnValue({
    buy_fee_vnd: 22500,
    sell_fee_vnd: 22500,
    sell_tax_vnd: 15000,
    total_fee_vnd: 60000,
    gross_pnl_vnd: 500000,
    net_pnl_vnd: 440000,
  }),
}));

// Mock CapitalService (closePosition calls addPendingSettlement → DB side effect unwanted in unit test)
vi.mock('../../services/portfolio/capitalService.js', () => ({
  default: {
    addPendingSettlement: vi.fn().mockResolvedValue(undefined),
  },
  addBusinessDays: vi.fn((date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }),
}));

import { query, transaction } from '../../config/database.js';
import Order from '../../models/Order.js';
import { calculateFees } from '../../services/shared/feeEngine.js';
import CapitalService from '../../services/portfolio/capitalService.js';
import RealPositionService from '../../services/portfolio/realPositionService.js';

describe('RealPositionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('closePosition', () => {
    it('tinh P&L voi fees khi dong position', async () => {
      const mockPosition = {
        id: 'position-1',
        portfolio_id: 'portfolio-1',
        symbol: 'VNM',
        exchange: 'HOSE',
        context: 'REAL',
        status: 'OPEN',
        entry_price: 150000,
        quantity: 100,
      };

      const mockSellOrder = {
        id: 'sell-order-1',
        side: 'SELL',
        context: 'REAL',
        status: 'RECORDED',
      };

      const mockUpdatedPosition = {
        ...mockPosition,
        status: 'CLOSED_MANUAL',
        exit_price: 155000,
        realized_pnl_vnd: 440000,
      };

      // Mock transaction dung properly
      transaction.mockImplementation(async (callback) => {
        const mockClient = {
          query: vi.fn()
            .mockResolvedValueOnce({ rows: [mockPosition], rowCount: 1 }) // find position
            .mockResolvedValueOnce({ rows: [mockSellOrder], rowCount: 1 }) // create sell order
            .mockResolvedValueOnce({ rows: [mockUpdatedPosition], rowCount: 1 }), // update position
        };
        return callback(mockClient);
      });

      const result = await RealPositionService.closePosition('position-1', {
        sellPrice: 155000,
        sellDate: '2026-03-27',
        portfolioId: 'portfolio-1',
      });

      expect(calculateFees).toHaveBeenCalledWith(150000, 155000, 100, expect.any(Object));
      expect(result).toHaveProperty('position');
      expect(result).toHaveProperty('sellOrder');
      expect(result).toHaveProperty('pnl');
    });

    it('update position status sang CLOSED_MANUAL', async () => {
      const mockPosition = {
        id: 'position-2',
        portfolio_id: 'portfolio-1',
        symbol: 'HPG',
        exchange: 'HOSE',
        context: 'REAL',
        status: 'OPEN',
        entry_price: 30000,
        quantity: 200,
      };

      transaction.mockImplementation(async (callback) => {
        const mockClient = {
          query: vi.fn()
            .mockResolvedValueOnce({ rows: [mockPosition], rowCount: 1 })
            .mockResolvedValueOnce({ rows: [{ id: 'sell-order-2' }], rowCount: 1 })
            .mockResolvedValueOnce({
              rows: [{
                ...mockPosition,
                status: 'CLOSED_MANUAL',
                exit_price: 32000,
              }],
              rowCount: 1
            }),
        };
        return callback(mockClient);
      });

      const result = await RealPositionService.closePosition('position-2', {
        sellPrice: 32000,
        sellDate: '2026-03-27',
        portfolioId: 'portfolio-1',
      });

      // Check that the update call includes CLOSED_MANUAL
      const clientQueryCalls = transaction.mock.calls;
      expect(clientQueryCalls).toBeDefined();
      expect(result.position.status).toBe('CLOSED_MANUAL');
    });

    it('throw error khi co gang dong position da CLOSED', async () => {
      const closedPosition = {
        id: 'position-3',
        portfolio_id: 'portfolio-1',
        symbol: 'VNM',
        context: 'REAL',
        status: 'CLOSED_MANUAL', // da dong roi
        entry_price: 150000,
        quantity: 100,
      };

      transaction.mockImplementation(async (callback) => {
        const mockClient = {
          query: vi.fn().mockResolvedValueOnce({ rows: [closedPosition], rowCount: 1 }),
        };
        return callback(mockClient);
      });

      await expect(
        RealPositionService.closePosition('position-3', {
          sellPrice: 155000,
          sellDate: '2026-03-27',
          portfolioId: 'portfolio-1',
        })
      ).rejects.toThrow();
    });

    it('throw error khi position khong tim thay', async () => {
      transaction.mockImplementation(async (callback) => {
        const mockClient = {
          query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 }), // position khong ton tai
        };
        return callback(mockClient);
      });

      await expect(
        RealPositionService.closePosition('non-existent-id', {
          sellPrice: 155000,
          sellDate: '2026-03-27',
          portfolioId: 'portfolio-1',
        })
      ).rejects.toThrow();
    });
  });

  describe('getOpenPositions', () => {
    it('tra ve positions context=REAL va status=OPEN', async () => {
      const mockPositions = [
        { id: 'pos-1', context: 'REAL', status: 'OPEN' },
        { id: 'pos-2', context: 'REAL', status: 'OPEN' },
      ];

      query.mockResolvedValue({ rows: mockPositions, rowCount: 2 });

      const result = await RealPositionService.getOpenPositions('portfolio-1');

      expect(Array.isArray(result)).toBe(true);

      // Verify query dung context=REAL va status=OPEN
      const calls = query.mock.calls;
      const hasCorrectFilter = calls.some(call =>
        call[0] && call[0].includes('REAL') && call[0].includes('OPEN')
      );
      expect(hasCorrectFilter).toBe(true);
    });
  });

  describe('closePosition SQL column fix (MAP-03) — closed_price align schema', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('UPDATE financial.positions query dung closed_price, KHONG dung exit_price', async () => {
      const capturedQueries = [];
      const mockPosition = {
        id: 'pos-1',
        portfolio_id: 'port-1',
        status: 'OPEN',
        entry_price: '80000',
        quantity: '100',
        symbol: 'VNM',
        exchange: 'HOSE',
        buy_fee_percent: '0.0015',
        sell_fee_percent: '0.0015',
        sell_tax_percent: '0.001',
      };

      transaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: vi.fn().mockImplementation((sql) => {
            capturedQueries.push(sql);
            if (sql.startsWith('SELECT')) {
              return Promise.resolve({ rows: [mockPosition], rowCount: 1 });
            }
            if (sql.includes('INSERT INTO financial.orders')) {
              return Promise.resolve({ rows: [{ id: 'order-1' }], rowCount: 1 });
            }
            // UPDATE financial.positions
            return Promise.resolve({ rows: [{ id: 'pos-1', status: 'CLOSED_MANUAL' }], rowCount: 1 });
          }),
        };
        return callback(mockClient);
      });

      await RealPositionService.closePosition('pos-1', {
        sellPrice: 85000,
        sellDate: '2026-04-19',
        portfolioId: 'port-1',
      });

      const updateSql = capturedQueries.find(
        (q) => q.includes('UPDATE financial.positions')
      );
      expect(updateSql).toBeDefined();
      // Phai dung closed_price, KHONG duoc con exit_price
      expect(updateSql).toMatch(/closed_price\s*=\s*\$\d/);
      expect(updateSql).not.toMatch(/exit_price\s*=/);
    });

    it('addPendingSettlement nhan netSellProceeds la integer VND (MAP-05 D-06)', async () => {
      const mockPosition = {
        id: 'pos-1',
        portfolio_id: 'port-1',
        status: 'OPEN',
        entry_price: '80000',
        quantity: '100',
        symbol: 'VNM',
        exchange: 'HOSE',
        buy_fee_percent: '0.0015',
        sell_fee_percent: '0.0015',
        sell_tax_percent: '0.001',
      };

      transaction.mockImplementationOnce(async (callback) => {
        const mockClient = {
          query: vi
            .fn()
            .mockResolvedValueOnce({ rows: [mockPosition], rowCount: 1 }) // SELECT
            .mockResolvedValueOnce({ rows: [{ id: 'order-1' }], rowCount: 1 }) // INSERT
            .mockResolvedValueOnce({ rows: [{ id: 'pos-1', status: 'CLOSED_MANUAL' }], rowCount: 1 }), // UPDATE
        };
        return callback(mockClient);
      });

      await RealPositionService.closePosition('pos-1', {
        sellPrice: 85000,
        sellDate: '2026-04-19',
        portfolioId: 'port-1',
      });

      expect(CapitalService.addPendingSettlement).toHaveBeenCalled();
      const callArgs = CapitalService.addPendingSettlement.mock.calls[0];
      const netAmount = callArgs[1]; // (portfolioId, netAmount, settlementDate)
      expect(typeof netAmount).toBe('number');
      expect(Number.isInteger(netAmount)).toBe(true);
      expect(Number.isFinite(netAmount)).toBe(true);
    });

    it('closePosition source code KHONG con reference toi exit_price', async () => {
      // Smoke assertion: doc source file verify column naming da align
      const fs = await import('node:fs');
      const path = await import('node:path');
      const url = await import('node:url');
      const here = path.dirname(url.fileURLToPath(import.meta.url));
      const srcPath = path.resolve(here, '../../services/portfolio/realPositionService.js');
      const source = fs.readFileSync(srcPath, 'utf8');
      // Allow exit_price trong comment historical, nhung KHONG duoc xuat hien trong SQL string
      // Simplest: verify no `exit_price = $N` pattern
      expect(source).not.toMatch(/exit_price\s*=\s*\$\d/);
      expect(source).toMatch(/closed_price\s*=\s*\$\d/);
    });
  });
});
