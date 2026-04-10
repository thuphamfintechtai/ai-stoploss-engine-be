/**
 * Tests: Paper Order Management — editOrder + cancelOrder refund
 *
 * Verify:
 * - editOrder: PATCH với valid limit_price -> 200
 * - editOrder: PATCH với valid quantity -> 200
 * - editOrder: PATCH với quantity > current AND không đủ virtual balance -> 422
 * - editOrder: PATCH lệnh không PENDING -> 409
 * - editOrder: PATCH với side field -> 400 (không cho sửa side)
 * - editOrder: PATCH với symbol field -> 400 (không cho sửa symbol)
 * - editOrder: limit_price auto-snapped to tick size
 * - cancelOrder: refund virtual balance sau khi cancel thành công
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const beRoot = resolve(__dirname, '../..');

// ─── Mocks — dùng factory function pattern vì vi.mock bị hoisted ─────────────

vi.mock('../../config/database.js', () => ({
  query: vi.fn(),
  transaction: vi.fn((fn) => fn({ query: vi.fn() })),
}));

vi.mock('../../models/Portfolio.js', () => ({
  default: {
    findById: vi.fn(),
  },
}));

vi.mock('../../models/Order.js', () => ({
  default: {
    findById: vi.fn(),
    cancel: vi.fn(),
    create: vi.fn(),
    findByPortfolio: vi.fn(),
  },
}));

vi.mock('../../models/ExecutionLog.js', () => ({
  default: {
    write: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/paper/paperCapitalService.js', () => ({
  default: {
    getVirtualBalance: vi.fn(),
    deductForBuy: vi.fn().mockResolvedValue(undefined),
    refundForCancel: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../services/shared/tickSizeEngine.js', () => ({
  snapToTickSize: vi.fn((price, _exchange) => {
    const tick = price < 10000 ? 10 : price < 50000 ? 50 : 100;
    return Math.round(price / tick) * tick;
  }),
  validatePriceInBand: vi.fn().mockReturnValue({ valid: true }),
  isValidTickSize: vi.fn().mockReturnValue(true),
  isDerivativeSymbol: vi.fn().mockReturnValue(false),
  default: {
    snapToTickSize: vi.fn((price) => price),
    validatePriceInBand: vi.fn().mockReturnValue({ valid: true }),
    isDerivativeSymbol: vi.fn().mockReturnValue(false),
  },
}));

vi.mock('../../services/riskCalculator.js', () => ({
  default: {
    calculatePositionRisk: vi.fn().mockReturnValue({ riskVND: 100000 }),
    validatePositionAgainstRisk: vi.fn().mockResolvedValue({ allowed: true }),
  },
}));

vi.mock('../../services/stopLossResolver.js', () => ({
  default: {
    resolveStopLoss: vi.fn().mockReturnValue({ stopLoss: null, error: null }),
    resolveTakeProfit: vi.fn().mockReturnValue({ takeProfit: null, error: null }),
  },
}));

vi.mock('../../services/marketPriceService.js', () => ({
  getMarketData: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../services/paper/fillEngine.js', () => ({
  fillOrderInstant: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../services/portfolio/capitalService.js', () => ({
  addBusinessDays: vi.fn((date, days) => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }),
}));

// ─── Helper: tạo mock req/res ─────────────────────────────────────────────

function mockReqRes({ params = {}, body = {}, user = { userId: 'user-1' } } = {}) {
  const req = {
    params: { portfolioId: 'portfolio-1', ...params },
    body,
    validatedBody: body,
    user,
  };
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();
  return { req, res, next };
}

// ─── Tests: editOrderSchema ────────────────────────────────────────────────

describe('editOrderSchema — Joi validation', () => {
  let editOrderSchema;

  beforeEach(async () => {
    vi.clearAllMocks();
    const ctrlModule = await import('../../controllers/paper/paperOrder.controller.js');
    editOrderSchema = ctrlModule.editOrderSchema;
  });

  it('editOrderSchema được export từ controller', async () => {
    expect(editOrderSchema).toBeDefined();
    expect(typeof editOrderSchema.validate).toBe('function');
  });

  it('body rỗng → lỗi (ít nhất 1 field bắt buộc)', () => {
    const { error } = editOrderSchema.validate({});
    expect(error).toBeDefined();
  });

  it('chỉ limit_price → hợp lệ', () => {
    const { error, value } = editOrderSchema.validate({ limit_price: 25000 });
    expect(error).toBeUndefined();
    expect(value.limit_price).toBe(25000);
  });

  it('chỉ quantity (>= 100) → hợp lệ', () => {
    const { error } = editOrderSchema.validate({ quantity: 100 });
    expect(error).toBeUndefined();
  });

  it('quantity < 100 → lỗi lot size', () => {
    const { error } = editOrderSchema.validate({ quantity: 50 });
    expect(error).toBeDefined();
  });

  it('side field → 400 (không cho sửa side)', () => {
    const { error } = editOrderSchema.validate({ side: 'SELL' });
    expect(error).toBeDefined();
  });

  it('symbol field → 400 (không cho sửa symbol)', () => {
    const { error } = editOrderSchema.validate({ symbol: 'VHM' });
    expect(error).toBeDefined();
  });

  it('limit_price âm → lỗi', () => {
    const { error } = editOrderSchema.validate({ limit_price: -1000 });
    expect(error).toBeDefined();
  });
});

// ─── Tests: editOrder controller ─────────────────────────────────────────

describe('editOrder — controller logic', () => {
  let Portfolio, Order, PaperCapitalService, editOrder, database;

  beforeEach(async () => {
    vi.clearAllMocks();

    const portModule = await import('../../models/Portfolio.js');
    Portfolio = portModule.default;

    const orderModule = await import('../../models/Order.js');
    Order = orderModule.default;

    const capitalModule = await import('../../services/paper/paperCapitalService.js');
    PaperCapitalService = capitalModule.default;

    const dbModule = await import('../../config/database.js');
    database = dbModule;

    const ctrlModule = await import('../../controllers/paper/paperOrder.controller.js');
    editOrder = ctrlModule.editOrder;
  });

  it('editOrder function tồn tại và được export', async () => {
    expect(typeof editOrder).toBe('function');
  });

  it('PATCH với valid limit_price → 200, order updated', async () => {
    const { req, res, next } = mockReqRes({
      params: { portfolioId: 'portfolio-1', id: 'order-1' },
      body: { limit_price: 25000 },
    });

    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
    Order.findById.mockResolvedValue({
      id: 'order-1',
      portfolio_id: 'portfolio-1',
      status: 'PENDING',
      context: 'PAPER',
      side: 'BUY',
      symbol: 'VIC',
      exchange: 'HOSE',
      limit_price: 24000,
      quantity: 200,
      simulation_mode: 'REALISTIC',
    });

    database.query.mockResolvedValue({
      rows: [{
        id: 'order-1',
        portfolio_id: 'portfolio-1',
        status: 'PENDING',
        limit_price: 25000,
        quantity: 200,
      }],
    });

    await editOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('PATCH với valid quantity (giảm) → 200 và refund balance', async () => {
    const { req, res, next } = mockReqRes({
      params: { portfolioId: 'portfolio-1', id: 'order-1' },
      body: { quantity: 100 },
    });

    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
    Order.findById.mockResolvedValue({
      id: 'order-1',
      portfolio_id: 'portfolio-1',
      status: 'PENDING',
      context: 'PAPER',
      side: 'BUY',
      symbol: 'VIC',
      exchange: 'HOSE',
      limit_price: 25000,
      quantity: 200,
      simulation_mode: 'REALISTIC',
    });

    database.query.mockResolvedValue({
      rows: [{
        id: 'order-1',
        portfolio_id: 'portfolio-1',
        status: 'PENDING',
        limit_price: 25000,
        quantity: 100,
      }],
    });

    await editOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    // Giảm quantity → refund delta
    expect(PaperCapitalService.refundForCancel).toHaveBeenCalled();
  });

  it('PATCH với quantity tăng và không đủ balance → 422', async () => {
    const { req, res, next } = mockReqRes({
      params: { portfolioId: 'portfolio-1', id: 'order-1' },
      body: { quantity: 500 },
    });

    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
    Order.findById.mockResolvedValue({
      id: 'order-1',
      portfolio_id: 'portfolio-1',
      status: 'PENDING',
      context: 'PAPER',
      side: 'BUY',
      symbol: 'VIC',
      exchange: 'HOSE',
      limit_price: 25000,
      quantity: 200,
      simulation_mode: 'REALISTIC',
    });

    // Balance không đủ — chỉ 100k, cần (500-200)*25000 = 7.5M
    PaperCapitalService.getVirtualBalance.mockResolvedValue({
      paper_available_cash: 100000,
    });

    await editOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'INSUFFICIENT_BALANCE' })
    );
  });

  it('PATCH lệnh không PENDING → 409', async () => {
    const { req, res, next } = mockReqRes({
      params: { portfolioId: 'portfolio-1', id: 'order-1' },
      body: { limit_price: 25000 },
    });

    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
    Order.findById.mockResolvedValue({
      id: 'order-1',
      portfolio_id: 'portfolio-1',
      status: 'FILLED',
      context: 'PAPER',
      side: 'BUY',
      symbol: 'VIC',
      exchange: 'HOSE',
      limit_price: 24000,
      quantity: 200,
    });

    await editOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'ORDER_NOT_PENDING' })
    );
  });

  it('PATCH tới lệnh không tồn tại → 404', async () => {
    const { req, res, next } = mockReqRes({
      params: { portfolioId: 'portfolio-1', id: 'non-existent' },
      body: { limit_price: 25000 },
    });

    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
    Order.findById.mockResolvedValue(null);

    await editOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('limit_price auto-snapped: giá 25033 → snapped về bội số 50', async () => {
    const { req, res, next } = mockReqRes({
      params: { portfolioId: 'portfolio-1', id: 'order-1' },
      body: { limit_price: 25033 }, // không đúng tick (bước 50 cho giá 10k-50k)
    });

    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
    Order.findById.mockResolvedValue({
      id: 'order-1',
      portfolio_id: 'portfolio-1',
      status: 'PENDING',
      context: 'PAPER',
      side: 'BUY',
      symbol: 'VIC',
      exchange: 'HOSE',
      limit_price: 25000,
      quantity: 200,
      simulation_mode: 'REALISTIC',
    });

    database.query.mockResolvedValue({
      rows: [{
        id: 'order-1',
        status: 'PENDING',
        limit_price: 25050, // snapped
        quantity: 200,
      }],
    });

    await editOrder(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    // snapToTickSize được gọi với giá không đúng tick
    const { snapToTickSize } = await import('../../services/shared/tickSizeEngine.js');
    expect(snapToTickSize).toHaveBeenCalledWith(25033, 'HOSE');
  });
});

// ─── Tests: cancelOrder với refund ────────────────────────────────────────

describe('cancelOrder — với refund virtual balance', () => {
  let Portfolio, Order, PaperCapitalService, cancelOrder;

  beforeEach(async () => {
    vi.clearAllMocks();

    const portModule = await import('../../models/Portfolio.js');
    Portfolio = portModule.default;

    const orderModule = await import('../../models/Order.js');
    Order = orderModule.default;

    const capitalModule = await import('../../services/paper/paperCapitalService.js');
    PaperCapitalService = capitalModule.default;

    const ctrlModule = await import('../../controllers/paper/paperOrder.controller.js');
    cancelOrder = ctrlModule.cancelOrder;
  });

  it('cancelOrder với REALISTIC BUY PENDING → refund virtual balance', async () => {
    const { req, res, next } = mockReqRes({
      params: { portfolioId: 'portfolio-1', id: 'order-1' },
      body: {},
    });

    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
    Order.findById.mockResolvedValue({
      id: 'order-1',
      portfolio_id: 'portfolio-1',
      status: 'PENDING',
      context: 'PAPER',
      side: 'BUY',
      symbol: 'VIC',
      exchange: 'HOSE',
      limit_price: 25000,
      quantity: 200,
      simulation_mode: 'REALISTIC',
    });
    Order.cancel.mockResolvedValue({
      id: 'order-1',
      status: 'CANCELLED',
    });

    await cancelOrder(req, res, next);

    expect(Order.cancel).toHaveBeenCalledWith('order-1');
    // REALISTIC BUY PENDING → refund
    expect(PaperCapitalService.refundForCancel).toHaveBeenCalledWith(
      'portfolio-1',
      expect.any(Number)
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true })
    );
  });

  it('cancelOrder với INSTANT mode → KHÔNG refund', async () => {
    const { req, res, next } = mockReqRes({
      params: { portfolioId: 'portfolio-1', id: 'order-2' },
      body: {},
    });

    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
    Order.findById.mockResolvedValue({
      id: 'order-2',
      portfolio_id: 'portfolio-1',
      status: 'PENDING',
      context: 'PAPER',
      side: 'BUY',
      symbol: 'VIC',
      exchange: 'HOSE',
      limit_price: 25000,
      quantity: 200,
      simulation_mode: 'INSTANT',
    });
    Order.cancel.mockResolvedValue({
      id: 'order-2',
      status: 'CANCELLED',
    });

    await cancelOrder(req, res, next);

    expect(Order.cancel).toHaveBeenCalledWith('order-2');
    // INSTANT mode → không refund (không deduct khi tạo)
    expect(PaperCapitalService.refundForCancel).not.toHaveBeenCalled();
  });

  it('cancelOrder SELL order → KHÔNG refund (không deduct cash cho SELL)', async () => {
    const { req, res, next } = mockReqRes({
      params: { portfolioId: 'portfolio-1', id: 'order-3' },
      body: {},
    });

    Portfolio.findById.mockResolvedValue({ id: 'portfolio-1', user_id: 'user-1' });
    Order.findById.mockResolvedValue({
      id: 'order-3',
      portfolio_id: 'portfolio-1',
      status: 'PENDING',
      context: 'PAPER',
      side: 'SELL',
      symbol: 'VIC',
      exchange: 'HOSE',
      limit_price: 25000,
      quantity: 200,
      simulation_mode: 'REALISTIC',
    });
    Order.cancel.mockResolvedValue({
      id: 'order-3',
      status: 'CANCELLED',
    });

    await cancelOrder(req, res, next);

    expect(Order.cancel).toHaveBeenCalledWith('order-3');
    // SELL order → không refund
    expect(PaperCapitalService.refundForCancel).not.toHaveBeenCalled();
  });
});

// ─── Tests: Source code checks ────────────────────────────────────────────

describe('Source code checks', () => {
  it('paperOrder.controller.js export editOrder và editOrderSchema', () => {
    const source = readFileSync(
      resolve(beRoot, 'controllers/paper/paperOrder.controller.js'),
      'utf8'
    );
    expect(source).toContain('editOrder');
    expect(source).toContain('editOrderSchema');
  });

  it('paperOrder.controller.js chứa refundForCancel', () => {
    const source = readFileSync(
      resolve(beRoot, 'controllers/paper/paperOrder.controller.js'),
      'utf8'
    );
    expect(source).toContain('refundForCancel');
  });

  it('paperOrder.controller.js chứa ORDER_MODIFIED event', () => {
    const source = readFileSync(
      resolve(beRoot, 'controllers/paper/paperOrder.controller.js'),
      'utf8'
    );
    expect(source).toContain('ORDER_MODIFIED');
  });

  it('orders.routes.js chứa router.patch', () => {
    const source = readFileSync(
      resolve(beRoot, 'routes/orders.routes.js'),
      'utf8'
    );
    expect(source).toContain('router.patch');
  });
});
