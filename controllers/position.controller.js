/**
 * Position Controller — Backward compatibility re-export.
 *
 * Logic đã được di chuyển vào controllers/paper/paperPosition.controller.js.
 * File này giữ nguyên để không break existing imports từ routes/position.routes.js.
 *
 * Pagination: handler `list` dùng Position.findByPortfolioPaginated khi query có ?page param.
 * Tat ca handlers deu co try-catch + next(error) — xem paperPosition.controller.js.
 *
 * @see controllers/paper/paperPosition.controller.js
 */

export {
  list,
  getById,
  create,
  update,
  close,
  calculate,
  // Schema exports (dùng bởi position.routes.js)
  createPositionSchema,
  calculatePositionSchema,
  updatePositionSchema,
  closePositionSchema,
  // Alias exports
  list as getByPortfolio,
  close as closePosition,
  update as updateStopLoss,
} from './paper/paperPosition.controller.js';
