/**
 * tickSizeEngine (root-level facade) — Legacy shape adapter.
 *
 * Phase 2: Inner logic đã di chuyển sang shared/vnMarketRules.js với NEW shape:
 *   - validatePriceInBand(price, EXCHANGE, ref) → {ok, ceiling, floor, reason?}
 *   - getPriceBand → {ceiling, pct, floor, reference}
 *
 * File này adapt về OLD shape (consumer cũ gọi với signature `(price, ref, exchange)`):
 *   - validatePriceInBand(price, ref, exchange) → {valid, ceil, floor, warning?}
 *   - getPriceBand → {ceil, band_pct, floor, reference}
 *
 * Consumer audit (Phase 2 Task 3.A/3.B): NO_CONSUMER phát hiện ngoài chuỗi facade.
 * Adapter giữ lại làm safety net phòng regex miss + future consumer migration.
 *
 * @deprecated Migrate sang `services/shared/vnMarketRules.js` với new shape.
 */

import {
  getTickSize,
  snapToTickSize,
  isValidTickSize,
  getPriceBand as newGetPriceBand,
  validatePriceInBand as newValidatePriceInBand,
  isDerivativeSymbol,
} from './shared/tickSizeEngine.js';

export { getTickSize, snapToTickSize, isValidTickSize, isDerivativeSymbol };

/**
 * LEGACY shape adapter — giữ signature cũ `(priceVnd, referenceVnd, exchange)`
 * và shape `{valid, ceil, band_pct, warning}`.
 *
 * @deprecated — migrate sang vnMarketRules.validatePriceInBand(price, exchange, ref) → {ok, ceiling, reason}
 * @param {number} priceVnd
 * @param {number} referenceVnd
 * @param {string} [exchange='HOSE']
 * @returns {{valid: boolean, ceil?: number, floor?: number, warning?: string}}
 */
export function validatePriceInBand(priceVnd, referenceVnd, exchange = 'HOSE') {
  const r = newValidatePriceInBand(priceVnd, exchange, referenceVnd);
  return {
    valid:   r.ok,
    ceil:    r.ceiling,
    floor:   r.floor,
    warning: r.reason,
  };
}

/**
 * LEGACY shape: `{ floor, ceil, band_pct, reference }`.
 *
 * @deprecated — migrate sang vnMarketRules.getPriceBand(ref, exchange) → {ceiling, pct, floor, reference}
 * @param {number} referenceVnd
 * @param {string} [exchange='HOSE']
 * @returns {{floor: number, ceil: number, band_pct: number, reference: number}}
 */
export function getPriceBand(referenceVnd, exchange = 'HOSE') {
  const b = newGetPriceBand(referenceVnd, exchange);
  return {
    floor:     b.floor,
    ceil:      b.ceiling,
    band_pct:  b.pct,
    reference: b.reference,
  };
}

export default {
  getTickSize, snapToTickSize, isValidTickSize,
  getPriceBand, validatePriceInBand,
  isDerivativeSymbol,
};
