/**
 * PortfolioSummary Controller — Tổng quan portfolio (tổng giá trị, P&L, % return).
 *
 * GET /api/portfolios/:portfolioId/real-summary
 *
 * Trả về:
 *   - total_value: tổng giá trị đã đầu tư (OPEN real positions, integer VND)
 *   - total_realized_pnl: tổng lãi/lỗ đã thực hiện (CLOSED positions — status LIKE 'CLOSED%')
 *   - total_unrealized_pnl: lãi/lỗ chưa thực hiện (per-symbol mark-to-market, D-08)
 *   - total_pnl: total_realized_pnl + total_unrealized_pnl
 *   - percent_return: % lợi nhuận trên tổng vốn
 *   - position_count: số vị thế đang mở
 *   - closed_count: số vị thế đã đóng
 *   - cash_balance: số dư tiền mặt từ CapitalService (bao gồm buying_power, pending_buy_lock)
 *
 * Policy:
 * - MAP-07: ownership check — chặn cross-user access (403).
 * - D-08: per-OPEN-position mark-to-market qua marketPriceService.getMarketData(symbol),
 *   fallback current_price = entry_price khi service fail hoặc snapshot.price null.
 * - MAP-05 D-06 scope: integer VND math (Math.round(Number(x))) cho mọi số tiền trả về.
 */

import { query } from '../../config/database.js';
import CapitalService from '../../services/portfolio/capitalService.js';
import Portfolio from '../../models/Portfolio.js';
import marketPriceService from '../../services/shared/marketPriceService.js';

/**
 * Per-position mark-to-market với graceful degrade (D-08).
 * Loop qua OPEN positions, gọi marketPriceService.getMarketData(symbol) per-symbol.
 * Fallback: current_price = entry_price nếu service throw hoặc snapshot.price null.
 *
 * @param {Array<{symbol, quantity, entry_price, buy_fee_vnd}>} openPositions
 * @returns {Promise<number>} total unrealized P&L (integer VND)
 */
async function computeUnrealizedPnl(openPositions) {
  let total = 0;
  for (const pos of openPositions) {
    const entry = Math.round(Number(pos.entry_price));
    const qty = Number(pos.quantity);
    const buyFee = Math.round(Number(pos.buy_fee_vnd || 0));

    let lastPrice = entry; // fallback default = entry_price
    try {
      const snapshot = await marketPriceService.getMarketData(pos.symbol);
      // marketPriceService contract: { price, reference, high, low, quantity, error? }
      // price có thể null nếu VPBS không trả — fallback sang entry_price.
      const fetched = snapshot?.price ?? snapshot?.lastPrice ?? snapshot?.last_price;
      if (fetched != null && Number.isFinite(Number(fetched))) {
        lastPrice = Math.round(Number(fetched));
      } else {
        console.warn(`[portfolioSummary] marketPriceService fallback for ${pos.symbol}: snapshot missing/null price`);
      }
    } catch (err) {
      console.warn(`[portfolioSummary] marketPriceService error for ${pos.symbol}: ${err?.message ?? err}`);
      // lastPrice giữ fallback = entry
    }

    const unrealized_i = (lastPrice - entry) * qty - buyFee;
    total += Math.round(unrealized_i);
  }
  return total;
}

export const getPortfolioSummary = async (req, res, next) => {
  try {
    const portfolioId = req.params.portfolioId || req.params.id;

    // ─── Ownership check (MAP-07) ────────────────────────────────────────
    const portfolio = await Portfolio.findById(portfolioId);
    if (!portfolio) {
      return res.status(404).json({
        success: false,
        message: 'Portfolio không tồn tại',
      });
    }
    if (portfolio.user_id !== req.user.userId) {
      return res.status(403).json({
        success: false,
        message: 'Không có quyền truy cập portfolio này',
      });
    }

    // ─── Cash balance (include buying_power + pending_buy_lock từ Plan 03-01) ──
    const balance = await CapitalService.getBalance(portfolioId);

    // ─── OPEN positions: load chi tiết để mark-to-market (D-08) ───────────
    const { rows: openPositions } = await query(
      `SELECT id, symbol, quantity, entry_price, buy_fee_vnd
       FROM financial.positions
       WHERE portfolio_id = $1 AND context = 'REAL' AND status = 'OPEN'`,
      [portfolioId]
    );

    // total_invested = sum(entry × qty) — integer VND
    let totalInvested = 0;
    for (const p of openPositions) {
      totalInvested += Math.round(Number(p.entry_price) * Number(p.quantity));
    }

    // Unrealized per-symbol với market price + graceful fallback (D-08)
    const totalUnrealizedPnl = await computeUnrealizedPnl(openPositions);

    // ─── CLOSED positions: realized P/L ──────────────────────────────────
    // Cover CLOSED_MANUAL + future CLOSED_SL + CLOSED_TP (status LIKE 'CLOSED%')
    const { rows: closedAgg } = await query(
      `SELECT
        COUNT(*) as closed_count,
        COALESCE(SUM(profit_loss_vnd), 0) as total_realized_pnl
      FROM financial.positions
      WHERE portfolio_id = $1 AND context = 'REAL' AND status LIKE 'CLOSED%'`,
      [portfolioId]
    );

    const totalValue = totalInvested;
    const totalRealizedPnl = Math.round(Number(closedAgg[0]?.total_realized_pnl || 0));
    const totalPnl = totalRealizedPnl + totalUnrealizedPnl;

    const totalBalance = Math.round(Number(balance?.total_balance || 0));
    const percentReturn = totalBalance > 0
      ? Math.round((totalPnl / totalBalance) * 10000) / 100 // 2 decimal
      : 0;

    return res.json({
      success: true,
      data: {
        total_value: totalValue,
        total_realized_pnl: totalRealizedPnl,
        total_unrealized_pnl: totalUnrealizedPnl,
        total_pnl: totalPnl,
        percent_return: percentReturn,
        position_count: openPositions.length,
        closed_count: parseInt(closedAgg[0]?.closed_count || 0),
        cash_balance: balance,
      },
    });
  } catch (error) {
    next(error);
  }
};
