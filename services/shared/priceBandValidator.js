/**
 * Price Band Validator — Kiem tra va clamp gia trong bien do giao dong.
 *
 * Bien do giao dong:
 *   HOSE:  ±7%
 *   HNX:   ±10%
 *   UPCOM: ±15%
 *
 * Per D-06.
 */

import { snapToTickSize } from './tickSizeEngine.js';

const BAND_LIMITS = {
  HOSE: 0.07,
  HNX: 0.10,
  UPCOM: 0.15,
};

/**
 * Lay bien do gio giao dong cho san.
 * @param {string} exchange
 * @returns {number}
 */
function getBandLimit(exchange = 'HOSE') {
  return BAND_LIMITS[exchange] ?? BAND_LIMITS.HOSE;
}

/**
 * Tinh gia san (floor price) = refPrice * (1 - bandLimit).
 * @param {number} refPrice - Gia tham chieu (gia dong cua phien truoc)
 * @param {string} [exchange='HOSE']
 * @returns {number}
 */
export function getFloorPrice(refPrice, exchange = 'HOSE') {
  const bandLimit = getBandLimit(exchange);
  const floor = refPrice * (1 - bandLimit);
  return snapToTickSize(floor, exchange);
}

/**
 * Tinh gia tran (ceiling price) = refPrice * (1 + bandLimit).
 * @param {number} refPrice - Gia tham chieu
 * @param {string} [exchange='HOSE']
 * @returns {number}
 */
export function getCeilingPrice(refPrice, exchange = 'HOSE') {
  const bandLimit = getBandLimit(exchange);
  const ceiling = refPrice * (1 + bandLimit);
  return snapToTickSize(ceiling, exchange);
}

/**
 * Clamp gia vao khoang [floor, ceiling] va snap ve tick size hop le.
 * @param {number} price - Gia can kiem tra
 * @param {number} refPrice - Gia tham chieu
 * @param {string} [exchange='HOSE']
 * @returns {number} Gia da duoc clamp va snap
 */
export function clampToBand(price, refPrice, exchange = 'HOSE') {
  const floor = getFloorPrice(refPrice, exchange);
  const ceiling = getCeilingPrice(refPrice, exchange);

  const clamped = Math.max(floor, Math.min(ceiling, price));
  return snapToTickSize(clamped, exchange);
}
