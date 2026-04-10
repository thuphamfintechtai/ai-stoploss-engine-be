/**
 * PortfolioSummary Controller — Tổng quan portfolio (tổng giá trị, P&L, % return).
 *
 * GET /api/portfolios/:portfolioId/real-summary
 *
 * Trả về:
 *   - total_value: tổng giá trị đã đầu tư (OPEN real positions)
 *   - total_realized_pnl: tổng lãi/lỗ đã thực hiện (CLOSED_MANUAL positions)
 *   - total_unrealized_pnl: lãi/lỗ chưa thực hiện (tạm thời = 0, Phase 5 tích hợp market price)
 *   - total_pnl: total_realized_pnl + total_unrealized_pnl
 *   - percent_return: % lợi nhuận trên tổng vốn
 *   - position_count: số vị thế đang mở
 *   - closed_count: số vị thế đã đóng
 *   - cash_balance: số dư tiền mặt từ CapitalService
 */

import { query } from '../../config/database.js';
import CapitalService from '../../services/portfolio/capitalService.js';

export const getPortfolioSummary = async (req, res, next) => {
  try {
    const portfolioId = req.params.portfolioId || req.params.id;

    // 1. Lấy số dư tiền mặt
    const balance = await CapitalService.getBalance(portfolioId);

    // 2. Aggregate OPEN real positions: tổng giá trị đã đầu tư
    const { rows: openAgg } = await query(
      `SELECT
        COUNT(*) as position_count,
        COALESCE(SUM(entry_price * quantity), 0) as total_invested,
        COALESCE(SUM(quantity), 0) as total_shares
      FROM financial.positions
      WHERE portfolio_id = $1 AND context = 'REAL' AND status = 'OPEN'`,
      [portfolioId]
    );

    // 3. Aggregate CLOSED_MANUAL real positions: tổng P&L đã thực hiện
    const { rows: closedAgg } = await query(
      `SELECT
        COUNT(*) as closed_count,
        COALESCE(SUM(profit_loss_vnd), 0) as total_realized_pnl
      FROM financial.positions
      WHERE portfolio_id = $1 AND context = 'REAL' AND status = 'CLOSED_MANUAL'`,
      [portfolioId]
    );

    // Note: unrealized P&L cần market price -- tạm thời = 0
    // Phase 5 sẽ tích hợp giá thị trường thực tế (VPBS API)
    const totalValue = parseFloat(openAgg[0]?.total_invested || 0);
    const totalRealizedPnl = parseFloat(closedAgg[0]?.total_realized_pnl || 0);
    const totalUnrealizedPnl = 0; // TODO: integrate market price in Phase 5
    const totalPnl = totalRealizedPnl + totalUnrealizedPnl;

    const totalBalance = balance?.total_balance || 0;
    const percentReturn = totalBalance > 0
      ? (totalPnl / totalBalance * 100)
      : 0;

    return res.json({
      success: true,
      data: {
        total_value: totalValue,
        total_realized_pnl: totalRealizedPnl,
        total_unrealized_pnl: totalUnrealizedPnl,
        total_pnl: totalPnl,
        percent_return: Math.round(percentReturn * 100) / 100,
        position_count: parseInt(openAgg[0]?.position_count || 0),
        closed_count: parseInt(closedAgg[0]?.closed_count || 0),
        cash_balance: balance,
      },
    });
  } catch (error) {
    next(error);
  }
};
