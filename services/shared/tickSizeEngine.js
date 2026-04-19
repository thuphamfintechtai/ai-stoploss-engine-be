/**
 * tickSizeEngine (shared) — Backward-compat facade.
 *
 * Phase 2: logic đã di chuyển sang vnMarketRules.js (single source of truth).
 * File này giữ tên để consumer cũ (priceBandValidator.js, slippageCalculator.js, etc.)
 * không break.
 *
 * Re-exports với NEW shape (per vnMarketRules):
 *   - getTickSize, snapToTick, snapToTickSize (alias), isValidTick, isValidTickSize (alias)
 *   - getPriceBand → {floor, ceiling, pct, reference}
 *   - validatePriceInBand(price, exchange, ref) → {ok, reason?, floor?, ceiling?}
 *   - ERRORS (error message registry)
 *
 * Local:
 *   - isDerivativeSymbol — KHÔNG thuộc vnMarketRules (derivatives out-of-scope F0).
 *
 * NOTE: Level-1 facade `services/tickSizeEngine.js` adapt về LEGACY shape nếu consumer cũ
 * dùng signature `(price, ref, exchange)` hoặc field `.valid / .ceil / .band_pct`.
 */

export {
  getTickSize,
  snapToTick,
  snapToTickSize,     // alias of snapToTick(_, _, 'nearest')
  isValidTick,
  isValidTickSize,    // alias of isValidTick
  getLotSize,
  validateLotSize,
  getPriceBand,
  validatePriceInBand,
  getMarketSession,
  isMarketOpen,
  ERRORS,
} from './vnMarketRules.js';

// isDerivativeSymbol is NOT part of vnMarketRules (derivatives out-of-scope F0).
// Giữ implementation local để consumer cũ tiếp tục chạy.
export function isDerivativeSymbol(symbol) {
  return /^(VN30F|VN100F|VNXALLT)/i.test(symbol ?? '');
}

import vnMarketRulesDefault from './vnMarketRules.js';

export default {
  ...vnMarketRulesDefault,
  isDerivativeSymbol,
};
