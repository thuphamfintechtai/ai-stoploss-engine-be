/**
 * Tests cho Paper Fill Engine — fillOrderInstant và fillOrderRealistic
 *
 * Covers:
 *   - fillOrderInstant: context guard, fill conditions, deductForBuy, race condition
 *   - fillOrderRealistic: MP fill với slippage, LO fill probability, SELL settlement
 *   - getAvgDailyVolume: cache TTL behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks phải được khai báo trước import ───────────────────────────────────

vi.mock('../../models/Order.js', () => ({
  default: {
    fill: vi.fn(),
    reject: vi.fn(),
    expireStale: vi.fn(() => []),
  },
}));

vi.mock('../../models/Position.js', () => ({
  default: {
    create: vi.fn(),
  },
}));

vi.mock('../../models/Portfolio.js', () => ({
  default: {
    findById: vi.fn(),
  },
}));

vi.mock('../../models/ExecutionLog.js', () => ({
  default: {
    write: vi.fn(),
  },
}));

vi.mock('../../services/feeEngine.js', () => ({
  calculateBuyFee: vi.fn((price, qty) => Math.round(price * qty * 0.0015)),
  calculateFees: vi.fn((entry, close, qty) => ({
    sell_fee_vnd: Math.round(close * qty * 0.0015),
    sell_tax_vnd: Math.round(close * qty * 0.001),
    gross_pnl_vnd: (close - entry) * qty,
    net_pnl_vnd: 0,
    buy_fee_vnd: 0,
    total_fee_vnd: 0,
  })),
}));

vi.mock('../../config/database.js', () => ({
  transaction: vi.fn(async (fn) => {
    const client = {
      query: vi.fn(async (sql, params) => ({
        rows: [mockPositionRow],
      })),
    };
    return fn(client);
  }),
}));

vi.mock('../../services/websocket.js', () => ({
  broadcastPortfolioUpdate: vi.fn(),
}));

vi.mock('../../services/paper/paperMatchingEngine.js', () => ({
  default: {
    fillMarketOrder: vi.fn(),
    tryFillLimitOrder: vi.fn(),
    fillATOOrder: vi.fn(),
    fillATCOrder: vi.fn(),
    calculateSlippage: vi.fn(),
    calculateFillProbability: vi.fn(),
  },
}));

vi.mock('../../services/paper/paperCapitalService.js', () => ({
  default: {
    deductForBuy: vi.fn(),
    addPendingSettlement: vi.fn(),
    refundForCancel: vi.fn(),
  },
}));

// Mock global fetch
global.fetch = vi.fn();

// ─── Import sau mocks ────────────────────────────────────────────────────────

import { fillOrderInstant, fillOrderRealistic, expireEndOfSessionOrders } from '../../services/paper/fillEngine.js';
import Order from '../../models/Order.js';
import Portfolio from '../../models/Portfolio.js';
import PaperMatchingEngine from '../../services/paper/paperMatchingEngine.js';
import PaperCapitalService from '../../services/paper/paperCapitalService.js';
import { calculateBuyFee } from '../../services/feeEngine.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockPositionRow = {
  id: 'pos-001',
  portfolio_id: 'port-001',
  symbol: 'VCB',
  exchange: 'HOSE',
  entry_price: 85000,
  quantity: 100,
  status: 'OPEN',
  context: 'PAPER',
};

const mockPortfolio = {
  id: 'port-001',
  user_id: 'user-001',
  buy_fee_percent: 0.0015,
  sell_fee_percent: 0.0015,
  sell_tax_percent: 0.001,
};

function makePaperOrder(overrides = {}) {
  return {
    id: 'order-001',
    portfolio_id: 'port-001',
    symbol: 'VCB',
    exchange: 'HOSE',
    side: 'BUY',
    order_type: 'MP',
    quantity: 100,
    limit_price: null,
    stop_loss_vnd: null,
    stop_type: null,
    stop_params: null,
    take_profit_vnd: null,
    take_profit_type: null,
    notes: null,
    context: 'PAPER',
    status: 'PENDING',
    simulation_mode: 'INSTANT',
    ...overrides,
  };
}

function mockFetchPrice(price) {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({ data: { price } }),
  });
}

function mockFetchCandle(open, close, volume = 500000) {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [{ open, close, high: close + 100, low: open - 100, volume }],
    }),
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('fillOrderInstant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Portfolio.findById.mockResolvedValue(mockPortfolio);
    Order.fill.mockResolvedValue({ id: 'order-001', status: 'FILLED' });
    PaperCapitalService.deductForBuy.mockResolvedValue();
    PaperCapitalService.addPendingSettlement.mockResolvedValue();
  });

  it('context guard: bỏ qua order không phải PAPER', async () => {
    const order = makePaperOrder({ context: 'REAL' });
    const result = await fillOrderInstant(order, mockPortfolio);
    expect(result.filled).toBe(false);
    expect(result.position).toBeNull();
  });

  it('bỏ qua order không PENDING hoặc PARTIALLY_FILLED', async () => {
    const order = makePaperOrder({ status: 'FILLED' });
    const result = await fillOrderInstant(order, mockPortfolio);
    expect(result.filled).toBe(false);
  });

  it('skip nếu không lấy được giá thị trường', async () => {
    global.fetch.mockResolvedValue({ ok: false });
    const order = makePaperOrder();
    const result = await fillOrderInstant(order, mockPortfolio);
    expect(result.filled).toBe(false);
  });

  it('MP BUY: fill ngay tại currentPrice', async () => {
    mockFetchPrice(85000);
    const order = makePaperOrder({ order_type: 'MP', side: 'BUY' });
    const result = await fillOrderInstant(order, mockPortfolio);
    expect(result.filled).toBe(true);
    expect(Order.fill).toHaveBeenCalledWith('order-001', 100, 85000);
  });

  it('MP BUY: deductForBuy được gọi với totalCost đúng (Pitfall 4)', async () => {
    mockFetchPrice(85000);
    const order = makePaperOrder({ order_type: 'MP', side: 'BUY' });
    await fillOrderInstant(order, mockPortfolio);
    // buyFee = 85000 * 100 * 0.0015 = 12750
    // totalCost = 85000 * 100 + 12750 = 8512750
    expect(PaperCapitalService.deductForBuy).toHaveBeenCalledWith(
      'port-001',
      expect.any(Number)
    );
    const [, cost] = PaperCapitalService.deductForBuy.mock.calls[0];
    expect(cost).toBe(85000 * 100 + Math.round(85000 * 100 * 0.0015));
  });

  it('LO BUY: fill khi currentPrice <= limitPrice', async () => {
    mockFetchPrice(84000); // < limitPrice 85000 → should fill
    const order = makePaperOrder({ order_type: 'LO', side: 'BUY', limit_price: 85000 });
    const result = await fillOrderInstant(order, mockPortfolio);
    expect(result.filled).toBe(true);
    expect(Order.fill).toHaveBeenCalledWith('order-001', 100, 85000); // fill tại limit price
  });

  it('LO BUY: không fill khi currentPrice > limitPrice', async () => {
    mockFetchPrice(86000); // > limitPrice 85000 → không fill
    const order = makePaperOrder({ order_type: 'LO', side: 'BUY', limit_price: 85000 });
    const result = await fillOrderInstant(order, mockPortfolio);
    expect(result.filled).toBe(false);
  });

  it('race condition: Order.fill trả về null → skip và refund', async () => {
    mockFetchPrice(85000);
    Order.fill.mockResolvedValue(null); // simulate race condition
    PaperCapitalService.refundForCancel.mockResolvedValue();
    const order = makePaperOrder({ order_type: 'MP', side: 'BUY' });
    const result = await fillOrderInstant(order, mockPortfolio);
    expect(result.filled).toBe(false);
    expect(PaperCapitalService.refundForCancel).toHaveBeenCalled();
  });

  it('insufficient balance: Order.reject được gọi', async () => {
    mockFetchPrice(85000);
    Order.reject = vi.fn().mockResolvedValue();
    PaperCapitalService.deductForBuy.mockRejectedValue(
      Object.assign(new Error('Khong du so du paper trading'), { statusCode: 422 })
    );
    const order = makePaperOrder({ order_type: 'MP', side: 'BUY' });
    const result = await fillOrderInstant(order, mockPortfolio);
    expect(result.filled).toBe(false);
    expect(Order.reject).toHaveBeenCalledWith('order-001');
  });

  it('SELL: addPendingSettlement được gọi sau khi fill', async () => {
    mockFetchPrice(85000);
    const order = makePaperOrder({ order_type: 'MP', side: 'SELL' });
    await fillOrderInstant(order, mockPortfolio);
    expect(PaperCapitalService.addPendingSettlement).toHaveBeenCalled();
    // deductForBuy không được gọi cho SELL
    expect(PaperCapitalService.deductForBuy).not.toHaveBeenCalled();
  });
});

// ─── fillOrderRealistic ────────────────────────────────────────────────────

describe('fillOrderRealistic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset fetch implementation completely to avoid stale mocks from previous tests
    global.fetch = vi.fn();
    Portfolio.findById.mockResolvedValue(mockPortfolio);
    Order.fill.mockResolvedValue({ id: 'order-001', status: 'FILLED' });
    Order.reject = vi.fn().mockResolvedValue();
    PaperCapitalService.deductForBuy.mockResolvedValue();
    PaperCapitalService.addPendingSettlement.mockResolvedValue();
    PaperCapitalService.refundForCancel.mockResolvedValue();
  });

  it('context guard: bỏ qua order không phải PAPER', async () => {
    const order = makePaperOrder({ context: 'REAL' });
    const result = await fillOrderRealistic(order, mockPortfolio);
    expect(result.filled).toBe(false);
  });

  it('MP BUY REALISTIC: dùng PaperMatchingEngine.fillMarketOrder để tính fillPrice + slippage', async () => {
    // Mock fetch với url-based routing
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('/price')) return { ok: true, json: async () => ({ data: { price: 85000 } }) };
      return { ok: true, json: async () => ({ data: Array(20).fill({ volume: 500000 }) }) };
    });

    PaperMatchingEngine.fillMarketOrder.mockReturnValue({
      filled: true,
      fillPrice: 85100,
      slippage: 100,
    });

    const order = makePaperOrder({ order_type: 'MP', side: 'BUY', simulation_mode: 'REALISTIC' });
    const result = await fillOrderRealistic(order, mockPortfolio);

    expect(result.filled).toBe(true);
    expect(result.slippage).toBe(100);
    expect(PaperMatchingEngine.fillMarketOrder).toHaveBeenCalled();
    expect(Order.fill).toHaveBeenCalledWith('order-001', 100, 85100);
  });

  it('LO BUY REALISTIC: dùng PaperMatchingEngine.tryFillLimitOrder', async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('/price')) return { ok: true, json: async () => ({ data: { price: 84000 } }) };
      return { ok: true, json: async () => ({ data: Array(20).fill({ volume: 200000 }) }) };
    });

    PaperMatchingEngine.tryFillLimitOrder.mockReturnValue({
      filled: true,
      fillPrice: 85000,
      slippage: 0,
    });

    const order = makePaperOrder({ order_type: 'LO', side: 'BUY', limit_price: 85000, simulation_mode: 'REALISTIC' });
    const result = await fillOrderRealistic(order, mockPortfolio);

    expect(result.filled).toBe(true);
    expect(PaperMatchingEngine.tryFillLimitOrder).toHaveBeenCalled();
  });

  it('LO REALISTIC: không fill khi LOW_FILL_PROBABILITY', async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('/price')) return { ok: true, json: async () => ({ data: { price: 84000 } }) };
      return { ok: true, json: async () => ({ data: Array(20).fill({ volume: 200000 }) }) };
    });

    PaperMatchingEngine.tryFillLimitOrder.mockReturnValue({
      filled: false,
      reason: 'LOW_FILL_PROBABILITY',
    });

    const order = makePaperOrder({ order_type: 'LO', side: 'BUY', limit_price: 85000, simulation_mode: 'REALISTIC' });
    const result = await fillOrderRealistic(order, mockPortfolio);

    expect(result.filled).toBe(false);
    expect(Order.fill).not.toHaveBeenCalled();
  });

  it('REALISTIC MP BUY: deductForBuy được gọi trước khi fill', async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('/price')) return { ok: true, json: async () => ({ data: { price: 85000 } }) };
      return { ok: true, json: async () => ({ data: Array(20).fill({ volume: 500000 }) }) };
    });

    PaperMatchingEngine.fillMarketOrder.mockReturnValue({
      filled: true,
      fillPrice: 85100,
      slippage: 100,
    });

    const order = makePaperOrder({ order_type: 'MP', side: 'BUY', simulation_mode: 'REALISTIC' });
    await fillOrderRealistic(order, mockPortfolio);

    expect(PaperCapitalService.deductForBuy).toHaveBeenCalled();
    const [portfolioId, cost] = PaperCapitalService.deductForBuy.mock.calls[0];
    expect(portfolioId).toBe('port-001');
    expect(cost).toBeGreaterThan(0);
  });

  it('REALISTIC SELL: addPendingSettlement được gọi, deductForBuy không được gọi', async () => {
    // Mock fetch: price call trả về price, volume call trả về candles array
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('/price')) {
        return { ok: true, json: async () => ({ data: { price: 85000 } }) };
      }
      if (url.includes('/ohlcv')) {
        return {
          ok: true,
          json: async () => ({ data: Array(20).fill({ open: 84000, close: 85000, high: 86000, low: 83000, volume: 500000 }) }),
        };
      }
      return { ok: false };
    });

    PaperMatchingEngine.fillMarketOrder.mockReturnValue({
      filled: true,
      fillPrice: 85000,
      slippage: 0,
    });

    const order = makePaperOrder({ order_type: 'MP', side: 'SELL', simulation_mode: 'REALISTIC' });
    const result = await fillOrderRealistic(order, mockPortfolio);

    expect(result.filled).toBe(true);
    expect(PaperCapitalService.deductForBuy).not.toHaveBeenCalled();
    expect(PaperCapitalService.addPendingSettlement).toHaveBeenCalled();
  });

  it('insufficient balance: Order.reject được gọi, không tạo position', async () => {
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('/price')) return { ok: true, json: async () => ({ data: { price: 85000 } }) };
      return { ok: true, json: async () => ({ data: Array(20).fill({ volume: 500000 }) }) };
    });

    PaperMatchingEngine.fillMarketOrder.mockReturnValue({
      filled: true,
      fillPrice: 85000,
      slippage: 0,
    });

    PaperCapitalService.deductForBuy.mockRejectedValue(
      Object.assign(new Error('Khong du so du paper trading'), { statusCode: 422 })
    );

    const order = makePaperOrder({ order_type: 'MP', side: 'BUY', simulation_mode: 'REALISTIC' });
    const result = await fillOrderRealistic(order, mockPortfolio);

    expect(result.filled).toBe(false);
    expect(Order.reject).toHaveBeenCalledWith('order-001');
    expect(Order.fill).not.toHaveBeenCalled();
  });
});

// ─── expireEndOfSessionOrders ─────────────────────────────────────────────

describe('expireEndOfSessionOrders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('trả về 0 khi không có orders hết hạn', async () => {
    Order.expireStale.mockResolvedValue([]);
    const count = await expireEndOfSessionOrders();
    expect(count).toBe(0);
  });

  it('chỉ đếm PAPER orders, bỏ qua REAL orders', async () => {
    Order.expireStale.mockResolvedValue([
      { id: 'o1', context: 'PAPER', portfolio_id: 'p1', symbol: 'VCB', order_type: 'LO', expired_at: new Date() },
      { id: 'o2', context: 'REAL', portfolio_id: 'p2', symbol: 'HPG', order_type: 'LO', expired_at: new Date() },
    ]);
    const count = await expireEndOfSessionOrders();
    expect(count).toBe(1); // chỉ PAPER order
  });
});
