/**
 * Indicator Mocks — Helper tao mock indicators cho test.
 *
 * Mock shape khop voi indicatorCache entry shape.
 */

import { vi } from 'vitest';

/**
 * Tao mock indicators object.
 * @param {Object} [overrides]
 * @param {Object} [overrides.bb] - Override cho BollingerBands mock
 * @param {boolean} [overrides.bb.isStable]
 * @param {{ upper: number, lower: number, middle: number }} [overrides.bb.result]
 * @param {Object} [overrides.sma50] - Override cho SMA50 mock
 * @param {boolean} [overrides.sma50.isStable]
 * @param {number} [overrides.sma50.result]
 * @param {Object} [overrides.sma200] - Override cho SMA200 mock
 * @param {boolean} [overrides.sma200.isStable]
 * @param {number} [overrides.sma200.result]
 * @returns {{ bb: Object, sma50: Object, sma200: Object, atr: Object, lastUpdate: number, regime: null, regimeTimestamp: null }}
 */
export function createMockIndicators(overrides = {}) {
  const bbResult = overrides.bb?.result ?? { upper: 30000, lower: 25000, middle: 27500 };
  const sma50Result = overrides.sma50?.result ?? 27000;
  const sma200Result = overrides.sma200?.result ?? 26000;

  return {
    bb: {
      isStable: overrides.bb?.isStable ?? true,
      getResult: vi.fn(() => bbResult),
      update: vi.fn(),
    },
    sma50: {
      isStable: overrides.sma50?.isStable ?? true,
      getResult: vi.fn(() => sma50Result),
      update: vi.fn(),
    },
    sma200: {
      isStable: overrides.sma200?.isStable ?? true,
      getResult: vi.fn(() => sma200Result),
      update: vi.fn(),
    },
    atr: {
      isStable: true,
      getResult: vi.fn(() => 500),
      update: vi.fn(),
    },
    lastUpdate: Date.now(),
    regime: null,
    regimeTimestamp: null,
  };
}
