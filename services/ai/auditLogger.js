/**
 * auditLogger.js — AIT-09 (D-09)
 *
 * Fire-and-forget insert vao ai_audit_log moi khi Gemini duoc goi.
 * KHONG throw / reject neu DB fail → khong block response user.
 *
 * Threat mitigated: T-04-09 (user tranh cai AI recommendation, khong co bang chung).
 *
 * Usage (trong aiService.js):
 *   logAiCall({ userId, endpoint, modelVersion, prompt, response,
 *               latencyMs, status: 'success' | 'error' | 'fallback' }).catch(() => {});
 */
import { query } from '../../config/database.js';

const MAX_TEXT_LEN = 10_000;
const DB_SCHEMA = process.env.DB_SCHEMA || 'financial';
const SAFE_SCHEMA = /^[a-z_][a-z0-9_]{0,62}$/;
if (!SAFE_SCHEMA.test(DB_SCHEMA)) {
  // Fail fast — invalid schema gay SQL injection risk neu duoc noi thang vao query.
  throw new Error(`Invalid DB_SCHEMA: "${DB_SCHEMA}"`);
}

/**
 * Truncate string ve max ky tu (null → null, undefined → null).
 */
function truncate(value, max = MAX_TEXT_LEN) {
  if (value === null || value === undefined) return null;
  const s = typeof value === 'string' ? value : String(value);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Insert mot audit record. Fire-and-forget — KHONG throw.
 *
 * @param {object} p
 * @param {string} p.userId - Required. Neu thieu → skip + warn.
 * @param {string} p.endpoint - Required. Ten endpoint/function (generateSignal, analyzeTrend,...)
 * @param {string} [p.modelVersion] - Gemini model name (process.env.GEMINI_MODEL).
 * @param {string} [p.prompt] - Raw prompt gui Gemini. Truncate 10k.
 * @param {string} [p.response] - Raw response tu Gemini hoac error message. Truncate 10k.
 * @param {number} [p.latencyMs] - Ms giua goi va response.
 * @param {string} [p.status='success'] - success | fallback | error
 * @param {number} [p.inputTokens]
 * @param {number} [p.outputTokens]
 * @returns {Promise<void>} Always resolves. Loi DB → console.warn.
 */
export async function logAiCall({
  userId,
  endpoint,
  modelVersion = null,
  prompt = null,
  response = null,
  latencyMs = null,
  status = 'success',
  inputTokens = null,
  outputTokens = null,
} = {}) {
  if (!userId) {
    console.warn('[audit] missing userId, skip insert');
    return;
  }
  if (!endpoint) {
    console.warn('[audit] missing endpoint, skip insert');
    return;
  }

  try {
    await query(
      `INSERT INTO ${DB_SCHEMA}.ai_audit_log
         (user_id, endpoint, model_version, prompt_text, response_text,
          input_tokens, output_tokens, latency_ms, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        endpoint,
        modelVersion,
        truncate(prompt),
        truncate(response),
        inputTokens,
        outputTokens,
        latencyMs,
        status,
      ]
    );
  } catch (err) {
    // Fire-and-forget — khong re-throw. Log warn de ops theo doi.
    console.warn('[audit] insert failed:', err.message);
  }
}

export default { logAiCall };
