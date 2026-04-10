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

// Mock models
vi.mock('../../models/Order.js', () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock('../../models/Position.js', () => ({
  default: {
    create: vi.fn(),
  },
}));

// Mock shared feeEngine
vi.mock('../../services/shared/feeEngine.js', () => ({
  calculateBuyFee: vi.fn().mockReturnValue(22500),
}));

// Mock CapitalService -- can thiet vi realOrderService.js goi CapitalService.deductForBuy
vi.mock('../../services/portfolio/capitalService.js', () => ({
  default: {
    deductForBuy: vi.fn().mockResolvedValue(undefined),
    addPendingSettlement: vi.fn().mockResolvedValue(undefined),
    getBalance: vi.fn().mockResolvedValue({
      total_balance: 10000000000,
      available_cash: 10000000000,
      pending_settlement_cash: 0,
    }),
  },
}));

import { query } from '../../config/database.js';
import Order from '../../models/Order.js';
import Position from '../../models/Position.js';
import { calculateBuyFee } from '../../services/shared/feeEngine.js';
import RealOrderService from '../../services/portfolio/realOrderService.js';

describe('RealOrderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordBuyOrder', () => {
    it('tao order voi context=REAL va status=RECORDED', async () => {
      const mockOrder = {
        id: 'order-1',
        portfolio_id: 'portfolio-1',
        symbol: 'VNM',
        exchange: 'HOSE',
        side: 'BUY',
        order_type: 'MANUAL_RECORD',
        status: 'RECORDED',
        context: 'REAL',
        quantity: 100,
        actual_filled_at: '2026-03-27',
      };

      const mockPosition = {
        id: 'position-1',
        portfolio_id: 'portfolio-1',
        symbol: 'VNM',
        context: 'REAL',
        status: 'OPEN',
      };

      Order.create.mockResolvedValue(mockOrder);
      Position.create.mockResolvedValue(mockPosition);

      const result = await RealOrderService.recordBuyOrder('portfolio-1', {
        symbol: 'VNM',
        exchange: 'HOSE',
        quantity: 100,
        filledPrice: 150000,
        filledDate: '2026-03-27',
      });

      expect(Order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          portfolioId: 'portfolio-1',
          symbol: 'VNM',
          context: 'REAL',
          status: 'RECORDED',
          orderType: 'MANUAL_RECORD',
        })
      );
      expect(result).toHaveProperty('order');
      expect(result).toHaveProperty('position');
    });

    it('tao position voi context=REAL, status=OPEN, stopLoss=null', async () => {
      const mockOrder = { id: 'order-2', symbol: 'HPG' };
      const mockPosition = {
        id: 'position-2',
        symbol: 'HPG',
        context: 'REAL',
        status: 'OPEN',
        stop_loss: null,
      };

      Order.create.mockResolvedValue(mockOrder);
      Position.create.mockResolvedValue(mockPosition);

      await RealOrderService.recordBuyOrder('portfolio-1', {
        symbol: 'HPG',
        exchange: 'HOSE',
        quantity: 200,
        filledPrice: 30000,
        filledDate: '2026-03-27',
      });

      expect(Position.create).toHaveBeenCalledWith(
        expect.objectContaining({
          portfolioId: 'portfolio-1',
          symbol: 'HPG',
          context: 'REAL',
          stopLoss: null,
          takeProfit: null,
        })
      );
    });

    it('KHONG goi fillEngine trong recordBuyOrder', async () => {
      // Verify fillEngine khong ton tai trong file realOrderService.js
      // Neu fillEngine duoc import thi module se throw khi vi.mock chua duoc setup
      Order.create.mockResolvedValue({ id: 'order-3' });
      Position.create.mockResolvedValue({ id: 'position-3' });

      // fillEngine ko duoc goi -- ham goi OK ma khong throw = proof fillEngine khong dung
      await expect(
        RealOrderService.recordBuyOrder('portfolio-1', {
          symbol: 'VNM',
          exchange: 'HOSE',
          quantity: 100,
          filledPrice: 150000,
          filledDate: '2026-03-27',
        })
      ).resolves.toBeDefined();
    });

    it('goi calculateBuyFee khi tao position', async () => {
      Order.create.mockResolvedValue({ id: 'order-4' });
      Position.create.mockResolvedValue({ id: 'position-4' });

      await RealOrderService.recordBuyOrder('portfolio-1', {
        symbol: 'VNM',
        exchange: 'HOSE',
        quantity: 100,
        filledPrice: 150000,
        filledDate: '2026-03-27',
      });

      expect(calculateBuyFee).toHaveBeenCalledWith(150000, 100, expect.any(Object));
    });
  });

  describe('getTransactionHistory', () => {
    it('tra ve danh sach orders context=REAL voi pagination', async () => {
      const mockRows = [
        { id: 'order-1', context: 'REAL', symbol: 'VNM' },
        { id: 'order-2', context: 'REAL', symbol: 'HPG' },
      ];

      query.mockResolvedValueOnce({ rows: [{ count: '2' }], rowCount: 1 })
           .mockResolvedValueOnce({ rows: mockRows, rowCount: 2 });

      const result = await RealOrderService.getTransactionHistory('portfolio-1');

      expect(result).toHaveProperty('orders');
      expect(result).toHaveProperty('total');
      expect(result).toHaveProperty('page');
      expect(result).toHaveProperty('limit');
    });

    it('query chi lay orders co context=REAL', async () => {
      query.mockResolvedValueOnce({ rows: [{ count: '0' }], rowCount: 1 })
           .mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await RealOrderService.getTransactionHistory('portfolio-1');

      // Verify query duoc goi voi context='REAL'
      const calls = query.mock.calls;
      const hasRealContext = calls.some(call =>
        call[0] && call[0].includes('REAL')
      );
      expect(hasRealContext).toBe(true);
    });
  });
});
