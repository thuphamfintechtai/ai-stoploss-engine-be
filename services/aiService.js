/**
 * AI Service – Tích hợp Google Gemini cho các tính năng AI trading.
 * Sử dụng @google/generative-ai (đã có trong dependencies).
 */
import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// Timeout cho Gemini calls — fallback rule-based khi vượt quá
const GEMINI_TIMEOUT_MS = 5000;

let genAI = null;
let aiModel = null;

function getModel() {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY chưa được cấu hình trong biến môi trường');
  }
  if (!genAI) {
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  }
  if (!aiModel) {
    aiModel = genAI.getGenerativeModel({ model: MODEL_NAME });
  }
  return aiModel;
}

/**
 * Gọi Gemini và trả về JSON đã parse.
 * Prompt phải yêu cầu AI trả JSON thuần (không có markdown fence).
 * Có timeout 5 giây — throw Error('Gemini timeout after 5s') để callers có thể catch và fallback.
 */
export async function callGeminiJSON(prompt) {
  const model = getModel();

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Gemini timeout after 5s')), GEMINI_TIMEOUT_MS)
  );

  const result = await Promise.race([model.generateContent(prompt), timeoutPromise]);
  const text = result.response.text().trim();

  // Strip markdown code fences nếu có
  let clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  // Strip control characters (tab, vertical tab, form feed, etc.) mà JSON.parse không chấp nhận
  clean = clean.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // Tìm phần JSON trong response (từ { hoặc [ đến } hoặc ])
  const jsonMatch = clean.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) clean = jsonMatch[1];

  try {
    return JSON.parse(clean);
  } catch (parseErr) {
    console.error('[AI] JSON parse failed. Raw text (first 500 chars):', text.slice(0, 500));
    console.error('[AI] Clean text (first 500 chars):', clean.slice(0, 500));
    const err = new Error('AI trả về response không phải JSON hợp lệ');
    err.rawText = text;
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. GỢI Ý STOP LOSS & TAKE PROFIT (v2 — rule-based số, Gemini chỉ text)
// ─────────────────────────────────────────────────────────────────────────────

import { snapToTickSize } from './tickSizeEngine.js';

const DISCLAIMER_TEXT =
  'Đây là phân tích kỹ thuật tham khảo dựa trên ATR và vùng hỗ trợ/kháng cự. ' +
  'KHÔNG phải khuyến nghị đầu tư. Quyết định cuối cùng thuộc về nhà đầu tư.';

const MIN_CANDLES_FOR_AI = 14;

/**
 * Tính ATR (Average True Range) từ mảng OHLCV.
 */
function calcATR(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const trueRanges = candles.slice(1).map((c, i) => {
    const prev = candles[i];
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prev.close),
      Math.abs(c.low  - prev.close)
    );
  });
  return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

/**
 * Tìm swing lows (hỗ trợ) trong N nến gần nhất.
 */
function findSwingLows(candles, lookback = 20) {
  const recent = candles.slice(-lookback);
  const lows   = recent.map(c => c.low).filter(Boolean);
  if (lows.length === 0) return [];
  lows.sort((a, b) => a - b);
  return [...new Set(lows.slice(0, 3).map(v => Math.round(v)))];
}

/**
 * Tìm swing highs (kháng cự).
 */
function findSwingHighs(candles, lookback = 20) {
  const recent = candles.slice(-lookback);
  const highs  = recent.map(c => c.high).filter(Boolean);
  if (highs.length === 0) return [];
  highs.sort((a, b) => b - a);
  return [...new Set(highs.slice(0, 3).map(v => Math.round(v)))];
}

/**
 * Tính technical score (rule-based, KHÔNG dùng LLM).
 * Score 0-100, phản ánh tính hợp lý kỹ thuật của gợi ý.
 */
function calcTechnicalScore({ atr14, entryPrice, proposedSL, avgVolume20, currentVolume, daysOfData }) {
  let score = 50;
  const reasons = [];

  // ATR ratio: SL trong khoảng 1-3 ATR là hợp lý
  if (atr14 > 0 && proposedSL > 0 && entryPrice > 0) {
    const slDistance = Math.abs(entryPrice - proposedSL);
    const atrRatio   = slDistance / atr14;
    if (atrRatio >= 1.0 && atrRatio <= 3.0) {
      score += 15;
      reasons.push(`ATR ratio ${atrRatio.toFixed(1)}x (tốt)`);
    } else if (atrRatio < 0.5) {
      score -= 20;
      reasons.push(`ATR ratio ${atrRatio.toFixed(1)}x (SL quá hẹp)`);
    } else if (atrRatio > 5) {
      score -= 15;
      reasons.push(`ATR ratio ${atrRatio.toFixed(1)}x (SL quá rộng)`);
    } else {
      reasons.push(`ATR ratio ${atrRatio.toFixed(1)}x`);
    }
  }

  // Volume: tránh gợi ý trên CP illiquid
  if (avgVolume20 > 0 && currentVolume > 0) {
    const volRatio = currentVolume / avgVolume20;
    if (volRatio >= 0.5) {
      score += 5;
      reasons.push('Volume bình thường');
    } else {
      score -= 15;
      reasons.push(`Volume thấp (${(volRatio * 100).toFixed(0)}% TB 20 ngày)`);
    }
  }

  // Data quality
  if (daysOfData >= 60)      { score += 10; reasons.push(`${daysOfData} phiên data (đủ)`); }
  else if (daysOfData >= 30) { score += 5;  reasons.push(`${daysOfData} phiên data`); }
  else if (daysOfData < 14)  { score -= 20; reasons.push(`${daysOfData} phiên data (thiếu)`); }

  return {
    score:       Math.max(10, Math.min(90, Math.round(score))),
    label:       score >= 65 ? 'HOP_LY' : score >= 45 ? 'TRUNG_BINH' : 'YEU',
    methodology: reasons.join(', ') || 'Dựa trên ATR, volume, chất lượng dữ liệu',
  };
}

