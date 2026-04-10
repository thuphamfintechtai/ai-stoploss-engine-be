/**
 * Capital Allocation Service — Half-Kelly position sizing + risk budget calculation.
 *
 * Per D-15: Half-Kelly formula: f* = (p*b - q) / b * 0.5, cap at 25%, floor at 0.
 * Per D-16: getTradeStats query closed positions per context (REAL/PAPER).
 *
 * Warning khi < 10 closed trades.
 */
import { query } from '../../config/database.js';
import { getSector } from './sectorClassification.js';

/**
 * Tinh half-Kelly fraction cho position sizing.
 *
 * @param {number} winRate - Ti le thang (0-1)
 * @param {number} avgWinLoss - Ty so loi trung binh / lo trung binh (avg_win / avg_loss)
 * @returns {{ kelly_fraction: number, half_kelly: number, recommended_percent: number, interpretation: string }}
 */
export function calculateHalfKelly(winRate, avgWinLoss) {
  // Clamp inputs
  const p = Math.max(0, Math.min(1, winRate));
  const q = 1 - p;
  const b = Math.max(0.01, avgWinLoss);

  // Kelly criterion: f = (p*b - q) / b
  const kelly = (p * b - q) / b;

  // Half-Kelly: max(0, kelly * 0.5) — per D-15
  const halfKelly = Math.max(0, kelly * 0.5);

  // Cap at 25% to limit over-leverage
  const recommendedPercent = Math.min(halfKelly * 100, 25);

  let interpretation;
  if (kelly <= 0) {
    interpretation = `Negative expectancy — khong nen tang vi the. Kelly = ${(kelly * 100).toFixed(1)}%.`;
  } else {
    interpretation = `Nen dau tu ${recommendedPercent.toFixed(1)}% von vao vi the nay (Half-Kelly = ${(halfKelly * 100).toFixed(1)}%, Kelly = ${(kelly * 100).toFixed(1)}%).`;
  }

  return {
    kelly_fraction: kelly,
    half_kelly: halfKelly,
    recommended_percent: recommendedPercent,
    interpretation,
  };
}

/**
 * Lay thong ke giao dich tu closed positions.
 *
 * @param {string} portfolioId - UUID cua portfolio
 * @returns {Promise<{
 *   byContext: { REAL?: object, PAPER?: object },
 *   combined: object,
 *   warning?: string
 * }>}
 */
export async function getTradeStats(portfolioId) {
  // Query closed positions group by context
  // Per D-16: CLOSED_SL, CLOSED_TP, CLOSED_MANUAL
  const result = await query(
    `SELECT
      context,
      COUNT(*) AS total_trades,
      COUNT(*) FILTER (WHERE profit_loss_vnd > 0) AS wins,
      COUNT(*) FILTER (WHERE profit_loss_vnd <= 0) AS losses,
      AVG(profit_loss_vnd) FILTER (WHERE profit_loss_vnd > 0) AS avg_win,
      ABS(AVG(profit_loss_vnd) FILTER (WHERE profit_loss_vnd <= 0)) AS avg_loss
    FROM positions
    WHERE portfolio_id = $1
      AND status IN ('CLOSED_SL', 'CLOSED_TP', 'CLOSED_MANUAL')
    GROUP BY context`,
    [portfolioId]
  );

  const byContext = {};

  for (const row of result.rows) {
    const totalTrades = parseInt(row.total_trades, 10);
    const wins = parseInt(row.wins, 10);
    const losses = parseInt(row.losses, 10);
    const avgWin = parseFloat(row.avg_win) || 0;
    const avgLoss = parseFloat(row.avg_loss) || 1; // avoid division by 0

    const winRate = totalTrades > 0 ? wins / totalTrades : 0;
    const avgWinLoss = avgLoss > 0 ? avgWin / avgLoss : 0;

    byContext[row.context] = {
      totalTrades,
      wins,
      losses,
      winRate,
      avgWin,
      avgLoss,
      avgWinLoss,
    };
  }

  // Combined stats across all contexts
  let combinedTotal = 0;
  let combinedWins = 0;
  let combinedLosses = 0;
  let combinedAvgWin = 0;
  let combinedAvgLoss = 0;
  let contextCount = 0;

  for (const ctx of Object.values(byContext)) {
    combinedTotal += ctx.totalTrades;
    combinedWins += ctx.wins;
    combinedLosses += ctx.losses;
    combinedAvgWin += ctx.avgWin;
    combinedAvgLoss += ctx.avgLoss;
    contextCount++;
  }

  const combinedWinRate = combinedTotal > 0 ? combinedWins / combinedTotal : 0;
  const avgWinPerCtx = contextCount > 0 ? combinedAvgWin / contextCount : 0;
  const avgLossPerCtx = contextCount > 0 ? combinedAvgLoss / contextCount : 1;
  const combinedAvgWinLoss = avgLossPerCtx > 0 ? avgWinPerCtx / avgLossPerCtx : 0;

  const combined = {
    totalTrades: combinedTotal,
    wins: combinedWins,
    losses: combinedLosses,
    winRate: combinedWinRate,
    avgWin: avgWinPerCtx,
    avgLoss: avgLossPerCtx,
    avgWinLoss: combinedAvgWinLoss,
  };

  const response = { byContext, combined };

  // Warning khi < 10 total trades
  if (combinedTotal < 10) {
    response.warning = `Chua du du lieu (can >= 10 giao dich dong de tinh chinh xac). Hien co ${combinedTotal} giao dich.`;
  }

  return response;
}

