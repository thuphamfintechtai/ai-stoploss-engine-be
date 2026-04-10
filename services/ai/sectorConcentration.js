/**
 * Sector Concentration Analysis Service — Value-based sector breakdown.
 *
 * Per D-14: Reuse getSector() + SECTOR_LABELS tu sectorClassification.js
 * Per D-15: > 40% = RED, > 30% = YELLOW, otherwise GREEN
 * Per D-16: Output tuong thich voi pie chart
 *
 * NOTE: Value-based concentration (entry_price * qty), KHAC voi risk-based concentration
 * trong capitalAllocation.calculateRiskBudget (entry - sl) * qty.
 *
 * KHONG import database — tat ca input la parameters.
 */

import { getSector, SECTOR_LABELS } from './sectorClassification.js';

/**
 * Tinh sector concentration theo gia tri (value-based).
 *
 * @param {object} params
 * @param {Array<{symbol: string, entry_price: number, quantity: number}>} params.positions
 * @returns {{
 *   sectors: Array<{
 *     sector: string,
 *     sectorLabel: string,
 *     totalValueVnd: number,
 *     percent: number,
 *     warningLevel: 'RED' | 'YELLOW' | 'GREEN'
 *   }>,
 *   warnings: string[],
 *   totalPortfolioValue: number
 * }}
 */
export function calculateSectorConcentration({ positions = [] }) {
  // Portfolio trong
  if (!positions || positions.length === 0) {
    return {
      sectors: [],
      warnings: [],
      totalPortfolioValue: 0,
    };
  }

  // Tinh tong gia tri portfolio
  const totalPortfolioValue = positions.reduce(
    (sum, p) => sum + p.entry_price * p.quantity,
    0
  );

  // Group positions by sector, sum value
  const sectorMap = {};

  for (const p of positions) {
    const sector = getSector(p.symbol);
    const value = p.entry_price * p.quantity;

    if (!sectorMap[sector]) {
      sectorMap[sector] = 0;
    }
    sectorMap[sector] += value;
  }

  // Build sector results
  const sectorResults = Object.entries(sectorMap).map(([sector, totalValueVnd]) => {
    const percent = totalPortfolioValue > 0
      ? (totalValueVnd / totalPortfolioValue) * 100
      : 0;

    // Xac dinh muc canh bao
    let warningLevel;
    if (percent > 40) {
      warningLevel = 'RED';
    } else if (percent > 30) {
      warningLevel = 'YELLOW';
    } else {
      warningLevel = 'GREEN';
    }

    const sectorLabel = SECTOR_LABELS[sector] ?? sector;

    return {
      sector,
      sectorLabel,
      totalValueVnd,
      percent: parseFloat(percent.toFixed(4)),
      warningLevel,
    };
  });

  // Sort theo percent giam dan
  sectorResults.sort((a, b) => b.percent - a.percent);

  // Build warnings
  const warnings = [];

  for (const s of sectorResults) {
    if (s.warningLevel === 'RED') {
      warnings.push(
        `Ngành ${s.sectorLabel} chiếm ${s.percent.toFixed(1)}% portfolio — qua tap trung, can giam`
      );
    } else if (s.warningLevel === 'YELLOW') {
      warnings.push(
        `Ngành ${s.sectorLabel} chiếm ${s.percent.toFixed(1)}% portfolio — can theo doi`
      );
    }
  }

  return {
    sectors: sectorResults,
    warnings,
    totalPortfolioValue,
  };
}
