import { describe, it, expect, beforeEach, vi } from 'vitest';

// Setup DB mock TRUOC khi import controller
vi.mock('../../config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  transaction: vi.fn(),
  default: {},
}));

// Mock CapitalService
vi.mock('../../services/portfolio/capitalService.js', () => ({
  default: {
    getBalance: vi.fn(),
  },
  addBusinessDays: vi.fn(),
}));

// Mock Portfolio model cho ownership check (MAP-07)
vi.mock('../../models/Portfolio.js', () => ({
  default: {
    findById: vi.fn(),
  },
}));

// Mock marketPriceService cho mark-to-market per-symbol (D-08)
vi.mock('../../services/shared/marketPriceService.js', () => ({
  getMarketData: vi.fn(),
  getMarketPrice: vi.fn(),
  default: {
    getMarketData: vi.fn(),
    getMarketPrice: vi.fn(),
  },
}));

import { query } from '../../config/database.js';
import CapitalService from '../../services/portfolio/capitalService.js';
import Portfolio from '../../models/Portfolio.js';
import marketPriceService from '../../services/shared/marketPriceService.js';
import { getPortfolioSummary } from '../../controllers/portfolio/portfolioSummary.controller.js';

// Helper tao mock req/res
function mockReqRes(portfolioId = 'portfolio-1', userId = 'user-1') {
  const req = {
    params: { portfolioId, id: portfolioId },
    user: { userId },
  };
  const res = {
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

describe('getPortfolioSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default balance (nhiều test không quan tâm cash_balance shape)
    CapitalService.getBalance.mockResolvedValue({
      total_balance: 100_000_000,
      available_cash: 80_000_000,
      pending_buy_lock: 0,
      buying_power: 80_000_000,
      pending_settlement_cash: 0,
      deployed_cash: 20_000_000,
    });
    // Default ownership pass
    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
    // Default market data null → fallback entry_price
    marketPriceService.getMarketData.mockResolvedValue(null);
  });

  it('tra ve zeros khi portfolio rong (khong co position)', async () => {
    // OPEN positions: empty list (rowset theo D-08 flow: SELECT id, symbol, quantity, entry_price, buy_fee_vnd)
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // CLOSED aggregate: zero
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '0', total_realized_pnl: '0' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          total_value: 0,
          total_realized_pnl: 0,
          total_unrealized_pnl: 0,
          total_pnl: 0,
          position_count: 0,
        }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('tinh tong gia tri dung khi co 2 OPEN positions', async () => {
    CapitalService.getBalance.mockResolvedValue({
      total_balance: 200_000_000,
      available_cash: 50_000_000,
      pending_buy_lock: 0,
      buying_power: 50_000_000,
      pending_settlement_cash: 0,
      deployed_cash: 150_000_000,
    });

    // 2 OPEN: VNM 100 @ 150000 + HPG 200 @ 30000 = 21,000,000
    query.mockResolvedValueOnce({
      rows: [
        { id: 'pos-1', symbol: 'VNM', quantity: 100, entry_price: '150000', buy_fee_vnd: '0' },
        { id: 'pos-2', symbol: 'HPG', quantity: 200, entry_price: '30000', buy_fee_vnd: '0' },
      ],
      rowCount: 2,
    });
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '0', total_realized_pnl: '0' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          total_value: 21_000_000,
          position_count: 2,
        }),
      })
    );
  });

  it('tinh realized P&L dung khi co 1 CLOSED position', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // 1 CLOSED: realized_pnl = 5,000,000
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '1', total_realized_pnl: '5000000' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          total_realized_pnl: 5_000_000,
          total_pnl: 5_000_000,
          closed_count: 1,
        }),
      })
    );
  });

  it('tinh percent_return dung theo total_balance', async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    // Realized 5M / total_balance 100M -> 5%
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '1', total_realized_pnl: '5000000' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);

    const callArg = res.json.mock.calls[0][0];
    expect(callArg.data.percent_return).toBe(5);
  });

  it('response co cau truc dung (total_value, total_pnl, cash_balance)', async () => {
    query.mockResolvedValueOnce({
      rows: [
        { id: 'pos-1', symbol: 'VNM', quantity: 100, entry_price: '200000', buy_fee_vnd: '0' },
      ],
      rowCount: 1,
    });
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '0', total_realized_pnl: '0' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);

    const callArg = res.json.mock.calls[0][0];
    expect(callArg).toHaveProperty('success', true);
    expect(callArg).toHaveProperty('data');
    expect(callArg.data).toHaveProperty('total_value');
    expect(callArg.data).toHaveProperty('total_realized_pnl');
    expect(callArg.data).toHaveProperty('total_unrealized_pnl');
    expect(callArg.data).toHaveProperty('total_pnl');
    expect(callArg.data).toHaveProperty('percent_return');
    expect(callArg.data).toHaveProperty('position_count');
    expect(callArg.data).toHaveProperty('cash_balance');
  });
});

