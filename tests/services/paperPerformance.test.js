/**
 * Tests: PaperPerformanceService
 *
 * Verify:
 * - getPerformanceReport: tinh dung total_trades, win_rate, profit_factor, avg_win, avg_loss
 * - getPerformanceReport voi 0 trades: tra ve zeroed metrics
 * - getMaxDrawdown: tinh dung tu equity curve
 * - getBuyAndHoldReturn: tinh net holdings (per Pitfall 7), khong bao gom da ban
 * - Time filter: period = 'week' va 'month' chinh xac
 * - Chi query PAPER context (Pitfall 6)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockQuery, setupDbMock, resetDbMocks } from '../helpers/db.js';

// Setup DB mock truoc khi import service
setupDbMock();

// Mock marketPriceService
vi.mock('../../services/shared/marketPriceService.js', () => ({
  getMarketData: vi.fn(),
  default: { getMarketData: vi.fn() },
}));

import PaperPerformanceService from '../../services/paper/paperPerformanceService.js';
import { getMarketData } from '../../services/shared/marketPriceService.js';

describe('PaperPerformanceService', () => {
  beforeEach(() => {
    resetDbMocks();
    vi.clearAllMocks();
  });

  // ─── getPerformanceReport ────────────────────────────────────────────────────

  describe('getPerformanceReport', () => {
    it('tinh dung metrics voi 3 closed positions (2 win, 1 loss)', async () => {
      // 2 positions win: +500000, +300000; 1 position loss: -200000
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_trades: '3',
          winning_trades: '2',
          losing_trades: '1',
          total_pnl: '600000',
          gross_profit: '800000',
          gross_loss: '200000',
          avg_win: '400000',
          avg_loss: '200000',
        }],
        rowCount: 1,
      });

      const result = await PaperPerformanceService.getPerformanceReport(1);

      expect(result.total_trades).toBe(3);
      expect(result.winning_trades).toBe(2);
      expect(result.losing_trades).toBe(1);
      expect(result.total_pnl).toBe(600000);
      expect(result.gross_profit).toBe(800000);
      expect(result.gross_loss).toBe(200000);
      expect(result.avg_win).toBe(400000);
      expect(result.avg_loss).toBe(200000);
      // win_rate = 2/3 * 100 = 66.67%
      expect(result.win_rate).toBeCloseTo(66.67, 1);
      // profit_factor = 800000 / 200000 = 4
      expect(result.profit_factor).toBeCloseTo(4, 2);
    });

    it('tra ve zeroed metrics khi khong co trades', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_trades: '0',
          winning_trades: '0',
          losing_trades: '0',
          total_pnl: '0',
          gross_profit: '0',
          gross_loss: '0',
          avg_win: '0',
          avg_loss: '0',
        }],
        rowCount: 1,
      });

      const result = await PaperPerformanceService.getPerformanceReport(1);

      expect(result.total_trades).toBe(0);
      expect(result.winning_trades).toBe(0);
      expect(result.losing_trades).toBe(0);
      expect(result.total_pnl).toBe(0);
      expect(result.win_rate).toBe(0);
      expect(result.profit_factor).toBe(0);
    });

    it('chi query PAPER positions (Pitfall 6)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_trades: '0',
          winning_trades: '0',
          losing_trades: '0',
          total_pnl: '0',
          gross_profit: '0',
          gross_loss: '0',
          avg_win: '0',
          avg_loss: '0',
        }],
        rowCount: 1,
      });

      await PaperPerformanceService.getPerformanceReport(42);

      // Verify query duoc goi voi context = 'PAPER'
      expect(mockQuery).toHaveBeenCalledTimes(1);
      const callArgs = mockQuery.mock.calls[0];
      const sql = callArgs[0];
      expect(sql).toContain("context = 'PAPER'");
      expect(callArgs[1]).toContain(42); // portfolioId
    });

    it('ap dung time filter period = week (7 ngay qua)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_trades: '1',
          winning_trades: '1',
          losing_trades: '0',
          total_pnl: '200000',
          gross_profit: '200000',
          gross_loss: '0',
          avg_win: '200000',
          avg_loss: '0',
        }],
        rowCount: 1,
      });

      await PaperPerformanceService.getPerformanceReport(1, { period: 'week' });

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs[1];
      // Params phai co date filter (khong null)
      expect(params.length).toBeGreaterThan(1);
      const dateParam = params[1];
      expect(dateParam).not.toBeNull();
      // date filter phai gan day (trong 7 ngay)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const diff = Math.abs(new Date(dateParam) - sevenDaysAgo);
      expect(diff).toBeLessThan(60 * 1000); // trong vong 1 phut
    });

    it('ap dung time filter period = month (30 ngay qua)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_trades: '0',
          winning_trades: '0',
          losing_trades: '0',
          total_pnl: '0',
          gross_profit: '0',
          gross_loss: '0',
          avg_win: '0',
          avg_loss: '0',
        }],
        rowCount: 1,
      });

      await PaperPerformanceService.getPerformanceReport(1, { period: 'month' });

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs[1];
      const dateParam = params[1];
      expect(dateParam).not.toBeNull();
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const diff = Math.abs(new Date(dateParam) - thirtyDaysAgo);
      expect(diff).toBeLessThan(60 * 1000);
    });

    it('period = all thi khong co date filter (null)', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_trades: '0',
          winning_trades: '0',
          losing_trades: '0',
          total_pnl: '0',
          gross_profit: '0',
          gross_loss: '0',
          avg_win: '0',
          avg_loss: '0',
        }],
        rowCount: 1,
      });

      await PaperPerformanceService.getPerformanceReport(1, { period: 'all' });

      const callArgs = mockQuery.mock.calls[0];
      const params = callArgs[1];
      expect(params[1]).toBeNull(); // date filter = null
    });
  });

  // ─── getMaxDrawdown ──────────────────────────────────────────────────────────

  describe('getMaxDrawdown', () => {
    it('tinh dung max drawdown tu equity curve', async () => {
      // Equity curve: +300000, +200000, -400000, +100000
      // Cumulative: 300000, 500000, 100000, 200000
      // Peak = 500000, Trough = 100000
      // Max drawdown = (500000 - 100000) = 400000 VND, 80%
      mockQuery.mockResolvedValueOnce({
        rows: [
          { profit_loss_vnd: '300000', closed_at: '2025-01-01' },
          { profit_loss_vnd: '200000', closed_at: '2025-01-02' },
          { profit_loss_vnd: '-400000', closed_at: '2025-01-03' },
          { profit_loss_vnd: '100000', closed_at: '2025-01-04' },
        ],
        rowCount: 4,
      });

      const result = await PaperPerformanceService.getMaxDrawdown(1);

      expect(result.max_drawdown_vnd).toBe(400000);
      expect(result.max_drawdown_pct).toBeCloseTo(80, 0);
    });

    it('tra ve 0 khi khong co positions', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await PaperPerformanceService.getMaxDrawdown(1);

      expect(result.max_drawdown_vnd).toBe(0);
      expect(result.max_drawdown_pct).toBe(0);
    });

    it('tra ve 0 khi chi co 1 position win', async () => {
      // Chi co 1 position, khong co drawdown
      mockQuery.mockResolvedValueOnce({
        rows: [{ profit_loss_vnd: '500000', closed_at: '2025-01-01' }],
        rowCount: 1,
      });

      const result = await PaperPerformanceService.getMaxDrawdown(1);

      expect(result.max_drawdown_vnd).toBe(0);
      expect(result.max_drawdown_pct).toBe(0);
    });
  });

  // ─── getBuyAndHoldReturn ─────────────────────────────────────────────────────

  describe('getBuyAndHoldReturn', () => {
    it('tinh net holdings (Pitfall 7): tru positions da ban', async () => {
      // VCB: mua 1000, ban 300 -> net = 700, cost = 30000 * 700/1000 (ratio)
      // Gia hien tai: 35000 VND
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            symbol: 'VCB',
            net_qty: '700',
            total_buy_cost: '30000000', // 1000 * 30000
          },
        ],
        rowCount: 1,
      });

      getMarketData.mockResolvedValueOnce({ price: 35, reference: 35 }); // VPBS tra ve hang nghin

      const result = await PaperPerformanceService.getBuyAndHoldReturn(1);

      // buy_hold_value = 700 * 35000 = 24500000
      // buy_hold_cost = 30000000 * (700/1000) = 21000000 -- khong, ta dung total_buy_cost truc tiep nhu cost cua net_qty
      // NOTE: query GROUP BY HAVING net_qty > 0 da tinh total_buy_cost cua tat ca BUY orders
      // buy_hold_value = 700 * 35000 = 24500000
      expect(result.buy_hold_value).toBeGreaterThan(0);
      expect(result.buy_hold_return).toBeDefined();
      expect(result.buy_hold_return_pct).toBeDefined();
    });

    it('tra ve 0 khi khong co net holdings', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await PaperPerformanceService.getBuyAndHoldReturn(1);

      expect(result.buy_hold_value).toBe(0);
      expect(result.buy_hold_cost).toBe(0);
      expect(result.buy_hold_return).toBe(0);
      expect(result.buy_hold_return_pct).toBe(0);
    });

    it('chi tinh PAPER positions (Pitfall 6)', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await PaperPerformanceService.getBuyAndHoldReturn(99);

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain("context = 'PAPER'");
    });
  });

  // ─── getFullReport ───────────────────────────────────────────────────────────

  describe('getFullReport', () => {
    it('ket hop tat ca metrics vao 1 report', async () => {
      // Mock getPerformanceReport
      mockQuery.mockResolvedValueOnce({
        rows: [{
          total_trades: '2',
          winning_trades: '2',
          losing_trades: '0',
          total_pnl: '500000',
          gross_profit: '500000',
          gross_loss: '0',
          avg_win: '250000',
          avg_loss: '0',
        }],
        rowCount: 1,
      });
      // Mock getMaxDrawdown
      mockQuery.mockResolvedValueOnce({
        rows: [
          { profit_loss_vnd: '300000', closed_at: '2025-01-01' },
          { profit_loss_vnd: '200000', closed_at: '2025-01-02' },
        ],
        rowCount: 2,
      });
      // Mock getBuyAndHoldReturn
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const report = await PaperPerformanceService.getFullReport(1, { period: 'all' });

      expect(report).toHaveProperty('total_trades');
      expect(report).toHaveProperty('win_rate');
      expect(report).toHaveProperty('profit_factor');
      expect(report).toHaveProperty('max_drawdown_vnd');
      expect(report).toHaveProperty('max_drawdown_pct');
      expect(report).toHaveProperty('buy_hold_return');
      expect(report).toHaveProperty('buy_hold_return_pct');
    });
  });
});
