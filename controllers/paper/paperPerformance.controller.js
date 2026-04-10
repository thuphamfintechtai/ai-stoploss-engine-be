/**
 * Paper Performance Controller — API lay bao cao hieu suat paper trading.
 *
 * GET /api/portfolios/:portfolioId/paper-performance?period=all
 *
 * Tra ve: Total P&L, Win Rate, Avg Win/Loss, Profit Factor, Max Drawdown (D-11),
 *         Buy & Hold comparison (D-12), filter theo tuan/thang/all (D-13).
 *
 * RULE: Chi tra ve PAPER positions (context = 'PAPER') — Pitfall 6
 */

import Joi from 'joi';
import Portfolio from '../../models/Portfolio.js';
import PaperPerformanceService from '../../services/paper/paperPerformanceService.js';
import PaperCapitalService from '../../services/paper/paperCapitalService.js';

// ─── Validation Schema ────────────────────────────────────────────────────────

export const performanceQuerySchema = Joi.object({
  period: Joi.string().valid('all', 'week', 'month').default('all'),
});

// ─── Helper: dam bao portfolio thuoc user ────────────────────────────────────

async function ensurePortfolioOwnership(req, res) {
  const portfolioId = req.params.portfolioId;
  const portfolio = await Portfolio.findById(portfolioId);
  if (!portfolio) {
    res.status(404).json({ success: false, message: 'Portfolio khong ton tai' });
    return null;
  }
  if (portfolio.user_id !== req.user.userId) {
    res.status(403).json({ success: false, message: 'Khong co quyen truy cap portfolio nay' });
    return null;
  }
  return portfolio;
}

// ─── GET /api/portfolios/:portfolioId/virtual-balance ────────────────────────

export const getVirtualBalance = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const balance = await PaperCapitalService.getVirtualBalance(portfolio.id);
    if (!balance) {
      return res.status(404).json({ success: false, message: 'Khong tim thay virtual balance' });
    }

    res.json({ success: true, data: balance });
  } catch (error) {
    next(error);
  }
};

// ─── GET /api/portfolios/:portfolioId/paper-performance ──────────────────────

export const getPerformanceReport = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    // Su dung validatedQuery neu co (tu validateQuery middleware), fallback req.query
    const { period = 'all' } = req.validatedQuery || req.query;

    const report = await PaperPerformanceService.getFullReport(portfolio.id, { period });

    res.json({
      success: true,
      data: report,
    });
  } catch (error) {
    next(error);
  }
};
