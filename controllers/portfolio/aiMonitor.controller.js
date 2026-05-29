/**
 * AI Monitor Controller — Quản lý trạng thái giám sát AI cho portfolio.
 *
 * GET  /api/portfolios/:portfolioId/monitor/state  — Lấy trạng thái monitor
 * POST /api/portfolios/:portfolioId/monitor/toggle — Bật/tắt monitor
 * GET  /api/portfolios/:portfolioId/alerts         — Lấy danh sách alerts
 * POST /api/portfolios/:portfolioId/alerts/:alertId/ack     — Acknowledge alert
 * POST /api/portfolios/:portfolioId/alerts/:alertId/dismiss — Dismiss alert
 */

import Joi from 'joi';
import { query } from '../../config/database.js';
import Portfolio from '../../models/Portfolio.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensurePortfolioOwnership(req, res) {
  const portfolioId = req.params.portfolioId;
  const portfolio = await Portfolio.findById(portfolioId);
  if (!portfolio) {
    res.status(404).json({ success: false, message: 'Portfolio không tồn tại' });
    return null;
  }
  if (portfolio.user_id !== req.user.userId) {
    res.status(403).json({ success: false, message: 'Không có quyền truy cập portfolio này' });
    return null;
  }
  return portfolio;
}

function calculateNextRun(frequencyMin) {
  const now = new Date();
  return new Date(now.getTime() + frequencyMin * 60 * 1000);
}

// ─── Validation Schemas ───────────────────────────────────────────────────────

export const toggleMonitorSchema = Joi.object({
  enabled: Joi.boolean().required(),
  frequency_min: Joi.number().valid(15, 30, 60, 120).optional(),
});

// ─── Controllers ──────────────────────────────────────────────────────────────

/**
 * GET /api/portfolios/:portfolioId/monitor/state
 * Lấy trạng thái AI monitor của portfolio.
 */
export const getMonitorState = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    return res.json({
      success: true,
      data: {
        enabled: portfolio.ai_monitor_enabled ?? false,
        frequency_min: portfolio.ai_monitor_frequency_min ?? 30,
        last_run_at: portfolio.ai_monitor_last_run ?? null,
        next_run_at: portfolio.ai_monitor_next_run ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/portfolios/:portfolioId/monitor/toggle
 * Bật/tắt AI monitor.
 */
export const toggleMonitor = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const { enabled, frequency_min } = req.validatedBody;
    const freq = frequency_min ?? portfolio.ai_monitor_frequency_min ?? 30;
    const nextRun = enabled ? calculateNextRun(freq) : null;

    await query(
      `UPDATE financial.portfolios
       SET ai_monitor_enabled = $2,
           ai_monitor_frequency_min = $3,
           ai_monitor_next_run = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [portfolio.id, enabled, freq, nextRun]
    );

    return res.json({
      success: true,
      data: {
        enabled,
        frequency_min: freq,
        last_run_at: portfolio.ai_monitor_last_run ?? null,
        next_run_at: nextRun?.toISOString() ?? null,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/portfolios/:portfolioId/alerts
 * Lấy danh sách AI alerts (7 ngày gần nhất, chưa dismiss).
 */
export const getAlerts = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const since = req.query.since || '7d';
    let interval = '7 days';
    if (since === '1d') interval = '1 day';
    else if (since === '30d') interval = '30 days';

    const result = await query(
      `SELECT *
       FROM financial.ai_alerts
       WHERE portfolio_id = $1
         AND dismissed_at IS NULL
         AND created_at > NOW() - INTERVAL '${interval}'
       ORDER BY created_at DESC
       LIMIT 50`,
      [portfolio.id]
    );

    return res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/portfolios/:portfolioId/alerts/:alertId/ack
 * Acknowledge một alert (đã đọc).
 */
export const ackAlert = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const { alertId } = req.params;

    const result = await query(
      `UPDATE financial.ai_alerts
       SET acked_at = NOW()
       WHERE id = $1 AND portfolio_id = $2
       RETURNING *`,
      [alertId, portfolio.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Alert không tồn tại' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/portfolios/:portfolioId/alerts/:alertId/dismiss
 * Dismiss một alert (ẩn khỏi danh sách).
 */
export const dismissAlert = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const { alertId } = req.params;

    const result = await query(
      `UPDATE financial.ai_alerts
       SET dismissed_at = NOW()
       WHERE id = $1 AND portfolio_id = $2
       RETURNING *`,
      [alertId, portfolio.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Alert không tồn tại' });
    }

    return res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    next(error);
  }
};
