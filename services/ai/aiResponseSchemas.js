/**
 * aiResponseSchemas — Joi schemas cho mọi Gemini response.
 *
 * Requirement: AIT-01 (JSON schema validation).
 * Threats mitigated: T-04-01 (shape/enum hallucination), T-04-05 (giá phi lý).
 *
 * Policy chung:
 *   - `.unknown(true)` ở top-level → LLM thường thêm field phụ, không reject vì nhiễu
 *   - Các field required BẮT BUỘC strict (không unknown-allow ở nested enum/range)
 *   - Range hợp lý cho giá: SL > 0, TP ≤ 10× entry (chặn hallucinate 10000x → drain user money)
 *
 * Usage:
 *   import { validateAiResponse } from './aiResponseSchemas.js';
 *   const { ok, value, errors } = validateAiResponse('signal', raw);
 *   if (!ok) { ... fallback rule-based ... }
 */

import Joi from 'joi';

// ─── Reusable primitives ───────────────────────────────────────────────────

const positiveNumber = Joi.number().positive();
const nonNegativeNumber = Joi.number().min(0);
const confidence0to100 = Joi.number().min(0).max(100);
const timeframeEnum = Joi.string().valid('short', 'medium', 'long');
const riskLevelEnum = Joi.string().valid('LOW', 'MEDIUM', 'HIGH');
const verySeriousRiskLevelEnum = Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

// ─── signalSchema — generateSignal output (AIT-01) ─────────────────────────

/**
 * Shape Gemini MUST trả cho generateSignal().
 * Reject: unknown action, confidence out of [0,100], SL ≤ 0, TP > 10× entry.
 * Sanity cross-field check (TP ≤ 10× entry, SL ≤ 10× entry) được áp ở
 * validateAiResponse() để error path chính xác ở tên field (.custom ở Joi
 * object level trả path=[] — không detect được bằng test).
 */
export const signalSchema = Joi.object({
  action: Joi.string().valid('BUY', 'SELL', 'HOLD').required(),
  entry_price: positiveNumber.required(),
  stop_loss: positiveNumber.required(),
  take_profit: positiveNumber.required(),
  confidence_score: confidence0to100.required(),
  timeframe: timeframeEnum.required(),
  reason: Joi.string().min(5).required(),
  technical_context: Joi.object({
    trend: Joi.string().valid('BULLISH', 'BEARISH', 'SIDEWAYS'),
    momentum: Joi.string().valid('STRONG', 'MODERATE', 'WEAK'),
    volume_confirmation: Joi.boolean(),
    key_pattern: Joi.string().allow(''),
  }).unknown(true),
  risk_level: riskLevelEnum.required(),
  expiry_hours: Joi.number().min(1).max(168).required(),
}).unknown(true);

/**
 * Sanity cross-field checks cho signal payload.
 * Threat T-04-05: Gemini hallucinate TP=500_000 cho entry=50_000 → reject.
 *
 * @param {object} value
 * @returns {Array<{path: Array, message: string, type: string}>}
 */
function _signalSanityErrors(value) {
  const errs = [];
  if (!value || typeof value !== 'object') return errs;
  const { entry_price, take_profit, stop_loss } = value;
  if (entry_price > 0 && typeof take_profit === 'number' && take_profit > entry_price * 10) {
    errs.push({
      path: ['take_profit'],
      message: `"take_profit" (${take_profit}) vượt 10× entry_price (${entry_price}) — giá phi lý`,
      type: 'sanity.range',
    });
  }
  if (entry_price > 0 && typeof stop_loss === 'number' && stop_loss > entry_price * 10) {
    errs.push({
      path: ['stop_loss'],
      message: `"stop_loss" (${stop_loss}) vượt 10× entry_price (${entry_price}) — giá phi lý`,
      type: 'sanity.range',
    });
  }
  return errs;
}

// ─── sltpSchema — suggestStopLossTakeProfit output ─────────────────────────

const suggestionItemSchema = Joi.object({
  type: Joi.string().required(),
  label: Joi.string(),
  stop_loss_vnd: positiveNumber.required(),
  take_profit_vnd: positiveNumber.required(),
  stop_loss_pct: Joi.alternatives().try(Joi.number(), Joi.string()),
  take_profit_pct: Joi.alternatives().try(Joi.number(), Joi.string()),
  rr_ratio: Joi.number(),
}).unknown(true);

export const sltpSchema = Joi.object({
  suggestions: Joi.array().items(suggestionItemSchema).min(1).required(),
  technical_score: Joi.object({
    score: confidence0to100,
    label: Joi.string(),
    methodology: Joi.string().allow(''),
  }).unknown(true),
  key_levels: Joi.object({
    support: Joi.array().items(nonNegativeNumber),
    resistance: Joi.array().items(nonNegativeNumber),
    atr_14: nonNegativeNumber,
  })
    .unknown(true)
    .required(),
  analysis_text: Joi.string().allow(''),
  disclaimer: Joi.string(),
  data_quality: Joi.object().unknown(true),
  _inference: Joi.object().unknown(true),
})
  .unknown(true);

// ─── reviewSchema — reviewOpenPositions (array) ────────────────────────────

const reviewItemSchema = Joi.object({
  position_id: Joi.alternatives()
    .try(Joi.string(), Joi.number())
    .required(),
  symbol: Joi.string().required(),
  action: Joi.string()
    .valid('HOLD', 'TIGHTEN_SL', 'TAKE_PARTIAL', 'EXIT')
    .required(),
  new_stop_loss: Joi.alternatives().try(positiveNumber, Joi.valid(null)),
  new_take_profit: Joi.alternatives().try(positiveNumber, Joi.valid(null)),
  reasoning: Joi.string().min(5).required(),
  urgency: Joi.string().valid('LOW', 'MEDIUM', 'HIGH').required(),
  key_concern: Joi.string().allow(''),
}).unknown(true);

