/**
 * Tests: Paper Trading Backward Compatibility
 *
 * Verify rằng sau khi refactor, paper trading vẫn hoạt động đúng:
 * - Re-exports từ services/fillEngine.js import được
 * - Re-exports từ controllers/order.controller.js import được
 * - Re-exports từ controllers/position.controller.js import được
 * - fillEngine có context guard PAPER
 * - stopLossMonitor có context filter PAPER
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const beRoot = resolve(__dirname, '../..');

describe('Paper Trading Backward Compatibility', () => {
  it('fillEngine re-export works — checkAndFillOrders/fillOrderInstant là function', async () => {
    // Dynamic import services/fillEngine.js (re-export wrapper)
    const fillEngine = await import(`${beRoot}/services/fillEngine.js`);
    // fillOrderInstant là function được export
    expect(typeof fillEngine.fillOrderInstant).toBe('function');
    // expireEndOfSessionOrders cũng export được
    expect(typeof fillEngine.expireEndOfSessionOrders).toBe('function');
  });

  it('order controller re-export works — create, createOrderSchema export tồn tại', async () => {
    // Dynamic import controllers/order.controller.js (re-export wrapper)
    const orderCtrl = await import(`${beRoot}/controllers/order.controller.js`);
    // createOrderSchema là Joi schema (object với keys)
    expect(orderCtrl.createOrderSchema).toBeDefined();
    expect(typeof orderCtrl.createOrderSchema).toBe('object');
    // createOrder/create là function
    expect(typeof orderCtrl.createOrder).toBe('function');
    expect(typeof orderCtrl.create).toBe('function');
    // listOrders, cancelOrder cũng export được
    expect(typeof orderCtrl.listOrders).toBe('function');
    expect(typeof orderCtrl.cancelOrder).toBe('function');
  });

  it('position controller re-export works — getByPortfolio, closePosition, update export tồn tại', async () => {
    // Dynamic import controllers/position.controller.js (re-export wrapper)
    const posCtrl = await import(`${beRoot}/controllers/position.controller.js`);
    // list/getByPortfolio là function
    expect(typeof posCtrl.list).toBe('function');
    expect(typeof posCtrl.getByPortfolio).toBe('function');
    // close/closePosition là function
    expect(typeof posCtrl.close).toBe('function');
    expect(typeof posCtrl.closePosition).toBe('function');
    // update/updateStopLoss là function
    expect(typeof posCtrl.update).toBe('function');
    expect(typeof posCtrl.updateStopLoss).toBe('function');
    // create, getById, calculate cũng export được
    expect(typeof posCtrl.create).toBe('function');
    expect(typeof posCtrl.getById).toBe('function');
    expect(typeof posCtrl.calculate).toBe('function');
  });

  it('paper fillEngine source chứa context guard PAPER', () => {
    // Đọc source của services/paper/fillEngine.js
    const source = readFileSync(resolve(beRoot, 'services/paper/fillEngine.js'), 'utf8');
    // Verify context guard tồn tại
    expect(source).toContain("context = 'PAPER'");
    // Verify context check trong fillOrderInstant
    expect(source).toContain("order.context !== 'PAPER'");
    // Verify INSERT statement cũng có context = 'PAPER'
    expect(source).toContain("'PAPER'");
  });

  it('stopLossMonitor query có context = PAPER filter', () => {
    // Đọc source của workers/stopLossMonitor.js
    const source = readFileSync(resolve(beRoot, 'workers/stopLossMonitor.js'), 'utf8');
    // Verify query chính có context filter
    expect(source).toContain("context = 'PAPER'");
    // Verify có ít nhất 2 query với PAPER (positions + trailing HWM)
    const paperMatches = (source.match(/context = 'PAPER'/g) || []).length;
    expect(paperMatches).toBeGreaterThanOrEqual(2);
  });

  it('services/fillEngine.js là re-export (không chứa business logic)', () => {
    const source = readFileSync(resolve(beRoot, 'services/fillEngine.js'), 'utf8');
    // Verify re-export syntax
    expect(source).toContain("from './paper/fillEngine.js'");
    // Không chứa logic fill trực tiếp (không có function declarations)
    expect(source).not.toContain('async function fillOrderInstant');
  });

  it('controllers/order.controller.js là re-export (không chứa business logic)', () => {
    const source = readFileSync(resolve(beRoot, 'controllers/order.controller.js'), 'utf8');
    // Verify re-export syntax
    expect(source).toContain("from './paper/paperOrder.controller.js'");
    // Không chứa logic createOrder trực tiếp
    expect(source).not.toContain('async (req, res, next)');
  });
});
