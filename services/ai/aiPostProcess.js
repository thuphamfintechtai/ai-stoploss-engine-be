/**
 * aiPostProcess — Snap AI-suggested prices về tick + clamp về biên độ ngày.
 *
 * Requirement: AIT-02 (snap tick + clamp band).
 * Threat mitigated: T-04-02 (Gemini hallucinate giá ngoài biên → broker reject / user lỗ).
 *
 * Contract:
 *   snapAndClampPrices(priceFields, { exchange, referencePrice })
 *     → { adjusted, clamped, original, meta }
 *
 *   snapAndClampReview(items, pricesByPosition)
 *     → Array<item & { _clamped, _original }>
 *
 * Chỉ process các field thuộc PRICE_FIELD_ALLOWLIST — tránh accidentally snap
 * field không phải giá (vd confidence_score).
 */

import {
  snapToTick,
  getPriceBand,
  validatePriceInBand,
} from '../shared/vnMarketRules.js';

/** Các field name được coi là price (VND) — allow-list cho safety. */
const PRICE_FIELD_ALLOWLIST = new Set([
  'entry_price',
  'stop_loss',
  'take_profit',
  'new_stop_loss',
  'new_take_profit',
  'current_price',
]);

/**
 * Snap 1 giá về tick + clamp về band nếu out-of-range.
 *
 * @param {number} rawValue     - Giá AI đề xuất
 * @param {string} exchange     - HOSE | HNX | UPCOM
 * @param {number|null} referencePrice - Giá tham chiếu để tính band (null = skip band)
 * @returns {{final: number, wasClamped: boolean}}
 */
function _snapClampOne(rawValue, exchange, referencePrice) {
  // Step 1: snap về tick nearest
  const snapped = snapToTick(rawValue, exchange, 'nearest');

  // Step 2: band check (skip nếu không có reference)
  if (!referencePrice || referencePrice <= 0) {
    return { final: snapped, wasClamped: false };
  }

  const band = validatePriceInBand(snapped, exchange, referencePrice);
  if (band.ok) {
    return { final: snapped, wasClamped: false };
  }

  // Step 3: clamp về floor/ceiling + snap đúng direction để không vượt band raw
  const { floor, ceiling } = getPriceBand(referencePrice, exchange);
  if (snapped < floor) {
    return { final: snapToTick(floor, exchange, 'up'), wasClamped: true };
  }
  // snapped > ceiling
  return { final: snapToTick(ceiling, exchange, 'down'), wasClamped: true };
}

/**
 * Snap + clamp các field giá trong 1 object.
 *
 * @param {object} priceFields
 * @param {object} [options]
 * @param {string} [options.exchange='HOSE']
 * @param {number|null} [options.referencePrice=null]
 * @returns {{adjusted: object, clamped: object, original: object, meta: object}}
 */
export function snapAndClampPrices(priceFields = {}, options = {}) {
  const exchange = options.exchange || 'HOSE';
  const referencePrice = options.referencePrice ?? null;

  const adjusted = {};
  const clamped = {};
  const original = {};

  for (const [field, rawValue] of Object.entries(priceFields || {})) {
    if (!PRICE_FIELD_ALLOWLIST.has(field)) continue;
    if (rawValue == null) continue; // skip null/undefined
    if (typeof rawValue !== 'number') continue;
    if (!Number.isFinite(rawValue) || rawValue <= 0) continue;

    const { final, wasClamped } = _snapClampOne(rawValue, exchange, referencePrice);
    adjusted[field] = final;
    if (wasClamped) {
      clamped[field] = true;
      original[field] = rawValue;
    }
  }

  const band =
    referencePrice && referencePrice > 0 ? getPriceBand(referencePrice, exchange) : null;

  return {
    adjusted,
    clamped,
    original,
    meta: {
      exchange,
      reference_price: referencePrice,
      band,
    },
  };
}

/**
 * Áp snap + clamp cho mảng kết quả reviewOpenPositions.
 * Mỗi item có `new_stop_loss` / `new_take_profit` được snap/clamp theo price map.
 *
 * @param {Array<object>} items
 * @param {Record<string, {entry_price: number, exchange: string}>} pricesByPosition
 * @returns {Array<object>}  Bản sao items với _clamped/_original metadata
 */
export function snapAndClampReview(items = [], pricesByPosition = {}) {
  if (!Array.isArray(items)) return [];

  return items.map(item => {
    if (!item || typeof item !== 'object') return item;
    const priceInfo = pricesByPosition[item.position_id] || {};
    const exchange = priceInfo.exchange || 'HOSE';
    const referencePrice = priceInfo.entry_price || null;

    const subject = {
      new_stop_loss: item.new_stop_loss,
      new_take_profit: item.new_take_profit,
    };

    const { adjusted, clamped, original } = snapAndClampPrices(subject, {
      exchange,
      referencePrice,
    });

    return {
      ...item,
      ...(adjusted.new_stop_loss !== undefined && { new_stop_loss: adjusted.new_stop_loss }),
      ...(adjusted.new_take_profit !== undefined && {
        new_take_profit: adjusted.new_take_profit,
      }),
      _clamped: clamped,
      _original: original,
    };
  });
}

export default {
  snapAndClampPrices,
  snapAndClampReview,
  PRICE_FIELD_ALLOWLIST,
};