export const reviewSchema = Joi.array().items(reviewItemSchema);

// ─── trendSchema — analyzeTrend output ─────────────────────────────────────

export const trendSchema = Joi.object({
  trend: Joi.string().valid('BULLISH', 'BEARISH', 'SIDEWAYS').required(),
  strength: confidence0to100.required(),
  timeframe: timeframeEnum,
  analysis: Joi.string().allow(''),
  signals: Joi.array().items(
    Joi.object({
      type: Joi.string().valid('BUY', 'SELL', 'NEUTRAL'),
      indicator: Joi.string().allow(''),
      message: Joi.string().allow(''),
    }).unknown(true)
  ),
  key_levels: Joi.object({
    support: Joi.array().items(positiveNumber).required(),
    resistance: Joi.array().items(positiveNumber).required(),
  })
    .unknown(true)
    .required(),
  volume_analysis: Joi.string().allow(''),
  recommendation: Joi.string().valid('BUY', 'SELL', 'HOLD', 'WATCH').required(),
  summary: Joi.string().min(1).required(),
}).unknown(true);

// ─── evaluateRiskSchema — evaluateTradeRisk output ─────────────────────────

export const evaluateRiskSchema = Joi.object({
  risk_level: verySeriousRiskLevelEnum.required(),
  risk_score: confidence0to100.required(),
  verdict: Joi.string()
    .valid('APPROVED', 'CAUTION', 'WARNING', 'REJECTED')
    .required(),
  factors: Joi.array().items(
    Joi.object({
      name: Joi.string(),
      level: Joi.string().valid('LOW', 'MEDIUM', 'HIGH'),
      description: Joi.string().allow(''),
    }).unknown(true)
  ),
  strengths: Joi.array().items(Joi.string()),
  weaknesses: Joi.array().items(Joi.string()),
  recommendations: Joi.array().items(Joi.string()),
  position_sizing: Joi.object().unknown(true),
  summary: Joi.string().min(5).required(),
}).unknown(true);

// ─── regimeSchema — detectMarketRegime output ──────────────────────────────

/**
 * Gemini output cho detectMarketRegime — phải có regime enum + confidence + risk_level.
 * vnindex_outlook tiếng Việt (Gemini quen với prompt VN).
 */
export const regimeSchema = Joi.object({
  regime: Joi.string().valid('BULL', 'BEAR', 'SIDEWAYS', 'VOLATILE').required(),
  confidence: confidence0to100.required(),
  description: Joi.string().allow(''),
  vnindex_outlook: Joi.string()
    .valid('TÍCH CỰC', 'TIÊU CỰC', 'TRUNG LẬP')
    .required(),
  recommendations: Joi.array().items(Joi.string()),
  risk_level: verySeriousRiskLevelEnum.required(),
  sector_focus: Joi.string().allow(''),
  key_levels: Joi.object({
    support: Joi.alternatives().try(nonNegativeNumber, Joi.valid(null)),
    resistance: Joi.alternatives().try(nonNegativeNumber, Joi.valid(null)),
  }).unknown(true),
  market_bias: Joi.string().allow(''),
}).unknown(true);

// ─── Schema registry + helper ──────────────────────────────────────────────

export const AI_SCHEMAS = {
  signal: signalSchema,
  sltp: sltpSchema,
  review: reviewSchema,
  trend: trendSchema,
  evaluateRisk: evaluateRiskSchema,
  regime: regimeSchema,
};

/** Extra cross-field validators theo schemaKey (chạy post Joi pass). */
const EXTRA_VALIDATORS = {
  signal: _signalSanityErrors,
};

/**
 * Validate Gemini payload theo schema key. KHÔNG throw — caller quyết định fallback.
 *
 * @param {string} schemaKey - Key trong AI_SCHEMAS
 * @param {*}      payload   - Raw parsed JSON từ callGeminiJSON()
 * @returns {{ok: boolean, value: *, errors: Array<{path: Array, message: string}>|null}}
 */
export function validateAiResponse(schemaKey, payload) {
  const schema = AI_SCHEMAS[schemaKey];
  if (!schema) {
    return {
      ok: false,
      value: payload,
      errors: [{ path: ['__schema'], message: `Unknown schemaKey: ${schemaKey}` }],
    };
  }

  const { error, value } = schema.validate(payload, {
    abortEarly: false,
    convert: true,
    allowUnknown: true,
  });

  const errors = [];
  if (error) {
    for (const d of error.details) errors.push({ path: d.path, message: d.message });
  }

  // Cross-field sanity check (chỉ chạy khi Joi base structure OK để có value clean).
  const extra = EXTRA_VALIDATORS[schemaKey];
  if (!error && typeof extra === 'function') {
    const extraErrs = extra(value);
    for (const e of extraErrs) errors.push(e);
  }

  if (errors.length > 0) {
    console.warn(
      `[AI schema reject] ${schemaKey}:`,
      errors.slice(0, 3).map(e => `${e.path.join('.')}: ${e.message}`).join(' | ')
    );
    return { ok: false, value: payload, errors };
  }

  return { ok: true, value, errors: null };
}

export default {
  AI_SCHEMAS,
  validateAiResponse,
  signalSchema,
  sltpSchema,
  reviewSchema,
  trendSchema,
  evaluateRiskSchema,
  regimeSchema,
};
