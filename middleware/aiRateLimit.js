/**
 * aiRateLimit.js — AIT-05 (D-05)
 *
 * Per-user rate limit cho AI routes: N calls / 10 phút (default 10, env override).
 * Dùng express-rate-limit v7 với custom handler trả body tiếng Việt + Retry-After.
 *
 * Threat mitigated: T-04-04 (user spam /api/ai/* gây cost Gemini API tăng đột biến).
 *
 * Usage: router.use(authenticateToken); router.use(aiRateLimit);
 */
import rateLimit from 'express-rate-limit';

const WINDOW_MS = 10 * 60 * 1000; // 10 phút
const DEFAULT_MAX = 10;

/**
 * Parse env AI_RATE_LIMIT_PER_10MIN — số nguyên dương, fallback về DEFAULT_MAX.
 */
function resolveMax() {
  const raw = process.env.AI_RATE_LIMIT_PER_10MIN;
  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return DEFAULT_MAX;
}

export const aiRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  max: resolveMax(),
  // Key theo user (authenticateToken đã chạy trước nên req.user.userId phải có).
  // Fallback IP để không crash nếu middleware bị mount nhầm chỗ (defense-in-depth).
  keyGenerator: (req) => (req.user && req.user.userId) || req.ip || 'anonymous',
  // Skip health check — user-facing monitoring không bị đếm.
  skip: (req) => {
    const p = req.path || '';
    return p === '/health' || p.endsWith('/health');
  },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Custom response: body tiếng Việt + Retry-After header.
  handler: (req, res) => {
    const resetTimeMs = req.rateLimit?.resetTime
      ? new Date(req.rateLimit.resetTime).getTime()
      : Date.now() + WINDOW_MS;
    const retrySec = Math.max(1, Math.ceil((resetTimeMs - Date.now()) / 1000));

    res.setHeader('Retry-After', String(retrySec));
    return res.status(429).json({
      success: false,
      message: `Bạn đã dùng hết lượt AI, thử lại sau ${retrySec} giây`,
      retry_after_seconds: retrySec,
    });
  },
});

export default aiRateLimit;
