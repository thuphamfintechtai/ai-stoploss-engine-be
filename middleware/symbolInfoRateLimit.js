/**
 * symbolInfoRateLimit.js — MDI-08 (T-05-11)
 *
 * Per-IP rate limit cho symbol info endpoint (public, không auth) để ngăn scan/spam
 * → giảm tải VPBS upstream và bảo vệ khỏi DoS cost cascade.
 *
 * Default: 60 req/min/IP. Override qua env SYMBOL_INFO_RATE_LIMIT_PER_MIN.
 * Response 429 có body tiếng Việt + Retry-After header (draft-7 standard headers).
 *
 * Threat mitigated: T-05-11 (symbol info scan/spam).
 *
 * Usage: router.get('/symbols/:symbol/info', symbolInfoRateLimit, handler)
 */
import rateLimit from 'express-rate-limit';

const WINDOW_MS = 60 * 1000; // 60 giây
const DEFAULT_MAX = 60; // 60 req/phút/IP

/**
 * Parse env SYMBOL_INFO_RATE_LIMIT_PER_MIN — số nguyên dương, fallback DEFAULT_MAX.
 */
function resolveMax() {
  const raw = process.env.SYMBOL_INFO_RATE_LIMIT_PER_MIN;
  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_MAX;
}

export const symbolInfoRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: resolveMax(),
  // Key theo IP — endpoint public, không có user context.
  keyGenerator: (req) => req.ip || 'anonymous',
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    const resetTimeMs = req.rateLimit?.resetTime
      ? new Date(req.rateLimit.resetTime).getTime()
      : Date.now() + WINDOW_MS;
    const retrySec = Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000));

    res.setHeader('Retry-After', String(retrySec));
    return res.status(429).json({
      success: false,
      code: 'RATE_LIMITED',
      message: `Quá nhiều yêu cầu thông tin mã. Thử lại sau ${retrySec} giây.`,
      retry_after_seconds: retrySec,
    });
  },
});

export default symbolInfoRateLimit;
