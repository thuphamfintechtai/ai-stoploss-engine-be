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

import { query } from '../../config/database.js';
import CapitalService from '../../services/portfolio/capitalService.js';
import { getPortfolioSummary } from '../../controllers/portfolio/portfolioSummary.controller.js';

// Helper tao mock req/res
function mockReqRes(portfolioId = 'portfolio-1') {
  const req = {
    params: { portfolioId, id: portfolioId },
    user: { userId: 'user-1' },
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
  });

  it('tra ve zeros khi portfolio rong (khong co position)', async () => {
    CapitalService.getBalance.mockResolvedValue({
      total_balance: 100000000,
      available_cash: 100000000,
      pending_settlement_cash: 0,
      deployed_cash: 0,
    });

    // OPEN positions: empty
    query.mockResolvedValueOnce({
      rows: [{ position_count: '0', total_invested: '0', total_shares: '0' }],
      rowCount: 1,
    });
    // CLOSED positions: empty
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
          total_pnl: 0,
          position_count: 0,
        }),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('tinh tong gia tri dung khi co 2 OPEN positions', async () => {
    CapitalService.getBalance.mockResolvedValue({
      total_balance: 200000000,
      available_cash: 50000000,
      pending_settlement_cash: 0,
      deployed_cash: 150000000,
    });

    // 2 OPEN positions: VNM 100 @ 150000 + HPG 200 @ 30000 = 21,000,000
    query.mockResolvedValueOnce({
      rows: [{ position_count: '2', total_invested: '21000000', total_shares: '300' }],
      rowCount: 1,
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
          total_value: 21000000,
          position_count: 2,
        }),
      })
    );
  });

  it('tinh realized P&L dung khi co 1 CLOSED_MANUAL position', async () => {
    CapitalService.getBalance.mockResolvedValue({
      total_balance: 100000000,
      available_cash: 100000000,
      pending_settlement_cash: 0,
      deployed_cash: 0,
    });

    // Khong co OPEN
    query.mockResolvedValueOnce({
      rows: [{ position_count: '0', total_invested: '0', total_shares: '0' }],
      rowCount: 1,
    });
    // 1 CLOSED_MANUAL: realized_pnl = 5,000,000
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
          total_realized_pnl: 5000000,
          total_pnl: 5000000,
          closed_count: 1,
        }),
      })
    );
  });

  it('tinh percent_return dung theo total_balance', async () => {
    CapitalService.getBalance.mockResolvedValue({
      total_balance: 100000000,
      available_cash: 100000000,
      pending_settlement_cash: 0,
      deployed_cash: 0,
    });

    query.mockResolvedValueOnce({
      rows: [{ position_count: '0', total_invested: '0', total_shares: '0' }],
      rowCount: 1,
    });
    // Realized PnL = 5,000,000 tren total_balance 100,000,000 -> 5%
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
    CapitalService.getBalance.mockResolvedValue({
      total_balance: 100000000,
      available_cash: 80000000,
      pending_settlement_cash: 0,
      deployed_cash: 20000000,
    });

    query.mockResolvedValueOnce({
      rows: [{ position_count: '1', total_invested: '20000000', total_shares: '100' }],
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
