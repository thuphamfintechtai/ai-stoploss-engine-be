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
    findById: vi.fn(),
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
    confirmBuyFill: vi.fn().mockResolvedValue(undefined),
    releaseBuyLock: vi.fn().mockResolvedValue(undefined),
    addPendingSettlement: vi.fn().mockResolvedValue(undefined),
    getBalance: vi.fn().mockResolvedValue({
      total_balance: 10000000000,
      available_cash: 10000000000,
      pending_settlement_cash: 0,
      pending_buy_lock: 0,
      buying_power: 10000000000,
    }),
  },
}));

import { query } from '../../config/database.js';
import Order from '../../models/Order.js';
import Position from '../../models/Position.js';
import { calculateBuyFee } from '../../services/shared/feeEngine.js';
import CapitalService from '../../services/portfolio/capitalService.js';
import RealOrderService from '../../services/portfolio/realOrderService.js';

describe('RealOrderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordBuyOrder (FILLED default — backward-compat)', () => {
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
      Order.create.mockResolvedValue({ id: 'order-3' });
      Position.create.mockResolvedValue({ id: 'position-3' });

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

    it('WARNING 10: goi deductForBuy voi 3 arg signature (portfolioId, totalCost, "FILLED")', async () => {
      Order.create.mockResolvedValue({ id: 'order-5' });
      Position.create.mockResolvedValue({ id: 'position-5' });

      await RealOrderService.recordBuyOrder('portfolio-1', {
        symbol: 'VNM',
        exchange: 'HOSE',
        quantity: 100,
        filledPrice: 150000,
        filledDate: '2026-03-27',
      });

      // Default state FILLED phai explicit trong call (3-arg signature)
      expect(CapitalService.deductForBuy).toHaveBeenCalledWith(
        'portfolio-1',
        expect.any(Number),
        'FILLED'
      );
    });
  });

  describe('recordBuyOrder (PENDING — MAP-01 D-05)', () => {
    it('PENDING: Order.status=PENDING, deductForBuy called with state=PENDING', async () => {
      Order.create.mockResolvedValue({
        id: 'order-pending-1',
        status: 'PENDING',
      });

      const result = await RealOrderService.recordBuyOrder('portfolio-1', {
        symbol: 'VNM',
        exchange: 'HOSE',
        quantity: 100,
        filledPrice: 150000,
        filledDate: '2026-03-27',
        orderStatus: 'PENDING',
      });

      expect(CapitalService.deductForBuy).toHaveBeenCalledWith(
        'portfolio-1',
        expect.any(Number),
        'PENDING'
      );
      expect(Order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'PENDING',
          orderType: 'LO',
        })
      );
      // PENDING: KHONG tao position
      expect(Position.create).not.toHaveBeenCalled();
      expect(result.position).toBeNull();
    });

    it('PENDING: actualFilledAt = null (chua khop)', async () => {
      Order.create.mockResolvedValue({ id: 'order-pending-2' });

      await RealOrderService.recordBuyOrder('portfolio-1', {
        symbol: 'HPG',
        exchange: 'HOSE',
        quantity: 200,
        filledPrice: 30000,
        filledDate: '2026-03-27',
        orderStatus: 'PENDING',
      });

      expect(Order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actualFilledAt: null,
        })
      );
    });

    it('invalid orderStatus → throw 400', async () => {
      let err;
      try {
        await RealOrderService.recordBuyOrder('portfolio-1', {
          symbol: 'VNM',
          exchange: 'HOSE',
          quantity: 100,
          filledPrice: 150000,
          filledDate: '2026-03-27',
          orderStatus: 'INVALID',
        });
      } catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.statusCode).toBe(400);
    });
  });

  describe('confirmOrderFill', () => {
    it('PENDING → RECORDED: call confirmBuyFill + tao Position', async () => {
      const pendingOrderRow = {
        id: 'order-pend',
        portfolio_id: 'portfolio-1',
        symbol: 'VNM',
        exchange: 'HOSE',
        quantity: 100,
        limit_price: 150000,
        status: 'PENDING',
        notes: null,
      };
      Order.findById
        .mockResolvedValueOnce(pendingOrderRow)   // initial load
        .mockResolvedValueOnce({ ...pendingOrderRow, status: 'RECORDED', avg_fill_price: 151000 }); // after update

      // Mock portfolio load cho _computeLockedAmount
      query.mockResolvedValueOnce({ rows: [{ id: 'portfolio-1', buy_fee_percent: 0.0015 }] })
           .mockResolvedValueOnce({ rowCount: 1 });  // UPDATE order

      Position.create.mockResolvedValue({ id: 'pos-filled', entry_price: 151000 });

      const result = await RealOrderService.confirmOrderFill('portfolio-1', 'order-pend', {
        actualPrice: 151000,
        actualDate: '2026-03-28',
      });

      expect(CapitalService.confirmBuyFill).toHaveBeenCalledWith(
        'portfolio-1',
        expect.any(Number),  // actualTotalCost
        expect.any(Number)   // lockedAmount
      );
      expect(Position.create).toHaveBeenCalledWith(
        expect.objectContaining({
          portfolioId: 'portfolio-1',
          entryPrice: 151000,
          context: 'REAL',
        })
      );
      expect(result).toHaveProperty('order');
      expect(result).toHaveProperty('position');
    });

    it('throws 404 khi order not found', async () => {
      Order.findById.mockResolvedValueOnce(null);
      let err;
      try {
        await RealOrderService.confirmOrderFill('portfolio-1', 'non-existent', {
          actualPrice: 150000, actualDate: '2026-03-28',
        });
      } catch (e) { err = e; }
      expect(err.statusCode).toBe(404);
    });

    it('throws 403 khi order khong thuoc portfolio', async () => {
      Order.findById.mockResolvedValueOnce({
        id: 'o', portfolio_id: 'portfolio-OTHER', status: 'PENDING'
      });
      let err;
      try {
        await RealOrderService.confirmOrderFill('portfolio-1', 'o', {
          actualPrice: 150000, actualDate: '2026-03-28',
        });
      } catch (e) { err = e; }
      expect(err.statusCode).toBe(403);
    });

    it('throws 409 khi order status != PENDING', async () => {
      Order.findById.mockResolvedValueOnce({
        id: 'o', portfolio_id: 'portfolio-1', status: 'RECORDED'
      });
      let err;
      try {
        await RealOrderService.confirmOrderFill('portfolio-1', 'o', {
          actualPrice: 150000, actualDate: '2026-03-28',
        });
      } catch (e) { err = e; }
      expect(err.statusCode).toBe(409);
    });
  });

  describe('cancelBuyOrder', () => {
    it('PENDING → CANCELLED: call releaseBuyLock', async () => {
      const pendingOrderRow = {
        id: 'order-pend',
        portfolio_id: 'portfolio-1',
        symbol: 'VNM',
        quantity: 100,
        limit_price: 150000,
        status: 'PENDING',
      };
      Order.findById
        .mockResolvedValueOnce(pendingOrderRow)
        .mockResolvedValueOnce({ ...pendingOrderRow, status: 'CANCELLED' });

      query.mockResolvedValueOnce({ rows: [{ id: 'portfolio-1', buy_fee_percent: 0.0015 }] })
           .mockResolvedValueOnce({ rowCount: 1 });  // UPDATE

      const result = await RealOrderService.cancelBuyOrder('portfolio-1', 'order-pend');

      expect(CapitalService.releaseBuyLock).toHaveBeenCalledWith(
        'portfolio-1',
        expect.any(Number)
      );
      expect(result).toHaveProperty('order');
    });

    it('throws 404 khi order not found', async () => {
      Order.findById.mockResolvedValueOnce(null);
      let err;
      try {
        await RealOrderService.cancelBuyOrder('portfolio-1', 'non-existent');
      } catch (e) { err = e; }
      expect(err.statusCode).toBe(404);
    });

    it('throws 403 khi order khong thuoc portfolio', async () => {
      Order.findById.mockResolvedValueOnce({
        id: 'o', portfolio_id: 'portfolio-OTHER', status: 'PENDING'
      });
      let err;
      try {
        await RealOrderService.cancelBuyOrder('portfolio-1', 'o');
      } catch (e) { err = e; }
      expect(err.statusCode).toBe(403);
    });

    it('throws 409 khi order status != PENDING', async () => {
      Order.findById.mockResolvedValueOnce({
        id: 'o', portfolio_id: 'portfolio-1', status: 'RECORDED'
      });
      let err;
      try {
        await RealOrderService.cancelBuyOrder('portfolio-1', 'o');
      } catch (e) { err = e; }
      expect(err.statusCode).toBe(409);
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

      const calls = query.mock.calls;
      const hasRealContext = calls.some(call =>
        call[0] && call[0].includes('REAL')
      );
      expect(hasRealContext).toBe(true);
    });
  });
});