/**
 * Tinh risk budget cua portfolio.
 *
 * @param {string} portfolioId - UUID portfolio
 * @param {number} totalBalance - Tong von (VND)
 * @param {number} [maxRiskPercent=5] - % rui ro toi da chap nhan
 * @returns {Promise<{
 *   usedRiskVnd: number,
 *   usedRiskPercent: number,
 *   maxRiskVnd: number,
 *   remainingBudget: number,
 *   positions: Array<{ symbol: string, sector: string, riskVnd: number, riskPercent: number }>,
 *   sectorConcentration: Array<{ sector: string, totalRiskVnd: number, percent: number }>
 * }>}
 */
export async function calculateRiskBudget(portfolioId, totalBalance, maxRiskPercent = 5) {
  // Query open positions co stop_loss (LONG: risk = (entry - sl) * qty, SHORT: risk = (sl - entry) * qty)
  const result = await query(
    `SELECT symbol, entry_price, stop_loss, quantity, side
    FROM positions
    WHERE portfolio_id = $1
      AND status = 'OPEN'
      AND stop_loss IS NOT NULL`,
    [portfolioId]
  );

  const maxRiskVnd = totalBalance * maxRiskPercent / 100;
  const positions = [];
  const sectorMap = {};

  for (const row of result.rows) {
    const entryPrice = parseFloat(row.entry_price);
    const stopLoss = parseFloat(row.stop_loss);
    const quantity = parseInt(row.quantity, 10);
    const side = row.side || 'LONG';

    // Tinh risk per position
    let riskVnd = 0;
    if (side === 'LONG') {
      riskVnd = Math.max(0, (entryPrice - stopLoss) * quantity);
    } else {
      // SHORT
      riskVnd = Math.max(0, (stopLoss - entryPrice) * quantity);
    }

    const sector = getSector(row.symbol);
    const riskPercent = maxRiskVnd > 0 ? (riskVnd / maxRiskVnd) * 100 : 0;

    positions.push({
      symbol: row.symbol,
      sector,
      riskVnd,
      riskPercent,
    });

    // Group by sector
    if (!sectorMap[sector]) {
      sectorMap[sector] = 0;
    }
    sectorMap[sector] += riskVnd;
  }

  const usedRiskVnd = positions.reduce((sum, p) => sum + p.riskVnd, 0);
  const usedRiskPercent = maxRiskVnd > 0 ? (usedRiskVnd / maxRiskVnd) * 100 : 0;
  const remainingBudget = maxRiskVnd - usedRiskVnd;

  // Sector concentration
  const sectorConcentration = Object.entries(sectorMap).map(([sector, totalRiskVnd]) => ({
    sector,
    totalRiskVnd,
    percent: usedRiskVnd > 0 ? (totalRiskVnd / usedRiskVnd) * 100 : 0,
  }));

  return {
    usedRiskVnd,
    usedRiskPercent,
    maxRiskVnd,
    remainingBudget,
    positions,
    sectorConcentration,
  };
}
