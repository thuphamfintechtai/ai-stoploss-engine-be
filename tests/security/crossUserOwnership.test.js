/**
 * Cross-User Ownership Security Tests (MAP-07, D-04)
 *
 * Verify moi portfolio-scoped endpoint reject cross-user access voi HTTP 403.
 * Pattern: mock Portfolio.findById tra portfolio thuoc user khac → assert 403.
 *
 * Cover ≥5 endpoints theo canonical list (03-03-PLAN.md line 98-108):
 *   1. GET    /api/portfolios/:id                                  (portfolio.controller.getById)
 *   2. PUT    /api/portfolios/:id                                  (portfolio.controller.update)
 *   3. POST   /:portfolioId/real-orders                            (realOrder.controller.createRealOrder)
 *   4. POST   /:portfolioId/real-positions/:positionId/close       (realPosition.controller.closePosition)
 *   5. GET    /:portfolioId/real-summary                           (portfolioSummary.controller.getPortfolioSummary)
 *
 * D-04 LOCK: Positive control (owner access own portfolio) MUST PASS — KHONG escape hatch.
 * BLOCKER 4 fix: mockResolvedValueOnce explicit moi test — KHONG default o beforeEach.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── DB mock (phai dung vi.mock top-level; helper db.js co warning hoist) ─────
vi.mock('../../config/database.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  transaction: vi.fn().mockImplementation(async (callback) => {
    const mockClient = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    return callback(mockClient);
  }),
  default: {},
}));

// ─── Model mocks ──────────────────────────────────────────────────────────────
vi.mock('../../models/Portfolio.js', () => ({
  default: {
    findById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../models/Position.js', () => ({
  default: {
    findById: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../../models/Order.js', () => ({
  default: {
    create: vi.fn(),
    findById: vi.fn(),
  },
}));

// ─── Service mocks (avoid DB side-effects cho positive path) ──────────────────
vi.mock('../../services/portfolio/capitalService.js', () => ({
  default: {
    getBalance: vi.fn().mockResolvedValue({
      total_balance: 100_000_000,
      available_cash: 80_000_000,
      pending_buy_lock: 0,
      buying_power: 80_000_000,
      pending_settlement_cash: 0,
      deployed_cash: 20_000_000,
    }),
    deductForBuy: vi.fn().mockResolvedValue(undefined),
  },
  addBusinessDays: vi.fn(),
}));

vi.mock('../../services/portfolio/realOrderService.js', () => ({
  default: {
    recordBuyOrder: vi.fn().mockResolvedValue({ order: {}, position: {} }),
    confirmOrderFill: vi.fn(),
    cancelBuyOrder: vi.fn(),
    getTransactionHistory: vi.fn(),
  },
}));

vi.mock('../../services/portfolio/realPositionService.js', () => ({
  default: {
    closePosition: vi.fn().mockResolvedValue({ position: {}, pnl: 0, sellOrder: {} }),
    getOpenPositions: vi.fn(),
    findPositionForClose: vi.fn(),
  },
}));

// marketPriceService: null → skip band check in realOrder/realPosition controllers
vi.mock('../../services/shared/marketPriceService.js', () => ({
  default: { getMarketData: vi.fn().mockResolvedValue(null), getMarketPrice: vi.fn() },
  getMarketData: vi.fn().mockResolvedValue(null),
  getMarketPrice: vi.fn(),
}));

// RiskCalculator cho portfolio.controller.getRisk/getPerformance (khong test day nhung import chain)
vi.mock('../../services/riskCalculator.js', () => ({
  default: { getPortfolioRiskStatus: vi.fn().mockResolvedValue({}) },
}));

// ─── Imports (SAU vi.mock) ─────────────────────────────────────────────────────
import { query } from '../../config/database.js';
import Portfolio from '../../models/Portfolio.js';
import * as portfolioController from '../../controllers/portfolio.controller.js';
import * as realOrderController from '../../controllers/portfolio/realOrder.controller.js';
import * as realPositionController from '../../controllers/portfolio/realPosition.controller.js';
import { getPortfolioSummary } from '../../controllers/portfolio/portfolioSummary.controller.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// Separate mock portfolio objects — independence giua user A va user B (BLOCKER 4)
const PORTFOLIO_USER_A = {
  id: 'portfolio-A',
  user_id: 'user-A',
  name: 'User A Portfolio',
  buy_fee_percent: 0.15,
  sell_fee_percent: 0.15,
  sell_tax_percent: 0.1,
};
const PORTFOLIO_USER_B = {
  id: 'portfolio-B',
  user_id: 'user-B',
  name: 'User B Portfolio',
  buy_fee_percent: 0.15,
  sell_fee_percent: 0.15,
  sell_tax_percent: 0.1,
};

function makeReqRes({ userId = 'user-A', params = {}, validatedBody = {}, body = {} } = {}) {
  const req = { user: { userId }, params, validatedBody, body, query: {} };
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return { req, res };
}

// ─── Tests ─────────────────────────────────────────────────────────────────────
describe('Cross-user ownership enforcement (MAP-07, D-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // BLOCKER 4 fix: KHONG set default mockResolvedValue cho Portfolio.findById.
    // Moi test explicit mockResolvedValueOnce.
    query.mockReset();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  // ─── Negative cases (5 endpoints) — must return 403 ──────────────────────────

  it('1. GET /api/portfolios/:id → 403 khi portfolio thuoc user khac', async () => {
    Portfolio.findById.mockResolvedValueOnce(PORTFOLIO_USER_B);

    const { req, res } = makeReqRes({
      userId: 'user-A',
      params: { id: 'portfolio-B' },
    });
    await portfolioController.getById(req, res, vi.fn());

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    // Khong leak du lieu portfolio trong body
    expect(res.body).not.toHaveProperty('data');
  });

  it('2. PUT /api/portfolios/:id → 403 khi update portfolio user khac', async () => {
    Portfolio.findById.mockResolvedValueOnce(PORTFOLIO_USER_B);

    const { req, res } = makeReqRes({
      userId: 'user-A',
      params: { id: 'portfolio-B' },
      validatedBody: { name: 'hacked', totalBalance: 999_000_000, maxRiskPercent: 2 },
    });
    await portfolioController.update(req, res, vi.fn());

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    // Dam bao Portfolio.update KHONG duoc goi
    expect(Portfolio.update).not.toHaveBeenCalled();
  });

  it('3. POST /:portfolioId/real-orders → 403 khi portfolio thuoc user khac', async () => {
    Portfolio.findById.mockResolvedValueOnce(PORTFOLIO_USER_B);

    const { req, res } = makeReqRes({
      userId: 'user-A',
      params: { portfolioId: 'portfolio-B' },
      validatedBody: {
        symbol: 'VNM',
        exchange: 'HOSE',
        side: 'BUY',
        quantity: 100,
        filled_price: 80000,
        filled_date: new Date().toISOString(),
        order_status: 'FILLED',
      },
    });
    await realOrderController.createRealOrder(req, res, vi.fn());

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('4. POST /:portfolioId/real-positions/:positionId/close → 403 khi portfolio thuoc user khac', async () => {
    Portfolio.findById.mockResolvedValueOnce(PORTFOLIO_USER_B);

    const { req, res } = makeReqRes({
      userId: 'user-A',
      params: { portfolioId: 'portfolio-B', positionId: 'pos-1' },
      validatedBody: {
        sell_price: 85000,
        sell_date: new Date().toISOString(),
      },
    });
    await realPositionController.closePosition(req, res, vi.fn());

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('5. GET /:portfolioId/real-summary → 403 khi portfolio thuoc user khac', async () => {
    Portfolio.findById.mockResolvedValueOnce(PORTFOLIO_USER_B);

    const { req, res } = makeReqRes({
      userId: 'user-A',
      params: { portfolioId: 'portfolio-B' },
    });
    await getPortfolioSummary(req, res, vi.fn());

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body).not.toHaveProperty('data');
  });

  // ─── 404 distinction ─────────────────────────────────────────────────────────
  it('404 distinction: portfolio khong ton tai → 404 (khong phai 403)', async () => {
    Portfolio.findById.mockResolvedValueOnce(null);

    const { req, res } = makeReqRes({
      userId: 'user-A',
      params: { id: 'non-existent' },
    });
    await portfolioController.getById(req, res, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it('404 distinction o summary endpoint: portfolio null → 404 (khong phai 403)', async () => {
    Portfolio.findById.mockResolvedValueOnce(null);

    const { req, res } = makeReqRes({
      userId: 'user-A',
      params: { portfolioId: 'non-existent' },
    });
    await getPortfolioSummary(req, res, vi.fn());

    expect(res.statusCode).toBe(404);
  });

  // ─── Positive control MUST PASS (D-04 LOCK) ──────────────────────────────────
  // Khong co escape hatch "co the giam assertion" — STRICT assertion.
  it('Positive control GET portfolio: owner access own portfolio → 200 success (D-04 MUST PASS)', async () => {
    Portfolio.findById.mockResolvedValueOnce(PORTFOLIO_USER_A);

    const { req, res } = makeReqRes({
      userId: 'user-A',
      params: { id: 'portfolio-A' },
    });
    await portfolioController.getById(req, res, vi.fn());

    // STRICT: status NOT 403, NOT 404. Expect 200 success, data present.
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data).toMatchObject({ id: 'portfolio-A', user_id: 'user-A' });
  });

  it('Positive control GET summary: owner access own portfolio → 200 success (D-04 MUST PASS)', async () => {
    Portfolio.findById.mockResolvedValueOnce(PORTFOLIO_USER_A);
    // Mock SQL queries cho path sau ownership check trong getPortfolioSummary:
    // 1. SELECT OPEN positions → empty
    // 2. SELECT CLOSED aggregate → zero
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    query.mockResolvedValueOnce({
      rows: [{ closed_count: '0', total_realized_pnl: '0' }],
      rowCount: 1,
    });

    const { req, res } = makeReqRes({
      userId: 'user-A',
      params: { portfolioId: 'portfolio-A' },
    });
    await getPortfolioSummary(req, res, vi.fn());

    // STRICT D-04 assertion: NOT 403 AND NOT 404 AND success=true.
    // KHONG relax xuong chi not.toBe(403).
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).toBe(200);
    expect(res.body?.success).toBe(true);
    expect(res.body?.data).toHaveProperty('total_realized_pnl');
    expect(res.body?.data).toHaveProperty('total_unrealized_pnl');
    expect(res.body?.data).toHaveProperty('cash_balance');
  });
});
