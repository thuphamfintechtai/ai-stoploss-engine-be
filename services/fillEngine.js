/**
 * Fill Engine — Backward compatibility re-export.
 *
 * Logic đã được di chuyển vào services/paper/fillEngine.js.
 * File này giữ nguyên để không break existing imports.
 *
 * @see services/paper/fillEngine.js
 */

export { fillOrderInstant, expireEndOfSessionOrders } from './paper/fillEngine.js';
export { default } from './paper/fillEngine.js';
