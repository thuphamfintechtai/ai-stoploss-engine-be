import express from 'express';
import { createOrder, listOrders, cancelOrder, createOrderSchema } from '../controllers/order.controller.js';
import { editOrder, editOrderSchema } from '../controllers/paper/paperOrder.controller.js';
import { validate } from '../middleware/validation.js';

// mergeParams: true để kế thừa :portfolioId từ parent router (portfolio.routes.js)
const router = express.Router({ mergeParams: true });

/**
 * POST /api/portfolios/:portfolioId/orders
 * Đặt lệnh mua/bán (LO/ATO/ATC/MP)
 */
router.post('/', validate(createOrderSchema), createOrder);

/**
 * GET /api/portfolios/:portfolioId/orders
 * Danh sách lệnh; query: ?status=PENDING,FILLED&limit=50
 */
router.get('/', listOrders);

/**
 * PATCH /api/portfolios/:portfolioId/orders/:id
 * Sửa lệnh PENDING (limit_price + quantity — per D-09)
 */
router.patch('/:id', validate(editOrderSchema), editOrder);

/**
 * DELETE /api/portfolios/:portfolioId/orders/:id
 * Hủy lệnh (chỉ PENDING hoặc PARTIALLY_FILLED)
 */
router.delete('/:id', cancelOrder);

export default router;