/**
 * Tạo fallback analysis text khi Gemini không khả dụng.
 */
function fallbackAnalysisText(symbol, atr14, supports) {
  const supportStr = supports.length > 0
    ? `vùng hỗ trợ gần nhất tại ${supports[0].toLocaleString('vi-VN')}đ`
    : 'chưa xác định vùng hỗ trợ rõ ràng';
  const atrStr = atr14 > 0
    ? `ATR 14 phiên: ${Math.round(atr14).toLocaleString('vi-VN')}đ`
    : '';
  return `${symbol}: ${atrStr}${atrStr && supportStr ? ', ' : ''}${supportStr}. Gợi ý dựa trên phân tích kỹ thuật tự động.`;
}

/**
 * Hàm chính: Gợi ý SL/TP.
 * STEP 1: Rule engine tính số (ATR-based).
 * STEP 2: Gemini chỉ viết text giải thích (không tính số).
 */
export async function suggestStopLossTakeProfit({
  symbol, exchange, currentPrice, ohlcvData = [],
  rrRatio = 2, side = 'LONG',
}) {
  // ── Data quality gate ──────────────────────────────────────────────────────
  if (ohlcvData.length < MIN_CANDLES_FOR_AI) {
    return {
      data_insufficient: true,
      available_days:    ohlcvData.length,
      min_required:      MIN_CANDLES_FOR_AI,
      message:           `Không đủ dữ liệu lịch sử (${ohlcvData.length}/${MIN_CANDLES_FOR_AI} phiên). Không thể tính ATR.`,
      disclaimer:        DISCLAIMER_TEXT,
    };
  }

  const candles = ohlcvData.slice(-50);

  // ── STEP 1: Rule Engine — tính SL/TP bằng ATR (không AI) ──────────────────
  const atr14      = calcATR(candles, 14) ?? 0;
  const supports   = findSwingLows(candles, 20);
  const resistances = findSwingHighs(candles, 20);
  const avgVol20   = candles.length >= 20
    ? candles.slice(-20).reduce((s, c) => s + (c.volume || 0), 0) / 20
    : 0;
  const curVol     = candles[candles.length - 1]?.volume ?? 0;

  // 3 mức dựa trên ATR multiplier
  const multipliers = { aggressive: 1.0, moderate: 1.5, conservative: 2.0 };
  const suggestions = Object.entries(multipliers).map(([type, mult]) => {
    let slRaw, tpRaw;
    if (side === 'LONG') {
      slRaw = currentPrice - atr14 * mult;
      tpRaw = currentPrice + atr14 * mult * rrRatio;
    } else {
      slRaw = currentPrice + atr14 * mult;
      tpRaw = currentPrice - atr14 * mult * rrRatio;
    }

    const stop_loss_vnd    = snapToTickSize(Math.max(100, Math.round(slRaw)), exchange);
    const take_profit_vnd  = snapToTickSize(Math.max(100, Math.round(tpRaw)), exchange);
    const slDist           = Math.abs(currentPrice - stop_loss_vnd);
    const tpDist           = Math.abs(take_profit_vnd - currentPrice);
    const actualRR         = slDist > 0 ? tpDist / slDist : 0;

    return {
      type,
      label: type === 'aggressive' ? 'Tích cực' : type === 'moderate' ? 'Cân bằng' : 'Thận trọng',
      stop_loss_vnd,
      take_profit_vnd,
      stop_loss_pct:    ((slDist / currentPrice) * 100).toFixed(2),
      take_profit_pct:  ((tpDist / currentPrice) * 100).toFixed(2),
      rr_ratio:         parseFloat(actualRR.toFixed(2)),
      // KHÔNG có confidence field — đã bỏ hoàn toàn
    };
  });

  // ── Technical score (rule-based) ──────────────────────────────────────────
  const techScore = calcTechnicalScore({
    atr14,
    entryPrice:   currentPrice,
    proposedSL:   suggestions[1].stop_loss_vnd, // moderate
    avgVolume20:  avgVol20,
    currentVolume: curVol,
    daysOfData:   candles.length,
  });

  // ── STEP 2: Gemini chỉ viết text giải thích ───────────────────────────────
  let analysisText = '';
  const inferenceStart = Date.now();
  let inferenceStatus  = 'SUCCESS';

  try {
    const prompt =
      `Bạn là chuyên gia phân tích kỹ thuật chứng khoán Việt Nam. ` +
      `Viết 2-3 câu mô tả NGẮN GỌN bối cảnh kỹ thuật ngắn hạn của ${symbol} (${exchange}) ` +
      `dựa trên dữ liệu sau:\n` +
      `- Giá hiện tại: ${currentPrice.toLocaleString('vi-VN')}đ\n` +
      `- ATR 14 phiên: ${Math.round(atr14).toLocaleString('vi-VN')}đ\n` +
      `- Vùng hỗ trợ gần: ${supports.slice(0,2).map(v => v.toLocaleString('vi-VN')).join(', ') || 'N/A'}đ\n` +
      `- Vùng kháng cự gần: ${resistances.slice(0,2).map(v => v.toLocaleString('vi-VN')).join(', ') || 'N/A'}đ\n` +
      `KHÔNG đề xuất giá mua/bán cụ thể. KHÔNG dự báo xu hướng chắc chắn. Chỉ mô tả bối cảnh.`;

    const model  = getModel();
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10_000)),
    ]);
    analysisText = result.response.text().trim().replace(/[*#_`]/g, ''); // strip markdown
  } catch (err) {
    inferenceStatus = err.message === 'timeout' ? 'TIMEOUT' : 'ERROR';
    analysisText    = fallbackAnalysisText(symbol, atr14, supports);
    console.warn(`[AI] Gemini text generation failed (${inferenceStatus}): ${err.message}`);
  }

  return {
    suggestions,
    technical_score: techScore,
    key_levels: {
      support:    supports,
      resistance: resistances,
      atr_14:     Math.round(atr14),
    },
    analysis_text:    analysisText,
    disclaimer:       DISCLAIMER_TEXT,
    data_quality: {
      days_available: candles.length,
      is_sufficient:  true,
    },
    _inference: { status: inferenceStatus, latency_ms: Date.now() - inferenceStart },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PHÂN TÍCH XU HƯỚNG THỊ TRƯỜNG
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Phân tích xu hướng thị trường cho một mã chứng khoán.
 *
 * @param {object} params
 * @param {string} params.symbol - Mã CK
 * @param {string} params.exchange - Sàn
 * @param {Array}  params.ohlcvData - Dữ liệu OHLCV
 * @param {object} [params.indicators] - Các chỉ báo kỹ thuật (nếu có)
 * @returns {Promise<object>} Phân tích xu hướng
 */
export async function analyzeTrend({ symbol, exchange, ohlcvData = [], indicators = {} }) {
  if (ohlcvData.length < 5) {
    return {
      trend: 'UNKNOWN',
      strength: 0,
      analysis: 'Không đủ dữ liệu để phân tích xu hướng',
      signals: [],
      summary: 'Cần ít nhất 5 nến để phân tích'
    };
  }

  const recentCandles = ohlcvData.slice(-50);

  // Tính MA20 và MA50 đơn giản
  const closes = recentCandles.map(c => c.close);
  const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const ma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : null;
  const currentClose = closes[closes.length - 1];
  const prevClose = closes[closes.length - 2];

  // Volume trung bình 20 nến
  const volumes = recentCandles.map(c => c.volume || 0);
  const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length);
  const lastVolume = volumes[volumes.length - 1];
  const volumeRatio = avgVolume20 > 0 ? lastVolume / avgVolume20 : 1;

  // Biến động giá 5 nến gần nhất
  const recent5 = recentCandles.slice(-5);
  const priceChange5 = recent5.length > 1
    ? ((recent5[recent5.length - 1].close - recent5[0].open) / recent5[0].open) * 100
    : 0;

  const prompt = `Bạn là chuyên gia phân tích kỹ thuật chứng khoán Việt Nam (HOSE, HNX, UPCOM).
Hãy phân tích xu hướng cho mã ${symbol} (${exchange}).

Dữ liệu thống kê:
- Giá đóng cửa hiện tại: ${currentClose ? currentClose.toLocaleString('vi-VN') : 'N/A'} VND
- Giá đóng cửa phiên trước: ${prevClose ? prevClose.toLocaleString('vi-VN') : 'N/A'} VND
- MA20: ${ma20 ? Math.round(ma20).toLocaleString('vi-VN') : 'Không đủ dữ liệu'} VND
- MA50: ${ma50 ? Math.round(ma50).toLocaleString('vi-VN') : 'Không đủ dữ liệu'} VND
- Biến động giá 5 phiên: ${priceChange5.toFixed(2)}%
- Khối lượng hiện tại vs trung bình: ${(volumeRatio * 100).toFixed(0)}%
${indicators.rsi ? `- RSI: ${indicators.rsi}` : ''}
${indicators.macd ? `- MACD: ${JSON.stringify(indicators.macd)}` : ''}

Dữ liệu nến gần nhất (tối đa 20 nến cuối, format [open,high,low,close,vol]):
${JSON.stringify(recentCandles.slice(-20).map(c => [c.open, c.high, c.low, c.close, c.volume || 0]))}

Hãy phân tích và trả về JSON (không có markdown fence):
{
  "trend": "BULLISH" | "BEARISH" | "SIDEWAYS",
  "strength": <0-100, độ mạnh xu hướng>,
  "timeframe": "short" | "medium" | "long",
  "analysis": "<phân tích chi tiết bằng tiếng Việt, 3-5 câu>",
  "signals": [
    {
      "type": "BUY" | "SELL" | "NEUTRAL",
      "indicator": "<tên chỉ báo>",
      "message": "<mô tả tín hiệu>"
    }
  ],
  "key_levels": {
    "support": [<mức hỗ trợ 1>, <mức hỗ trợ 2>],
    "resistance": [<mức kháng cự 1>, <mức kháng cự 2>]
  },
  "volume_analysis": "<nhận xét khối lượng>",
  "recommendation": "BUY" | "SELL" | "HOLD" | "WATCH",
  "summary": "<tóm tắt 1 câu>"
}`;

  try {
    const result = await callGeminiJSON(prompt);
    return { ...result, ai_source: 'gemini' };
  } catch (_err) {
    console.warn('[AI] analyzeTrend Gemini fallback:', _err.message);
    return {
      trend: 'UNKNOWN',
      strength: 50,
      analysis: 'Phân tích tự động không khả dụng. Vui lòng kiểm tra lại sau.',
      signals: [],
      summary: 'Không thể kết nối AI. Dữ liệu kỹ thuật vẫn khả dụng.',
      ai_source: 'rule-based',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ĐÁNH GIÁ MỨC ĐỘ RỦI RO GIAO DỊCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Đánh giá mức độ rủi ro của một giao dịch cụ thể.
 *
 * @param {object} params
 * @param {string} params.symbol
 * @param {string} params.exchange
 * @param {number} params.entryPrice - Giá vào (VND)
 * @param {number} params.stopLoss - Mức dừng lỗ (VND)
 * @param {number} [params.takeProfit] - Mục tiêu lợi nhuận (VND)
 * @param {number} params.quantity - Số lượng cổ phiếu
 * @param {object} params.portfolioData - Dữ liệu portfolio { totalBalance, maxRiskPercent, currentRiskVND, maxRiskVND }
 * @param {Array}  [params.ohlcvData] - Dữ liệu giá lịch sử
 * @returns {Promise<object>} Đánh giá rủi ro
 */
export async function evaluateTradeRisk({ symbol, exchange, entryPrice, stopLoss, takeProfit, quantity, portfolioData = {}, ohlcvData = [] }) {
  const riskPerShare = Math.abs(entryPrice - stopLoss);
  const riskVND = riskPerShare * quantity;
  const totalValue = entryPrice * quantity;
  const riskPercent = totalValue > 0 ? (riskVND / totalValue) * 100 : 0;

  const { totalBalance = 0, maxRiskPercent = 2, currentRiskVND = 0, maxRiskVND = 0 } = portfolioData;
  const newTotalRisk = currentRiskVND + riskVND;
  const portfolioRiskUsage = maxRiskVND > 0 ? (newTotalRisk / maxRiskVND) * 100 : 0;
  const riskToBalance = totalBalance > 0 ? (riskVND / totalBalance) * 100 : 0;

  const rrRatio = takeProfit ? Math.abs(takeProfit - entryPrice) / riskPerShare : null;

  // Phân tích biến động lịch sử
  const recentCandles = ohlcvData.slice(-20);
  const volatility = recentCandles.length > 1
    ? recentCandles.map((c, i) => i > 0 ? Math.abs((c.close - recentCandles[i - 1].close) / recentCandles[i - 1].close) * 100 : 0)
      .slice(1).reduce((a, b) => a + b, 0) / (recentCandles.length - 1)
    : null;

  const prompt = `Bạn là chuyên gia quản lý rủi ro tài chính chứng khoán Việt Nam. Đánh giá rủi ro giao dịch sau:

Thông tin giao dịch:
- Mã: ${symbol} (${exchange})
- Giá vào lệnh: ${entryPrice.toLocaleString('vi-VN')} VND
- Dừng lỗ (Stop Loss): ${stopLoss.toLocaleString('vi-VN')} VND
- Chốt lời (Take Profit): ${takeProfit ? takeProfit.toLocaleString('vi-VN') + ' VND' : 'Chưa đặt'}
- Số lượng: ${quantity.toLocaleString('vi-VN')} cổ phiếu
- Giá trị giao dịch: ${totalValue.toLocaleString('vi-VN')} VND
- Rủi ro tuyệt đối: ${Math.round(riskVND).toLocaleString('vi-VN')} VND
- Rủi ro / giá trị GD: ${riskPercent.toFixed(2)}%
- Tỷ lệ R:R: ${rrRatio ? '1:' + rrRatio.toFixed(2) : 'Chưa đặt TP'}

Portfolio:
- Tổng vốn: ${totalBalance.toLocaleString('vi-VN')} VND
- Hạn mức rủi ro tối đa: ${maxRiskPercent}% → ${Math.round(maxRiskVND).toLocaleString('vi-VN')} VND
- Rủi ro đang dùng: ${Math.round(currentRiskVND).toLocaleString('vi-VN')} VND
- Rủi ro sau khi mở lệnh: ${Math.round(newTotalRisk).toLocaleString('vi-VN')} VND (${portfolioRiskUsage.toFixed(1)}% hạn mức)
- Rủi ro lệnh này / tổng vốn: ${riskToBalance.toFixed(2)}%
${volatility !== null ? `- Biến động giá TB ngày: ${volatility.toFixed(2)}%` : ''}

Hãy đánh giá rủi ro toàn diện và trả về JSON (không có markdown fence):
{
  "risk_level": "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH",
  "risk_score": <0-100, điểm rủi ro tổng thể>,
  "verdict": "APPROVED" | "CAUTION" | "WARNING" | "REJECTED",
  "factors": [
    {
      "name": "<tên yếu tố rủi ro>",
      "level": "LOW" | "MEDIUM" | "HIGH",
      "description": "<giải thích>"
    }
  ],
  "strengths": ["<điểm mạnh của giao dịch>"],
  "weaknesses": ["<điểm yếu / rủi ro>"],
  "recommendations": ["<khuyến nghị cụ thể>"],
  "position_sizing": {
    "current_quantity": ${quantity},
    "suggested_max_quantity": <số lượng tối đa nên mua>,
    "reasoning": "<giải thích>"
  },
  "summary": "<tóm tắt đánh giá 2-3 câu tiếng Việt>"
}`;

  try {
    const result = await callGeminiJSON(prompt);
    return { ...result, ai_source: 'gemini' };
  } catch (_err) {
    console.warn('[AI] evaluateTradeRisk Gemini fallback:', _err.message);
    return {
      recommendation: 'HOLD',
      confidence: 0.5,
      reasoning: 'Phân tích tự động không khả dụng. Vui lòng kiểm tra lại sau.',
      ai_source: 'rule-based',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. TẠO CẢNH BÁO THÔNG MINH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tạo cảnh báo thông minh cho danh sách vị thế đang mở.
 *
 * @param {Array} positions - Danh sách vị thế [{ id, symbol, exchange, entry_price, stop_loss, take_profit, quantity }]
 * @param {object} currentPrices - Map { symbol: priceVND }
 * @returns {Promise<Array>} Danh sách cảnh báo
 */
export async function generateSmartAlerts(positions, currentPrices = {}) {
  const alerts = [];

  for (const pos of positions) {
    const currentPrice = currentPrices[pos.symbol];
    if (!currentPrice) continue;

    const entry = parseFloat(pos.entry_price);
    const sl = parseFloat(pos.stop_loss);
    const tp = pos.take_profit ? parseFloat(pos.take_profit) : null;
    const isLong = (pos.side || 'LONG') === 'LONG';

    // Tính % khoảng cách đến SL và TP
    const distToSL = isLong
      ? ((currentPrice - sl) / (entry - sl)) * 100
      : ((sl - currentPrice) / (sl - entry)) * 100;

    const distToTP = tp
      ? (isLong
        ? ((tp - currentPrice) / (tp - entry)) * 100
        : ((currentPrice - tp) / (entry - tp)) * 100)
      : null;

    const pnlPercent = isLong
      ? ((currentPrice - entry) / entry) * 100
      : ((entry - currentPrice) / entry) * 100;

    // Cảnh báo giá tiếp cận SL (< 20% khoảng cách còn lại)
    if (distToSL < 20 && distToSL >= 0) {
      alerts.push({
        position_id: pos.id,
        symbol: pos.symbol,
        type: 'SL_APPROACHING',
        severity: distToSL < 10 ? 'ERROR' : 'WARNING',
        title: `⚠️ ${pos.symbol}: Giá đang tiếp cận Stop Loss`,
        message: `Giá hiện tại ${currentPrice.toLocaleString('vi-VN')} VND chỉ còn cách SL ${distToSL.toFixed(1)}%. SL tại ${sl.toLocaleString('vi-VN')} VND.`,
        metadata: { currentPrice, stopLoss: sl, distancePercent: distToSL, pnlPercent }
      });
    }

    // Cảnh báo giá tiếp cận TP (< 10% khoảng cách còn lại)
    if (distToTP !== null && distToTP < 10 && distToTP >= 0) {
      alerts.push({
        position_id: pos.id,
        symbol: pos.symbol,
        type: 'TP_APPROACHING',
        severity: 'INFO',
        title: `🎯 ${pos.symbol}: Sắp đạt mục tiêu Take Profit`,
        message: `Giá hiện tại ${currentPrice.toLocaleString('vi-VN')} VND gần đạt TP ${tp.toLocaleString('vi-VN')} VND (còn ${distToTP.toFixed(1)}%). Cân nhắc chốt lời.`,
        metadata: { currentPrice, takeProfit: tp, distancePercent: distToTP, pnlPercent }
      });
    }

    // Cảnh báo P&L âm lớn (>50% rủi ro đã thực hiện)
    if (pnlPercent < -3) {
      alerts.push({
        position_id: pos.id,
        symbol: pos.symbol,
        type: 'HIGH_LOSS',
        severity: 'WARNING',
        title: `📉 ${pos.symbol}: Lỗ ${Math.abs(pnlPercent).toFixed(1)}%`,
        message: `Vị thế đang lỗ ${Math.abs(pnlPercent).toFixed(2)}%. Giá vào: ${entry.toLocaleString('vi-VN')}, Giá hiện tại: ${currentPrice.toLocaleString('vi-VN')} VND.`,
        metadata: { currentPrice, entryPrice: entry, pnlPercent }
      });
    }
  }

  return alerts;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. TẠO TÍN HIỆU AI (AI SIGNAL)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI tạo tín hiệu giao dịch cho một mã cổ phiếu.
 *
 * @param {object} params
 * @param {string} params.symbol
 * @param {string} params.exchange
 * @param {number} params.currentPrice
 * @param {Array}  params.ohlcvData
 * @param {object} [params.companyInfo] - Thông tin công ty (tùy chọn)
 * @returns {Promise<object>} Tín hiệu giao dịch
 */
export async function generateSignal({ symbol, exchange, currentPrice, ohlcvData = [], companyInfo = null }) {
  const recentCandles = ohlcvData.slice(-30);
  const closes = recentCandles.map(c => c.close);
  const highs = recentCandles.map(c => c.high);
  const lows = recentCandles.map(c => c.low);
  const volumes = recentCandles.map(c => c.volume || 0);

  const ma10 = closes.length >= 10 ? closes.slice(-10).reduce((a, b) => a + b, 0) / 10 : null;
  const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const recentHigh = highs.length > 0 ? Math.max(...highs.slice(-10)) : null;
  const recentLow = lows.length > 0 ? Math.min(...lows.slice(-10)) : null;
  const avgVolume = volumes.length > 0 ? volumes.slice(-10).reduce((a, b) => a + b, 0) / 10 : null;
  const lastVolume = volumes[volumes.length - 1];

  const prompt = `Bạn là AI trading chuyên phân tích chứng khoán Việt Nam. Hãy tạo tín hiệu giao dịch cho mã ${symbol}.

Thông tin thị trường:
- Mã: ${symbol} (${exchange})
- Giá hiện tại: ${currentPrice.toLocaleString('vi-VN')} VND
- MA10: ${ma10 ? Math.round(ma10).toLocaleString('vi-VN') : 'N/A'} VND
- MA20: ${ma20 ? Math.round(ma20).toLocaleString('vi-VN') : 'N/A'} VND
- Đỉnh 10 phiên: ${recentHigh ? Math.round(recentHigh).toLocaleString('vi-VN') : 'N/A'} VND
- Đáy 10 phiên: ${recentLow ? Math.round(recentLow).toLocaleString('vi-VN') : 'N/A'} VND
- KL hiện tại vs TB: ${avgVolume && lastVolume ? (lastVolume / avgVolume * 100).toFixed(0) + '%' : 'N/A'}
${companyInfo ? `- Ngành: ${companyInfo.industry || 'N/A'}` : ''}

Dữ liệu nến gần nhất (20 nến, format [O,H,L,C,V]):
${JSON.stringify(recentCandles.slice(-20).map(c => [c.open, c.high, c.low, c.close, c.volume || 0]))}

Trả về JSON tín hiệu giao dịch (không có markdown fence):
{
  "action": "BUY" | "SELL" | "HOLD",
  "entry_price": <giá vào lệnh đề xuất, VND>,
  "stop_loss": <mức SL đề xuất, VND>,
  "take_profit": <mức TP đề xuất, VND>,
  "confidence_score": <độ tin cậy 0-100>,
  "timeframe": "short" | "medium" | "long",
  "reason": "<lý do tín hiệu, 2-3 câu tiếng Việt>",
  "technical_context": {
    "trend": "BULLISH" | "BEARISH" | "SIDEWAYS",
    "momentum": "STRONG" | "MODERATE" | "WEAK",
    "volume_confirmation": true | false,
    "key_pattern": "<mẫu hình kỹ thuật nếu có>"
  },
  "risk_level": "LOW" | "MEDIUM" | "HIGH",
  "expiry_hours": <số giờ tín hiệu còn hiệu lực, 4-72>
}`;

  try {
    const result = await callGeminiJSON(prompt);
    return { ...result, ai_source: 'gemini' };
  } catch (_err) {
    console.warn('[AI] generateSignal Gemini fallback:', _err.message);
    return {
      recommendation: 'HOLD',
      confidence: 0.5,
      reasoning: 'Phân tích tự động không khả dụng. Vui lòng kiểm tra lại sau.',
      ai_source: 'rule-based',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. TÓM TẮT DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tạo tóm tắt thị trường cho dashboard từ dữ liệu tổng hợp.
 *
 * @param {object} params
 * @param {object} params.portfolioStats - Thống kê portfolio
 * @param {Array}  params.openPositions - Vị thế đang mở
 * @param {object} params.marketOverview - Tổng quan thị trường
 * @returns {Promise<object>} Tóm tắt thị trường
 */
export async function generateMarketSummary({ portfolioStats, openPositions = [], marketOverview = {} }) {
  const { vnindexChange, vn30Change, totalVolume } = marketOverview;
  const { totalBalance, currentRiskPercent, openCount, totalPnl } = portfolioStats;

  const positionsSummary = openPositions.slice(0, 5).map(p => ({
    symbol: p.symbol,
    pnl_percent: p.pnl_percent,
    status: p.status
  }));

  const prompt = `Bạn là AI phân tích thị trường chứng khoán Việt Nam. Tóm tắt tình hình thị trường và danh mục đầu tư.

Thị trường hôm nay:
- VNINDEX: ${vnindexChange !== undefined ? (vnindexChange > 0 ? '+' : '') + vnindexChange + '%' : 'N/A'}
- VN30: ${vn30Change !== undefined ? (vn30Change > 0 ? '+' : '') + vn30Change + '%' : 'N/A'}
- Tổng KLGD: ${totalVolume ? totalVolume.toLocaleString('vi-VN') : 'N/A'}

Danh mục đầu tư:
- Tổng vốn: ${totalBalance ? totalBalance.toLocaleString('vi-VN') + ' VND' : 'N/A'}
- Tỷ lệ rủi ro hiện tại: ${currentRiskPercent || 0}%
- Số vị thế đang mở: ${openCount || 0}
- P&L tổng: ${totalPnl ? totalPnl.toLocaleString('vi-VN') + ' VND' : 'N/A'}
- Vị thế tiêu biểu: ${JSON.stringify(positionsSummary)}

Trả về JSON (không có markdown fence):
{
  "market_sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "sentiment_score": <-100 đến 100>,
  "market_summary": "<tóm tắt thị trường 2-3 câu>",
  "portfolio_health": "EXCELLENT" | "GOOD" | "FAIR" | "POOR",
  "portfolio_advice": "<lời khuyên cho danh mục 1-2 câu>",
  "watch_list_suggestions": ["<mã CK đáng chú ý>"],
  "risk_warnings": ["<cảnh báo rủi ro nếu có>"],
  "opportunities": ["<cơ hội đầu tư ngắn hạn nếu có>"]
}`;

  try {
    const result = await callGeminiJSON(prompt);
    return { ...result, ai_source: 'gemini' };
  } catch (_err) {
    console.warn('[AI] generateMarketSummary Gemini fallback:', _err.message);
    return {
      market_sentiment: 'NEUTRAL',
      sentiment_score: 0,
      market_summary: 'Tóm tắt thị trường không khả dụng. Vui lòng kiểm tra lại sau.',
      portfolio_health: 'FAIR',
      portfolio_advice: 'Duy trì quản lý rủi ro thủ công trong thời gian AI không khả dụng.',
      watch_list_suggestions: [],
      risk_warnings: [],
      opportunities: [],
      ai_source: 'rule-based',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. REVIEW VỊ THẾ ĐANG MỞ – ĐỀ XUẤT ĐIỀU CHỈNH SL/TP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI review tất cả vị thế đang mở và đề xuất hành động (giữ, kéo SL, chốt một phần, đóng).
 *
 * @param {object} params
 * @param {Array}  params.positions    - Danh sách vị thế từ DB
 * @param {object} params.currentPrices - { symbol: priceVND }
 * @returns {Promise<Array>} Danh sách khuyến nghị
 */
export async function reviewOpenPositions({ positions, currentPrices }) {
  if (!positions || positions.length === 0) return [];

  const positionDetails = positions.map(pos => {
    const currentPrice = currentPrices[pos.symbol];
    const entry = parseFloat(pos.entry_price);
    const sl = parseFloat(pos.stop_loss);
    const tp = pos.take_profit ? parseFloat(pos.take_profit) : null;
    const qty = parseFloat(pos.quantity);
    const isLong = (pos.side || 'LONG') === 'LONG';

    const pnlPercent = currentPrice
      ? (isLong ? ((currentPrice - entry) / entry) * 100 : ((entry - currentPrice) / entry) * 100)
      : 0;

    const distToSLPercent = currentPrice && (entry - sl) !== 0
      ? (isLong
        ? ((currentPrice - sl) / Math.abs(entry - sl)) * 100
        : ((sl - currentPrice) / Math.abs(sl - entry)) * 100)
      : null;

    const distToTPPercent = currentPrice && tp && (tp - entry) !== 0
      ? (isLong
        ? ((tp - currentPrice) / Math.abs(tp - entry)) * 100
        : ((currentPrice - tp) / Math.abs(entry - tp)) * 100)
      : null;

    return {
      position_id: pos.id,
      symbol: pos.symbol,
      exchange: pos.exchange || 'HOSE',
      side: pos.side || 'LONG',
      entry_price: entry,
      stop_loss: sl,
      take_profit: tp,
      quantity: qty,
      current_price: currentPrice || null,
      pnl_percent: parseFloat(pnlPercent.toFixed(2)),
      dist_to_sl_percent: distToSLPercent !== null ? parseFloat(distToSLPercent.toFixed(1)) : null,
      dist_to_tp_percent: distToTPPercent !== null ? parseFloat(distToTPPercent.toFixed(1)) : null,
      stop_type: pos.stop_type || 'FIXED',
      trailing_current_stop: pos.trailing_current_stop ? parseFloat(pos.trailing_current_stop) : null
    };
  }).filter(p => p.current_price != null);

  if (positionDetails.length === 0) return [];

  const prompt = `Bạn là chuyên gia quản lý rủi ro và giao dịch chứng khoán Việt Nam với 20 năm kinh nghiệm. Review các vị thế đang mở và đưa ra khuyến nghị hành động cụ thể.

Danh sách vị thế cần review:
${JSON.stringify(positionDetails, null, 2)}

Quy tắc đánh giá:
- dist_to_sl_percent < 15%: vị thế nguy hiểm, ưu tiên EXIT hoặc điều chỉnh khẩn
- pnl_percent > 3% VÀ dist_to_sl_percent > 50%: nên TIGHTEN_SL để bảo vệ lợi nhuận
- pnl_percent > 5% VÀ dist_to_tp_percent < 25%: cân nhắc TAKE_PARTIAL chốt một phần
- pnl_percent < -5%: rủi ro cao, cân nhắc EXIT nếu không còn cơ sở kỹ thuật
- Tất cả mức giá tính bằng VND (ví dụ: 50000 = 50,000 VND = 50 nghìn đồng)

Trả về JSON array (không markdown fence):
[
  {
    "position_id": "<id>",
    "symbol": "<mã CK>",
    "action": "HOLD" | "TIGHTEN_SL" | "TAKE_PARTIAL" | "EXIT",
    "new_stop_loss": <giá VND mới hoặc null>,
    "new_take_profit": <giá VND mới hoặc null>,
    "reasoning": "<lý do cụ thể 1-2 câu tiếng Việt>",
    "urgency": "LOW" | "MEDIUM" | "HIGH",
    "key_concern": "<rủi ro hoặc cơ hội chính>"
  }
]`;

  try {
    const result = await callGeminiJSON(prompt);
    const arr = Array.isArray(result) ? result : (result ? [result] : []);
    return arr.map(item => ({ ...item, ai_source: 'gemini' }));
  } catch (_err) {
    console.warn('[AI] reviewOpenPositions Gemini fallback:', _err.message);
    return positionDetails.map(pos => ({
      position_id: pos.position_id,
      symbol: pos.symbol,
      action: 'HOLD',
      new_stop_loss: null,
      new_take_profit: null,
      reasoning: 'Phân tích tự động không khả dụng. Vui lòng kiểm tra lại sau.',
      urgency: 'LOW',
      key_concern: 'AI không khả dụng',
      ai_source: 'rule-based',
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. PHÁT HIỆN CHẾ ĐỘ THỊ TRƯỜNG (MARKET REGIME DETECTION)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * AI phát hiện chế độ thị trường từ dữ liệu VNINDEX và market breadth.
 *
 * @param {object} params
 * @param {Array}  params.vnindexData   - Dữ liệu OHLCV VNINDEX
 * @param {object} params.marketBreadth - { advancing, declining, unchanged }
 * @returns {Promise<object>} Chế độ thị trường và chiến lược
 */
export async function detectMarketRegime({ vnindexData = [], marketBreadth = {} }) {
  const closes = vnindexData.map(c => c.close ?? c.c ?? 0).filter(Boolean);
  const recent20 = vnindexData.slice(-20);

  const ma20 = closes.length >= 20 ? closes.slice(-20).reduce((a, b) => a + b, 0) / 20 : null;
  const ma5  = closes.length >= 5  ? closes.slice(-5).reduce((a, b) => a + b, 0) / 5  : null;
  const currentClose = closes[closes.length - 1];

  // Tính ATR 14 phiên
  let atr = null;
  if (recent20.length >= 14) {
    const trs = recent20.slice(1).map((c, i) => {
      const prev = recent20[i];
      const h = c.high ?? c.h ?? c.close ?? c.c ?? 0;
      const l = c.low  ?? c.l ?? c.close ?? c.c ?? 0;
      const pc = prev.close ?? prev.c ?? 0;
      return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
    });
    atr = trs.slice(-14).reduce((a, b) => a + b, 0) / 14;
  }

  const priceChange5  = closes.length >= 5  ? ((currentClose - closes[closes.length - 5])  / closes[closes.length - 5])  * 100 : 0;
  const priceChange20 = closes.length >= 20 ? ((currentClose - closes[closes.length - 20]) / closes[closes.length - 20]) * 100 : 0;

  const { advancing = 0, declining = 0, unchanged = 0 } = marketBreadth;
  const total = advancing + declining + unchanged;
  const advDeclineRatio = declining > 0 ? (advancing / declining).toFixed(2) : (advancing > 0 ? '>5' : '1');

  const prompt = `Bạn là chuyên gia phân tích vĩ mô thị trường chứng khoán Việt Nam. Xác định chế độ thị trường hiện tại và đưa ra chiến lược giao dịch phù hợp.

Dữ liệu VNINDEX:
- Điểm hiện tại: ${currentClose ? currentClose.toFixed(2) : 'N/A'}
- MA5: ${ma5 ? ma5.toFixed(2) : 'N/A'} | MA20: ${ma20 ? ma20.toFixed(2) : 'N/A'}
- Biến động 5 phiên: ${priceChange5.toFixed(2)}%
- Biến động 20 phiên: ${priceChange20.toFixed(2)}%
- ATR (biến động bình quân/phiên): ${atr ? atr.toFixed(2) : 'N/A'} điểm
${total > 0 ? `
Độ rộng thị trường:
- Số mã tăng: ${advancing} | Số mã giảm: ${declining} | Không đổi: ${unchanged}
- Tỷ lệ A/D: ${advDeclineRatio}` : ''}

Dữ liệu 10 phiên gần nhất (O,H,L,C):
${JSON.stringify(vnindexData.slice(-10).map(c => ({
  o: (c.open??c.o??0).toFixed(2),
  h: (c.high??c.h??0).toFixed(2),
  l: (c.low??c.l??0).toFixed(2),
  c: (c.close??c.c??0).toFixed(2)
})))}

Trả về JSON (không markdown fence):
{
  "regime": "BULL" | "BEAR" | "SIDEWAYS" | "VOLATILE",
  "confidence": <0-100>,
  "description": "<mô tả 1 câu về trạng thái thị trường hiện tại>",
  "vnindex_outlook": "TÍCH CỰC" | "TIÊU CỰC" | "TRUNG LẬP",
  "recommendations": [
    "<chiến lược giao dịch phù hợp với chế độ thị trường 1>",
    "<khuyến nghị về quản lý rủi ro 2>",
    "<lưu ý đặc biệt 3>"
  ],
  "risk_level": "LOW" | "MEDIUM" | "HIGH" | "VERY_HIGH",
  "sector_focus": "<ngành/nhóm cổ phiếu nên tập trung>",
  "key_levels": {
    "support": <mức hỗ trợ VNINDEX gần nhất>,
    "resistance": <mức kháng cự VNINDEX gần nhất>
  },
  "market_bias": "<xu hướng ngắn hạn 5-10 phiên>"
}`;

  try {
    const result = await callGeminiJSON(prompt);
    return { ...result, ai_source: 'gemini' };
  } catch (_err) {
    console.warn('[AI] detectMarketRegime Gemini fallback:', _err.message);
    return {
      regime: 'SIDEWAYS',
      confidence: 50,
      description: 'Không thể xác định chế độ thị trường. AI không khả dụng.',
      vnindex_outlook: 'TRUNG LẬP',
      recommendations: ['Duy trì quản lý rủi ro thủ công.'],
      risk_level: 'MEDIUM',
      sector_focus: 'N/A',
      key_levels: { support: null, resistance: null },
      market_bias: 'Không xác định',
      ai_source: 'rule-based',
    };
  }
}

export default {
  suggestStopLossTakeProfit,
  analyzeTrend,
  evaluateTradeRisk,
  generateSmartAlerts,
  generateMarketSummary,
  reviewOpenPositions,
  detectMarketRegime
};