// ─── D-08 + MAP-06: realized vs unrealized split + per-symbol mark-to-market ───
describe('portfolioSummary — realized vs unrealized split (MAP-06, D-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    CapitalService.getBalance.mockResolvedValue({
      total_balance: 100_000_000,
      available_cash: 80_000_000,
      pending_buy_lock: 0,
      buying_power: 80_000_000,
      pending_settlement_cash: 0,
      deployed_cash: 20_000_000,
    });
    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
  });

  it('total_unrealized_pnl computed per-symbol voi marketPriceService', async () => {
    // 2 OPEN positions
    query.mockResolvedValueOnce({
      rows: [
        { id: 'pos-1', symbol: 'VNM', quantity: 100, entry_price: '80000', buy_fee_vnd: '12000' },
        { id: 'pos-2', symbol: 'HPG', quantity: 200, entry_price: '30000', buy_fee_vnd: '9000' },
      ],
      rowCount: 2,
    });
    // marketPriceService: VNM up 85000, HPG down 28000
    marketPriceService.getMarketData
      .mockResolvedValueOnce({ price: 85000, reference: 80000, high: 86000, low: 84000, quantity: 100 })
      .mockResolvedValueOnce({ price: 28000, reference: 30000, high: 29000, low: 27000, quantity: 200 });
    // CLOSED aggregate
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '1', total_realized_pnl: '500000' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);

    const data = res.json.mock.calls[0][0].data;
    // VNM: (85000-80000)*100 - 12000 = 500000 - 12000 = 488000
    // HPG: (28000-30000)*200 - 9000 = -400000 - 9000 = -409000
    // Sum = 79000
    expect(data.total_unrealized_pnl).toBe(79_000);
    expect(data.total_realized_pnl).toBe(500_000);
    expect(data.total_pnl).toBe(579_000);
  });

  it('graceful fallback khi marketPriceService throw — lastPrice = entry_price', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'pos-1', symbol: 'VNM', quantity: 100, entry_price: '80000', buy_fee_vnd: '12000' }],
      rowCount: 1,
    });
    marketPriceService.getMarketData.mockRejectedValueOnce(new Error('VPBS timeout'));
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '0', total_realized_pnl: '0' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);

    const data = res.json.mock.calls[0][0].data;
    // Fallback: lastPrice = entry → (80000-80000)*100 - 12000 = -12000
    expect(data.total_unrealized_pnl).toBe(-12_000);
  });

  it('graceful fallback khi snapshot null — lastPrice = entry_price', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'pos-1', symbol: 'VNM', quantity: 100, entry_price: '80000', buy_fee_vnd: '12000' }],
      rowCount: 1,
    });
    marketPriceService.getMarketData.mockResolvedValueOnce(null);
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '0', total_realized_pnl: '0' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);
    const data = res.json.mock.calls[0][0].data;
    expect(data.total_unrealized_pnl).toBe(-12_000);
  });

  it('graceful fallback khi snapshot.price null (error field set) — lastPrice = entry_price', async () => {
    query.mockResolvedValueOnce({
      rows: [{ id: 'pos-1', symbol: 'VNM', quantity: 100, entry_price: '80000', buy_fee_vnd: '12000' }],
      rowCount: 1,
    });
    marketPriceService.getMarketData.mockResolvedValueOnce({
      price: null, reference: null, high: null, low: null, quantity: null, error: 'No market data from VPBS',
    });
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '0', total_realized_pnl: '0' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);
    const data = res.json.mock.calls[0][0].data;
    expect(data.total_unrealized_pnl).toBe(-12_000);
  });

  it("status LIKE 'CLOSED%' pattern trong SQL query (cover CLOSED_MANUAL + future CLOSED_SL + CLOSED_TP)", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '0', total_realized_pnl: '0' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);
    // Verify query call contains LIKE 'CLOSED%'
    const closedCall = query.mock.calls.find((c) => /status\s+LIKE\s+'CLOSED%'/.test(c[0]));
    expect(closedCall).toBeDefined();
  });

  it('tra 403 khi portfolio.user_id khac req.user.userId (MAP-07)', async () => {
    Portfolio.findById.mockResolvedValueOnce({ id: 'portfolio-1', user_id: 'user-B' });

    const { req, res, next } = mockReqRes('portfolio-1', 'user-A');
    await getPortfolioSummary(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
  });

  it('tra 404 khi portfolio khong ton tai', async () => {
    Portfolio.findById.mockResolvedValueOnce(null);

    const { req, res, next } = mockReqRes('portfolio-nonexistent', 'user-A');
    await getPortfolioSummary(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    const body = res.json.mock.calls[0][0];
    expect(body.success).toBe(false);
  });

  it('cash_balance response include buying_power (integration voi Plan 03-01)', async () => {
    CapitalService.getBalance.mockResolvedValue({
      total_balance: 100_000_000,
      available_cash: 70_000_000,
      pending_buy_lock: 10_000_000,
      buying_power: 60_000_000,
      pending_settlement_cash: 5_000_000,
      deployed_cash: 25_000_000,
    });
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '0', total_realized_pnl: '0' }],
      rowCount: 1,
    });

    const { req, res, next } = mockReqRes();
    await getPortfolioSummary(req, res, next);

    const data = res.json.mock.calls[0][0].data;
    expect(data.cash_balance).toHaveProperty('buying_power', 60_000_000);
    expect(data.cash_balance).toHaveProperty('pending_buy_lock', 10_000_000);
  });
});
