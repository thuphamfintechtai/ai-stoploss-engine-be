/**
 * Stress Test Service — Tinh impact khi thi truong giam theo kich ban.
 *
 * Per D-10: 3 predefined scenarios: -10%, -15%, -20%
 * Per D-11: impact = position_value * beta * (scenario_drop / 100)
 * Per D-12: SECTOR_BETAS mapping
 * Per D-13: Custom scenario support
 *
 * KHONG import database — tat ca input la parameters.
 */

import { getSector } from './sectorClassification.js';

/**
 * Beta cua tung nganh theo thi truong VN.
 * Gia tri the hien muc do nhay cam voi bien dong thi truong chung.
 *
 * @type {Record<string, number>}
 */
export const SECTOR_BETAS = {
  BANKING: 1.2,
  REAL_ESTATE: 1.5,
  TECHNOLOGY: 0.8,
  STEEL: 1.3,
  SECURITIES: 1.4,
  ENERGY: 0.9,
  CONSUMER: 0.7,
  RETAIL: 0.8,
  OTHER: 1.0,
};

/**
 * Tinh stress test impact cho danh sach positions theo nhieu kich ban.
 *
 * @param {object} params
 * @param {Array<{symbol: string, entry_price: number, quantity: number}>} params.positions
 * @param {number[]} [params.scenarios=[-10,-15,-20]] - % giam cua thi truong (so am)
 * @param {number|null} [params.customScenario=null] - % giam tu chon (so am), e.g. -25
 * @returns {{
 *   scenarios: Array<{
 *     dropPercent: number,
 *     totalImpactVnd: number,
 *     totalImpactPercent: number,
 *     positions: Array<{
 *       symbol: string,
 *       sector: string,
 *       beta: number,
 *       positionValue: number,
 *       impactVnd: number,
 *       impactPercent: number
 *     }>
 *   }>
 * }}
 */
export function calculateStressTest({
  positions = [],
  scenarios = [-10, -15, -20],
  customScenario = null,
}) {
  // Ket hop scenarios
  const allScenarios = [...scenarios];
  if (customScenario !== null && customScenario !== undefined) {
    // Them custom scenario neu chua co trong list
    if (!allScenarios.includes(customScenario)) {
      allScenarios.push(customScenario);
    }
  }

  // Tinh tong gia tri portfolio
  const totalPortfolioValue = positions.reduce(
    (sum, p) => sum + p.entry_price * p.quantity,
    0
  );

  const scenarioResults = allScenarios.map(dropPercent => {
    // dropPercent la so am (e.g., -10 nghia la giam 10%)
    const absDropFraction = Math.abs(dropPercent) / 100;

    let totalImpactVnd = 0;
    const positionResults = [];

    for (const p of positions) {
      const positionValue = p.entry_price * p.quantity;
      const sector = getSector(p.symbol);
      const beta = SECTOR_BETAS[sector] ?? SECTOR_BETAS.OTHER;

      // impact = position_value * beta * absDropFraction
      const impactVnd = positionValue * beta * absDropFraction;
      const impactPercent = positionValue > 0 ? (impactVnd / positionValue) * 100 : 0;

      totalImpactVnd += impactVnd;

      positionResults.push({
        symbol: p.symbol,
        sector,
        beta,
        positionValue,
        impactVnd,
        impactPercent: parseFloat(impactPercent.toFixed(4)),
      });
    }

    const totalImpactPercent = totalPortfolioValue > 0
      ? (totalImpactVnd / totalPortfolioValue) * 100
      : 0;

    return {
      dropPercent,
      totalImpactVnd,
      totalImpactPercent: parseFloat(totalImpactPercent.toFixed(4)),
      positions: positionResults,
    };
  });

  return {
    scenarios: scenarioResults,
  };
}
