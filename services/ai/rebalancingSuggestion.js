/**
 * Rebalancing Suggestion Service — Phan tich sector concentration va de xuat tai co cau.
 *
 * Per D-18: Canh bao khi 1 sector > 30% portfolio.
 * Per D-07: Gemini narrative voi fallback rule-based khi timeout 5s.
 */

import { getSector, SECTOR_LABELS } from './sectorClassification.js';
import { callGeminiJSON } from '../aiService.js';

const CONCENTRATION_THRESHOLD = 30; // %
const GEMINI_TIMEOUT_MS = 5000;

/**
 * Lay gia tri thi truong cua mot position.
 * Uu tien market_value, fallback entry_price * quantity.
 * @param {Object} position
 * @returns {number|null}
 */
function getPositionValue(position) {
  if (position.market_value != null && !isNaN(Number(position.market_value))) {
    const val = Number(position.market_value);
    return val > 0 ? val : null;
  }
  if (position.entry_price != null && position.quantity != null) {
    const val = Number(position.entry_price) * Number(position.quantity);
    return val > 0 ? val : null;
  }
  return null;
}

/**
 * Tao fallback narrative bang tieng Viet tu danh sach warnings.
 * @param {Array} warnings
 * @returns {string}
 */
function buildFallbackNarrative(warnings) {
  if (!warnings || warnings.length === 0) {
    return 'Portfolio hien tai co phan bo sector can doi, khong co sector nao vuot qua nguong 30%.';
  }

  const lines = warnings.map(w => {
    return `${w.sectorLabel} (${w.sector}) chiem ${w.percent.toFixed(1)}% portfolio — vuot qua nguong canh bao 30%. Xem xet giam ty trong nganh nay xuong duoi 30% bang cach chot loi mot phan co phieu hoac chuyen dich sang nganh khac.`;
  });

  return (
    'CANH BAO TAP TRUNG SECTOR:\n' +
    lines.join('\n') +
    '\n\nKhuyen nghi: Duy tri moi sector khong vuot qua 30% tong gia tri portfolio de giam thieu rui ro tap trung.'
  );
}

/**
 * Tao narrative tu Gemini voi timeout 5s, fallback rule-based neu qua han.
 * @param {Array} sectorBreakdown
 * @param {Array} warnings
 * @returns {Promise<string>}
 */
async function generateNarrative(sectorBreakdown, warnings) {
  const sectorSummary = sectorBreakdown
    .map(s => `${s.sectorLabel}: ${s.percent.toFixed(1)}% (${s.symbols.join(', ')})`)
    .join('; ');

  const warningSummary = warnings.length > 0
    ? warnings.map(w => `${w.sectorLabel} ${w.percent.toFixed(1)}%`).join(', ')
    : 'Khong co canh bao';

  const prompt = `Ban la chuyen gia quan ly danh muc co phieu Viet Nam. Phan tich su tap trung sector sau va dua ra khuyen nghi tai co cau.

Phan bo theo sector:
${sectorSummary}

Canh bao sector > 30%: ${warningSummary}

Hay tra ve JSON voi format: {"narrative": "Phan tich va khuyen nghi bang tieng Viet, 2-3 cau, ngan gon va thuc te."}`;

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Gemini timeout after 5s')), GEMINI_TIMEOUT_MS)
  );

  try {
    const result = await Promise.race([callGeminiJSON(prompt), timeoutPromise]);
    if (result && typeof result.narrative === 'string' && result.narrative.length > 0) {
      return { narrative: result.narrative, ai_source: 'gemini' };
    }
    return { narrative: buildFallbackNarrative(warnings), ai_source: 'rule-based' };
  } catch {
    return { narrative: buildFallbackNarrative(warnings), ai_source: 'rule-based' };
  }
}

/**
 * Phan tich sector concentration va de xuat tai co cau portfolio.
 *
 * @param {Array<Object>} positions - Mang positions, moi item co: symbol, market_value?, entry_price?, quantity?
 * @param {number} totalPortfolioValue - Tong gia tri portfolio (VND)
 * @returns {Promise<{sectorBreakdown: Array, warnings: Array, suggestions: Array, narrative: string}>}
 */
export async function generateRebalancingSuggestions(positions, totalPortfolioValue) {
  // Empty positions -> tra ve ket qua trong
  if (!positions || positions.length === 0) {
    return {
      sectorBreakdown: [],
      warnings: [],
      suggestions: [],
      narrative: 'Portfolio chua co vi the nao de phan tich.',
    };
  }

  // ── Buoc 1: Group positions by sector ──────────────────────────────────────

  const sectorMap = {}; // sector -> { totalValue, symbols[] }

  for (const pos of positions) {
    const value = getPositionValue(pos);
    if (value === null) continue; // skip positions khong co gia tri

    const sector = getSector(pos.symbol);

    if (!sectorMap[sector]) {
      sectorMap[sector] = { totalValue: 0, symbols: [] };
    }
    sectorMap[sector].totalValue += value;
    if (!sectorMap[sector].symbols.includes(pos.symbol)) {
      sectorMap[sector].symbols.push(pos.symbol);
    }
  }

  // ── Buoc 2: Tinh phan tram va tao sectorBreakdown ──────────────────────────

  const total = totalPortfolioValue > 0
    ? totalPortfolioValue
    : Object.values(sectorMap).reduce((sum, s) => sum + s.totalValue, 0);

  const sectorBreakdown = Object.entries(sectorMap)
    .map(([sector, data]) => ({
      sector,
      sectorLabel: SECTOR_LABELS[sector] || sector,
      totalValue: data.totalValue,
      percent: total > 0 ? (data.totalValue / total) * 100 : 0,
      symbols: data.symbols,
    }))
    .sort((a, b) => b.percent - a.percent); // Sort DESC

  // ── Buoc 3: Xac dinh warnings (sector > CONCENTRATION_THRESHOLD%) ──────────

  const warnings = sectorBreakdown
    .filter(s => s.percent > CONCENTRATION_THRESHOLD)
    .map(s => ({
      sector: s.sector,
      sectorLabel: s.sectorLabel,
      percent: s.percent,
      totalValue: s.totalValue,
      symbols: s.symbols,
    }));

  // ── Buoc 4: Tao rule-based suggestions ────────────────────────────────────

  const suggestions = warnings.map(w => {
    const symbolList = w.symbols.join(', ');
    return `Nganh ${w.sectorLabel} (${symbolList}) chiem ${w.percent.toFixed(1)}% portfolio (nguong canh bao: 30%). Xem xet giam ty trong xuong duoi 30% bang cach chot loi mot phan hoac chuyen sang nganh khac.`;
  });

  // ── Buoc 5: Gemini narrative voi fallback ─────────────────────────────────

  const narrativeResult = await generateNarrative(sectorBreakdown, warnings);

  return {
    sectorBreakdown,
    warnings,
    suggestions,
    narrative: narrativeResult.narrative ?? narrativeResult,
    ai_source: narrativeResult.ai_source ?? 'rule-based',
  };
}
