/**
 * PaperPerformanceService — Tinh hieu suat Paper Trading.
 *
 * Cac metrics:
 * - Total P&L, Win Rate, Avg Win/Loss, Profit Factor (D-11)
 * - Max Drawdown tu equity curve (D-11)
 * - Buy & Hold comparison voi net holdings (D-12, Pitfall 7)
 * - Time filter: all / week / month (D-13)
 *
 * CRITICAL: Chi query PAPER positions (context = 'PAPER') — Pitfall 6
 */

import { query } from '../../config/database.js';
import { getMarketData } from '../shared/marketPriceService.js';

const VPBS_PRICE_TO_VND = 1000;

/** Chuyen gia VPBS (hang nghin) sang VND */
function marketPriceToVnd(price) {
  if (price == null || !Number.isFinite(Number(price))) return null;
  const p = Number(price);
  return Math.round(p >= 1000 ? p : p * VPBS_PRICE_TO_VND);
}

/** Build date filter dua tren period */
function buildDateFilter(period) {
  if (period === 'week') {
    return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  }
  if (period === 'month') {
    return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
  return null; // 'all' -> khong filter
}

class PaperPerformanceService {
  /**
   * Lay performance report: tong quat P&L, win rate, profit factor, avg win/loss.
   *
   * @param {number} portfolioId
   * @param {{ period?: 'all' | 'week' | 'month' }} options
   * @returns {Promise<object>} Performance metrics
   */
  static async getPerformanceReport(portfolioId, { period = 'all' } = {}) {
    const dateFilter = buildDateFilter(period);

    const sql = `
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE status != 'OPEN'), 0) AS total_trades,
        COALESCE(COUNT(*) FILTER (WHERE profit_loss_vnd > 0 AND status != 'OPEN'), 0) AS winning_trades,
        COALESCE(COUNT(*) FILTER (WHERE profit_loss_vnd < 0 AND status != 'OPEN'), 0) AS losing_trades,
        COALESCE(SUM(profit_loss_vnd) FILTER (WHERE status != 'OPEN'), 0) AS total_pnl,
        COALESCE(SUM(profit_loss_vnd) FILTER (WHERE profit_loss_vnd > 0 AND status != 'OPEN'), 0) AS gross_profit,
        COALESCE(ABS(SUM(profit_loss_vnd) FILTER (WHERE profit_loss_vnd < 0 AND status != 'OPEN')), 0) AS gross_loss,
        COALESCE(AVG(profit_loss_vnd) FILTER (WHERE profit_loss_vnd > 0 AND status != 'OPEN'), 0) AS avg_win,
        COALESCE(ABS(AVG(profit_loss_vnd) FILTER (WHERE profit_loss_vnd < 0 AND status != 'OPEN')), 0) AS avg_loss
      FROM financial.positions
      WHERE portfolio_id = $1
        AND context = 'PAPER'
        AND ($2::timestamptz IS NULL OR closed_at >= $2)
    `;

    const result = await query(sql, [portfolioId, dateFilter]);
    const row = result.rows[0];

    const totalTrades = parseInt(row.total_trades, 10) || 0;
    const winningTrades = parseInt(row.winning_trades, 10) || 0;
    const losingTrades = parseInt(row.losing_trades, 10) || 0;
    const totalPnl = parseFloat(row.total_pnl) || 0;
    const grossProfit = parseFloat(row.gross_profit) || 0;
    const grossLoss = parseFloat(row.gross_loss) || 0;
    const avgWin = parseFloat(row.avg_win) || 0;
    const avgLoss = parseFloat(row.avg_loss) || 0;

    // Derived metrics
    const winRate = totalTrades > 0
      ? parseFloat(((winningTrades / totalTrades) * 100).toFixed(2))
      : 0;

    // profit_factor = gross_profit / gross_loss (avoid div by 0)
    const profitFactor = grossLoss > 0
      ? parseFloat((grossProfit / grossLoss).toFixed(2))
      : 0;

    return {
      total_trades: totalTrades,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      total_pnl: totalPnl,
      gross_profit: grossProfit,
      gross_loss: grossLoss,
      avg_win: avgWin,
      avg_loss: avgLoss,
      win_rate: winRate,
      profit_factor: profitFactor,
    };
  }

  /**
   * Tinh Max Drawdown tu equity curve cua closed positions.
   *
   * @param {number} portfolioId
   * @param {{ period?: 'all' | 'week' | 'month' }} options
   * @returns {Promise<{ max_drawdown_vnd: number, max_drawdown_pct: number }>}
   */
  static async getMaxDrawdown(portfolioId, { period = 'all' } = {}) {
    const dateFilter = buildDateFilter(period);

    const sql = `
      SELECT profit_loss_vnd, closed_at
      FROM financial.positions
      WHERE portfolio_id = $1
        AND context = 'PAPER'
        AND status != 'OPEN'
        AND ($2::timestamptz IS NULL OR closed_at >= $2)
      ORDER BY closed_at ASC
    `;

    const result = await query(sql, [portfolioId, dateFilter]);
    const rows = result.rows;

    if (!rows || rows.length === 0) {
      return { max_drawdown_vnd: 0, max_drawdown_pct: 0 };
    }

    // Build equity curve (cumulative P&L)
    let runningEquity = 0;
    let peak = 0;
    let maxDrawdownVnd = 0;

    for (const row of rows) {
      runningEquity += parseFloat(row.profit_loss_vnd) || 0;

      if (runningEquity > peak) {
        peak = runningEquity;
      }

      const drawdown = peak - runningEquity;
      if (drawdown > maxDrawdownVnd) {
        maxDrawdownVnd = drawdown;
      }
    }

    const maxDrawdownPct = peak > 0
      ? parseFloat(((maxDrawdownVnd / peak) * 100).toFixed(2))
      : 0;

    return {
      max_drawdown_vnd: maxDrawdownVnd,
      max_drawdown_pct: maxDrawdownPct,
    };
  }

  /**
   * Tinh Buy & Hold return cho net holdings.
   *
   * Per Pitfall 7: tinh NET holdings = BUY qty - SELL qty (chi tinh co phieu chua ban het).
   *
   * @param {number} portfolioId
   * @returns {Promise<{ buy_hold_value: number, buy_hold_cost: number, buy_hold_return: number, buy_hold_return_pct: number }>}
   */
  static async getBuyAndHoldReturn(portfolioId) {
    // Query net holdings per symbol
    // net_qty = BUY qty - SELL qty (HAVING net_qty > 0 = chi tinh co phieu con dang giu)
    // total_buy_cost = tong tien mua (entry_price * quantity cho cac BUY orders)
    const sql = `
      SELECT
        symbol,
        SUM(CASE WHEN side = 'LONG' THEN quantity ELSE -quantity END) AS net_qty,
        SUM(CASE WHEN side = 'LONG' THEN entry_price * quantity ELSE 0 END) AS total_buy_cost
      FROM financial.positions
      WHERE portfolio_id = $1
        AND context = 'PAPER'
      GROUP BY symbol
      HAVING SUM(CASE WHEN side = 'LONG' THEN quantity ELSE -quantity END) > 0
    `;

    const result = await query(sql, [portfolioId]);
    const rows = result.rows;

    if (!rows || rows.length === 0) {
      return {
        buy_hold_value: 0,
        buy_hold_cost: 0,
        buy_hold_return: 0,
        buy_hold_return_pct: 0,
        holdings: [],
      };
    }

    // Lay gia hien tai cho tung symbol
    let totalValue = 0;
    let totalCost = 0;
    const holdings = [];

    for (const row of rows) {
      const netQty = parseFloat(row.net_qty) || 0;
      const totalBuyCost = parseFloat(row.total_buy_cost) || 0;

      if (netQty <= 0) continue;

      // Lay gia thi truong
      let currentPriceVnd = null;
      try {
        const mktData = await getMarketData(row.symbol);
        const rawPrice = mktData?.price ?? mktData?.reference ?? null;
        currentPriceVnd = marketPriceToVnd(rawPrice);
      } catch (_) {
        // Neu khong lay duoc gia, bo qua symbol nay
      }

      if (currentPriceVnd == null) continue;

      const currentValue = currentPriceVnd * netQty;
      totalValue += currentValue;
      totalCost += totalBuyCost;

      holdings.push({
        symbol: row.symbol,
        net_qty: netQty,
        current_price_vnd: currentPriceVnd,
        current_value: currentValue,
        buy_cost: totalBuyCost,
      });
    }

    const buyHoldReturn = totalValue - totalCost;
    const buyHoldReturnPct = totalCost > 0
      ? parseFloat(((buyHoldReturn / totalCost) * 100).toFixed(2))
      : 0;

    return {
      buy_hold_value: totalValue,
      buy_hold_cost: totalCost,
      buy_hold_return: buyHoldReturn,
      buy_hold_return_pct: buyHoldReturnPct,
      holdings,
    };
  }

  /**
   * Full report: ket hop tat ca metrics.
   *
   * @param {number} portfolioId
   * @param {{ period?: 'all' | 'week' | 'month' }} options
   * @returns {Promise<object>}
   */
  static async getFullReport(portfolioId, options = {}) {
    const [performanceMetrics, drawdownMetrics, buyHoldMetrics] = await Promise.all([
      PaperPerformanceService.getPerformanceReport(portfolioId, options),
      PaperPerformanceService.getMaxDrawdown(portfolioId, options),
      PaperPerformanceService.getBuyAndHoldReturn(portfolioId),
    ]);

    return {
      ...performanceMetrics,
      ...drawdownMetrics,
      ...buyHoldMetrics,
    };
  }
}

export default PaperPerformanceService;
