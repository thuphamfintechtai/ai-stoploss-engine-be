/**
 * Order Controller — Backward compatibility re-export.
 *
 * Logic đã được di chuyển vào controllers/paper/paperOrder.controller.js.
 * File này giữ nguyên để không break existing imports từ routes/orders.routes.js.
 *
 * @see controllers/paper/paperOrder.controller.js
 */

export {
  createOrder,
  createOrder as create,
  createOrderSchema,
  listOrders,
  listOrders as getByPortfolio,
  cancelOrder,
} from './paper/paperOrder.controller.js';
