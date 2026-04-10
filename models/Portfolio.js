import { query } from '../config/database.js';

class Portfolio {
  static async create({ userId, name, totalBalance, maxRiskPercent, expectedReturnPercent }) {
    const result = await query(
      `INSERT INTO portfolios (user_id, name, total_balance, max_risk_percent, expected_return_percent)
       VALUES ($1, $2, $3, $4, COALESCE($5, 0))
       RETURNING *`,
      [userId, name, totalBalance, maxRiskPercent, expectedReturnPercent ?? 0]
    );

    return result.rows[0];
  }

  static async findById(id) {
    const result = await query(
      `SELECT * FROM portfolios WHERE id = $1`,
      [id]
    );

    return result.rows[0];
  }

  static async findByUserId(userId) {
    const result = await query(
      `SELECT * FROM portfolios WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows;
  }

  static async update(id, { name, totalBalance, maxRiskPercent, expectedReturnPercent, isActive }) {
    const result = await query(
      `UPDATE portfolios
       SET name = COALESCE($2, name),
           total_balance = COALESCE($3, total_balance),
           max_risk_percent = COALESCE($4, max_risk_percent),
           expected_return_percent = COALESCE($5, expected_return_percent),
           is_active = COALESCE($6, is_active)
       WHERE id = $1
       RETURNING *`,
      [id, name, totalBalance, maxRiskPercent, expectedReturnPercent, isActive]
    );

    return result.rows[0];
  }

  static async delete(id) {
    await query('DELETE FROM portfolios WHERE id = $1', [id]);
  }

  // Get current risk status
  static async getRiskStatus(portfolioId) {
    const result = await query(
      `SELECT * FROM v_portfolio_current_risk WHERE portfolio_id = $1`,
      [portfolioId]
    );

    return result.rows[0];
  }

  // Get performance metrics – VND là đơn vị chính
  static async getPerformance(portfolioId) {
    const [statsRes, equityRes] = await Promise.all([
      query(
        `SELECT
          COUNT(*) FILTER (WHERE status != 'OPEN') AS total_trades,
          COUNT(*) FILTER (WHERE status = 'CLOSED_TP') AS tp_count,
          COUNT(*) FILTER (WHERE status = 'CLOSED_SL') AS sl_count,
          COUNT(*) FILTER (WHERE status = 'CLOSED_MANUAL') AS manual_close_count,
          COALESCE(SUM(profit_loss_vnd) FILTER (WHERE status != 'OPEN'), 0) AS total_pnl_vnd,
          COALESCE(AVG(profit_loss_vnd) FILTER (WHERE status != 'OPEN' AND profit_loss_vnd > 0), 0) AS avg_win_vnd,
          COALESCE(ABS(AVG(profit_loss_vnd) FILTER (WHERE status != 'OPEN' AND profit_loss_vnd < 0)), 0) AS avg_loss_vnd,
          COALESCE(SUM(profit_loss_vnd) FILTER (WHERE status != 'OPEN' AND profit_loss_vnd > 0), 0) AS gross_profit_vnd,
          COALESCE(ABS(SUM(profit_loss_vnd) FILTER (WHERE status != 'OPEN' AND profit_loss_vnd < 0)), 0) AS gross_loss_vnd,
          COUNT(*) FILTER (WHERE status != 'OPEN' AND profit_loss_vnd > 0) AS winning_trades,
          COUNT(*) FILTER (WHERE status != 'OPEN' AND profit_loss_vnd < 0) AS losing_trades
         FROM financial.positions
         WHERE portfolio_id = $1`,
        [portfolioId]
      ),
      // Equity curve: tích lũy P&L theo ngày đóng lệnh (30 ngày gần nhất)
      query(
        `SELECT
          DATE(closed_at AT TIME ZONE 'Asia/Ho_Chi_Minh') AS date,
          SUM(profit_loss_vnd) AS daily_pnl
         FROM financial.positions
         WHERE portfolio_id = $1
           AND status != 'OPEN'
           AND closed_at IS NOT NULL
           AND closed_at >= NOW() - INTERVAL '90 days'
         GROUP BY 1
         ORDER BY 1 ASC`,
        [portfolioId]
      ),
    ]);

    const stats = statsRes.rows[0] || {};
    const totalTrades = parseInt(stats.total_trades) || 0;
    const winningTrades = parseInt(stats.winning_trades) || 0;
    const losingTrades = parseInt(stats.losing_trades) || 0;

    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const grossProfit = parseFloat(stats.gross_profit_vnd) || 0;
    const grossLoss = parseFloat(stats.gross_loss_vnd) || 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? 99.99 : 0);

    // Max drawdown từ equity curve
    const equityPoints = equityRes.rows;
    let runningPnl = 0;
    let peak = 0;
    let maxDrawdownVnd = 0;
    const equityCurve = equityPoints.map((row) => {
      runningPnl += parseFloat(row.daily_pnl) || 0;
      if (runningPnl > peak) peak = runningPnl;
      const drawdown = peak > 0 ? peak - runningPnl : 0;
      if (drawdown > maxDrawdownVnd) maxDrawdownVnd = drawdown;
      return {
        date: row.date,
        cumulative_pnl: Math.round(runningPnl),
        daily_pnl: Math.round(parseFloat(row.daily_pnl) || 0),
      };
    });

    // Portfolio balance để tính % drawdown
    const portfolioRes = await query(`SELECT total_balance FROM financial.portfolios WHERE id = $1`, [portfolioId]);
    const totalBalance = parseFloat(portfolioRes.rows[0]?.total_balance) || 1;
    const maxDrawdownPct = (maxDrawdownVnd / totalBalance) * 100;

    return {
      total_trades: totalTrades,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      tp_count: parseInt(stats.tp_count) || 0,
      sl_count: parseInt(stats.sl_count) || 0,
      manual_close_count: parseInt(stats.manual_close_count) || 0,
      win_rate: parseFloat(winRate.toFixed(2)),
      total_pnl_vnd: Math.round(parseFloat(stats.total_pnl_vnd) || 0),
      avg_win_vnd: Math.round(parseFloat(stats.avg_win_vnd) || 0),
      avg_loss_vnd: Math.round(parseFloat(stats.avg_loss_vnd) || 0),
      gross_profit_vnd: Math.round(grossProfit),
      gross_loss_vnd: Math.round(grossLoss),
      profit_factor: parseFloat(profitFactor.toFixed(3)),
      max_drawdown_vnd: Math.round(maxDrawdownVnd),
      max_drawdown_pct: parseFloat(maxDrawdownPct.toFixed(2)),
      equity_curve: equityCurve,
    };
  }
}

export default Portfolio;
