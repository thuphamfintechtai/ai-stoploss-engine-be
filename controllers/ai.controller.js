/**
 * AI Controller – Các endpoint AI cho:
 * 1. Gợi ý Stop Loss & Take Profit
 * 2. Phân tích xu hướng thị trường
 * 3. Đánh giá rủi ro giao dịch
 * 4. Dashboard tổng hợp thị trường
 * 5. Tạo tín hiệu AI
 */
import Joi from 'joi';
import {
  suggestStopLossTakeProfit,
  analyzeTrend,
  evaluateTradeRisk,
  generateMarketSummary,
  reviewOpenPositions,
  detectMarketRegime
} from '../services/aiService.js';
import { calculateTPProbabilities } from '../services/ai/probabilityTP.js';
import { generateRebalancingSuggestions } from '../services/ai/rebalancingSuggestion.js';
import { calculateHalfKelly, getTradeStats, calculateRiskBudget } from '../services/ai/capitalAllocation.js';
import { calculateHistoricalVaR } from '../services/ai/varService.js';
import { runMonteCarloSimulation } from '../services/ai/monteCarloService.js';
import { calculateStressTest } from '../services/ai/stressTestService.js';
import { calculateSectorConcentration } from '../services/ai/sectorConcentration.js';
import { query } from '../config/database.js';
import RiskCalculator from '../services/riskCalculator.js';
import AiRecommendation from '../models/AiRecommendation.js';

// Memory cache cho market regime (tránh spam Gemini mỗi request)
let regimeCache = { data: null, timestamp: 0 };
const REGIME_CACHE_TTL = 15 * 60 * 1000; // 15 phút

const DB_SCHEMA = process.env.DB_SCHEMA || 'financial';
const VPBANK_BASE_URL = 'https://neopro.vpbanks.com.vn/neo-inv-tools/noauth/public/v1/stock';
const VPBS_PRICE_TO_VND = 1000;

const VPBANK_FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
  'Referer': 'https://neopro.vpbanks.com.vn/',
  'Origin': 'https://neopro.vpbanks.com.vn'
};

// ─── Helpers ───────────────────────────────────────────────────────────────

async function fetchOHLCV(symbol, exchange = 'HOSE', limit = 50) {
  try {
    const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
    const url = `${API_BASE}/api/market/symbols/${encodeURIComponent(symbol)}/ohlcv?timeframe=1d&limit=${limit}&exchange=${exchange}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json?.data || [];
  } catch {
    return [];
  }
}

async function fetchCurrentPriceVND(symbol, exchange = 'HOSE') {
  try {
    const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${API_BASE}/api/market/symbols/${encodeURIComponent(symbol)}/price?exchange=${exchange}`);
    if (!res.ok) return null;
    const json = await res.json();
    // /price endpoint trả thẳng VND, không nhân thêm
    const priceVND = json?.data?.price;
    return priceVND != null ? parseFloat(priceVND) : null;
  } catch {
    return null;
  }
}

// ─── Validation Schemas ─────────────────────────────────────────────────────

const suggestSLTPSchema = Joi.object({
  symbol: Joi.string().min(1).max(20).required(),
  exchange: Joi.string().valid('HOSE', 'HNX', 'UPCOM').default('HOSE'),
  current_price: Joi.number().positive().optional(),
  rr_ratio: Joi.number().min(0.5).max(10).default(2),
  side: Joi.string().valid('LONG', 'SHORT').default('LONG'),
  ohlcv_data: Joi.array().items(Joi.object()).optional(),
  // Thông tin vị thế của nhà đầu tư
  capital: Joi.number().positive().optional(),       // Vốn đầu tư (VND)
  risk_percent: Joi.number().min(0.1).max(50).optional(), // % rủi ro chấp nhận
  quantity: Joi.number().integer().min(1).optional() // Số cổ phiếu muốn mua
});

const analyzeTrendSchema = Joi.object({
  symbol: Joi.string().min(1).max(20).required(),
  exchange: Joi.string().valid('HOSE', 'HNX', 'UPCOM').default('HOSE'),
  ohlcv_data: Joi.array().items(Joi.object()).optional(),
  indicators: Joi.object().optional()
});

const evaluateRiskSchema = Joi.object({
  symbol: Joi.string().min(1).max(20).required(),
  exchange: Joi.string().valid('HOSE', 'HNX', 'UPCOM').default('HOSE'),
  portfolio_id: Joi.string().uuid().required(),
  entry_price: Joi.number().positive().required(),
  stop_loss: Joi.number().positive().required(),
  take_profit: Joi.number().positive().optional(),
  quantity: Joi.number().integer().min(1).required()
});


// ─── Controllers ────────────────────────────────────────────────────────────

/**
 * POST /api/ai/suggest-sltp
 * AI gợi ý Stop Loss và Take Profit
 */
export async function suggestSLTP(req, res, next) {
  try {
    const { error, value } = suggestSLTPSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { symbol, exchange, rr_ratio, side, capital, risk_percent, quantity } = value;

    // Lấy giá hiện tại nếu chưa có
    let currentPrice = value.current_price;
    if (!currentPrice) {
      currentPrice = await fetchCurrentPriceVND(symbol, exchange);
      if (!currentPrice) {
        return res.status(400).json({
          success: false,
          message: `Không lấy được giá hiện tại cho ${symbol}. Vui lòng nhập current_price thủ công.`
        });
      }
    }

    // Lấy OHLCV data nếu chưa có (limit=50 cho SL calculation)
    let ohlcvData = value.ohlcv_data;
    if (!ohlcvData || ohlcvData.length === 0) {
      ohlcvData = await fetchOHLCV(symbol, exchange, 50);
    }

    // Lấy OHLCV 200 ngày riêng để tính probability TP (D-10: cần 60-200 ngày)
    const ohlcvDataForTP = await fetchOHLCV(symbol, exchange, 200);
    const probabilityTP = calculateTPProbabilities(ohlcvDataForTP, currentPrice);

    const result = await suggestStopLossTakeProfit({
      symbol, exchange, currentPrice, ohlcvData, rrRatio: rr_ratio, side,
      capital, riskPercent: risk_percent, quantity
    });

    // Tính position sizing dựa trên mức SL được khuyến nghị
    let positionSizing = null;
    const recommended = result.recommended || 'moderate';
    const recSuggestion = Array.isArray(result.suggestions)
      ? (result.suggestions.find(s => s.type === recommended) || result.suggestions[0])
      : null;
    const slP = recSuggestion?.stop_loss;
    if (slP && currentPrice) {
      const riskPerShare = Math.abs(currentPrice - slP);
      if (riskPerShare > 0) {
        // Nếu có vốn + risk%
        if (capital && risk_percent) {
          const maxRiskVND = capital * (risk_percent / 100);
          const suggestedQty = Math.floor(maxRiskVND / riskPerShare / 100) * 100; // làm tròn lô 100
          const capitalRequired = suggestedQty * currentPrice;
          const actualRiskVND = suggestedQty * riskPerShare;
          const tpP = recSuggestion?.take_profit;
          const potentialProfit = tpP ? suggestedQty * Math.abs(tpP - currentPrice) : null;
          positionSizing = {
            suggested_quantity: suggestedQty,
            capital_required: capitalRequired,
            risk_amount_vnd: actualRiskVND,
            risk_percent_actual: capital > 0 ? (actualRiskVND / capital * 100).toFixed(2) : null,
            potential_profit_vnd: potentialProfit,
            risk_per_share: riskPerShare
          };
        }
        // Nếu chỉ có quantity
        else if (quantity) {
          const riskVND = quantity * riskPerShare;
          const capitalRequired = quantity * currentPrice;
          const tpP = recSuggestion?.take_profit;
          const potentialProfit = tpP ? quantity * Math.abs(tpP - currentPrice) : null;
          positionSizing = {
            suggested_quantity: quantity,
            capital_required: capitalRequired,
            risk_amount_vnd: riskVND,
            potential_profit_vnd: potentialProfit,
            risk_per_share: riskPerShare
          };
        }
      }
    }

    // Lưu recommendation vào DB (audit trail, không block nếu lỗi)
    let savedRec = null;
    if (!result.data_insufficient) {
      try {
        const ohlcvArr = ohlcvData ?? [];
        savedRec = await AiRecommendation.create({
          userId:               req.user.userId,
          symbol,
          exchange,
          side:                 side === 'SHORT' ? 'SHORT' : 'LONG',
          entryPriceAtRequest:  currentPrice,
          ohlcvFrom:            ohlcvArr.length > 0 ? (ohlcvArr[0]?.timestamp ?? null) : null,
          ohlcvTo:              ohlcvArr.length > 0 ? (ohlcvArr[ohlcvArr.length - 1]?.timestamp ?? null) : null,
          daysAvailable:        ohlcvArr.length,
          suggestions:          result.suggestions ?? [],
          technicalScore:       result.technical_score ?? null,
          technicalLabel:       result.technical_label ?? null,
          scoreMethodology:     result.score_methodology ?? null,
          analysisText:         result.analysis_text ?? null,
          keyLevels:            result.key_levels ?? {},
          modelUsed:            result._inference?.model ?? null,
          disclaimer:           result.disclaimer ?? null,
        });
        // Log inference latency nếu có
        if (savedRec && result._inference) {
          AiRecommendation.logInference({
            recommendationId: savedRec.id,
            modelName:        result._inference.model ?? 'unknown',
            latencyMs:        result._inference.latency_ms ?? 0,
            status:           'SUCCESS',
          }).catch(() => {});
        }
      } catch (dbErr) {
        console.error('[AI] Failed to save recommendation:', dbErr.message);
      }
    }

    // Xây dựng probability TP fields cho response
    let probabilityTPFields = {};
    if (probabilityTP !== null) {
      // D-11, D-12: probability-based là default suggestion
      probabilityTPFields = {
        take_profit_levels: probabilityTP.levels,
        take_profit_method: 'probability',
        take_profit_experimental: true, // D-13
        take_profit_data_quality: probabilityTP.data_quality,
        // Giữ take_profit_vnd (ATR x RR) như backup/reference — backward-compatible
      };
    } else {
      // D-14: fallback ATR x RR khi < 60 ngày data
      probabilityTPFields = {
        take_profit_method: 'atr_rr',
        take_profit_warning: 'Khong du du lieu lich su (can >= 60 ngay) de tinh xac suat. Dang su dung ATR x RR ratio.',
      };
    }

    res.json({
      success: true,
      data: {
        symbol,
        exchange,
        current_price: currentPrice,
        side,
        rr_ratio,
        capital: capital || null,
        risk_percent: risk_percent || null,
        position_sizing: positionSizing,
        recommendation_id: savedRec?.id ?? null,
        ...result,
        ...probabilityTPFields
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/ai/analyze-trend
 * Phân tích xu hướng thị trường
 */
export async function analyzeMarketTrend(req, res, next) {
  try {
    const { error, value } = analyzeTrendSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { symbol, exchange, indicators } = value;

    // Lấy OHLCV nếu chưa có
    let ohlcvData = value.ohlcv_data;
    if (!ohlcvData || ohlcvData.length === 0) {
      ohlcvData = await fetchOHLCV(symbol, exchange, 50);
    }

    if (ohlcvData.length < 5) {
      return res.status(400).json({
        success: false,
        message: `Không đủ dữ liệu giá cho ${symbol}. Cần ít nhất 5 phiên.`
      });
    }

    const result = await analyzeTrend({ symbol, exchange, ohlcvData, indicators: indicators || {} });

    // Lưu kết quả vào DB (ai_evaluations) nếu có kết quả hợp lệ
    try {
      if (result.trend && result.recommendation) {
        await query(
          `INSERT INTO ${DB_SCHEMA}.ai_evaluations
           (symbol, exchange, market_fit_score, safety_score, overall_score, verdict, market_analysis)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            symbol, exchange,
            result.strength || 50,
            result.trend === 'BULLISH' ? 70 : result.trend === 'BEARISH' ? 30 : 50,
            result.strength || 50,
            result.recommendation === 'BUY' ? 'RECOMMENDED' : result.recommendation === 'SELL' ? 'AVOID' : 'NEUTRAL',
            result.analysis || ''
          ]
        );
      }
    } catch (dbErr) {
      // Không fail nếu DB lỗi, chỉ log
      console.error('[AI] Failed to save trend analysis to DB:', dbErr.message);
    }

    res.json({
      success: true,
      data: {
        symbol,
        exchange,
        analyzed_at: new Date().toISOString(),
        ...result
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/ai/evaluate-risk
 * Đánh giá mức độ rủi ro của giao dịch
 */
export async function evaluateRisk(req, res, next) {
  try {
    const { error, value } = evaluateRiskSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { symbol, exchange, portfolio_id, entry_price, stop_loss, take_profit, quantity } = value;

    // Kiểm tra portfolio thuộc về user
    const portResult = await query(
      `SELECT * FROM ${DB_SCHEMA}.portfolios WHERE id = $1 AND user_id = $2`,
      [portfolio_id, req.user.userId]
    );
    if (!portResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'Portfolio không tồn tại' });
    }
    const portfolio = portResult.rows[0];

    // Lấy risk status hiện tại
    const riskStatus = await RiskCalculator.getPortfolioRiskStatus(portfolio_id);

    // Lấy OHLCV cho ngữ cảnh
    const ohlcvData = await fetchOHLCV(symbol, exchange, 20);

    const result = await evaluateTradeRisk({
      symbol, exchange, entryPrice: entry_price, stopLoss: stop_loss,
      takeProfit: take_profit, quantity,
      portfolioData: {
        totalBalance: parseFloat(portfolio.total_balance),
        maxRiskPercent: parseFloat(portfolio.max_risk_percent),
        currentRiskVND: riskStatus.currentRiskVND,
        maxRiskVND: riskStatus.maxRiskVND
      },
      ohlcvData
    });

    // Tính thêm các metrics cơ bản
    const riskVND = Math.abs(entry_price - stop_loss) * quantity;
    const rrRatio = take_profit ? Math.abs(take_profit - entry_price) / Math.abs(entry_price - stop_loss) : null;

    res.json({
      success: true,
      data: {
        symbol, exchange,
        entry_price, stop_loss, take_profit, quantity,
        calculated: {
          risk_vnd: Math.round(riskVND),
          rr_ratio: rrRatio ? parseFloat(rrRatio.toFixed(2)) : null,
          portfolio_risk_after: parseFloat((riskStatus.currentRiskVND + riskVND).toFixed(2)),
          portfolio_risk_usage_after: parseFloat(((riskStatus.currentRiskVND + riskVND) / riskStatus.maxRiskVND * 100).toFixed(2))
        },
        portfolio_risk_before: {
          current_risk_vnd: riskStatus.currentRiskVND,
          max_risk_vnd: riskStatus.maxRiskVND,
          risk_usage_percent: riskStatus.riskUsagePercent
        },
        ai_evaluation: result,
        evaluated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
}


/**
 * GET /api/ai/signals
 * Lấy danh sách tín hiệu AI (chưa hết hạn)
 */
export async function getSignals(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;
    const symbol = req.query.symbol;

    let conditions = [`(s.expires_at IS NULL OR s.expires_at > NOW())`];
    const values = [];
    let idx = 1;

    if (symbol) {
      conditions.push(`s.symbol = $${idx++}`);
      values.push(symbol.toUpperCase());
    }

    const result = await query(
      `SELECT s.*, ss.name as source_name, ss.source_type, ss.win_rate, ss.roi
       FROM ${DB_SCHEMA}.signals s
       JOIN ${DB_SCHEMA}.signal_sources ss ON s.source_id = ss.id
       WHERE ${conditions.join(' AND ')}
       ORDER BY s.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );

    const countResult = await query(
      `SELECT COUNT(*) as total FROM ${DB_SCHEMA}.signals s
       WHERE ${conditions.join(' AND ')}`,
      values
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: parseInt(countResult.rows[0]?.total || 0),
        limit,
        offset
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/dashboard
 * Tóm tắt thị trường và danh mục cho dashboard
 */
export async function getDashboardSummary(req, res, next) {
  try {
    const portfolioId = req.query.portfolio_id;

    let portfolioStats = {};
    let openPositions = [];

    if (portfolioId) {
      // Kiểm tra portfolio thuộc về user
      const portResult = await query(
        `SELECT * FROM ${DB_SCHEMA}.portfolios WHERE id = $1 AND user_id = $2`,
        [portfolioId, req.user.userId]
      );

      if (portResult.rows[0]) {
        const portfolio = portResult.rows[0];
        const riskStatus = await RiskCalculator.getPortfolioRiskStatus(portfolioId);

        // Lấy vị thế đang mở
        const posResult = await query(
          `SELECT p.*,
            CASE WHEN p.entry_price > 0 THEN
              ((p.entry_price - p.stop_loss) / p.entry_price * 100)
            ELSE 0 END as risk_percent
           FROM ${DB_SCHEMA}.positions p
           WHERE p.portfolio_id = $1 AND p.status = 'OPEN'
           ORDER BY p.opened_at DESC`,
          [portfolioId]
        );

        openPositions = posResult.rows;

        // Tính P&L tổng (từ các lệnh đã đóng trong 30 ngày)
        const pnlResult = await query(
          `SELECT COALESCE(SUM(profit_loss_vnd), 0) as total_pnl
           FROM ${DB_SCHEMA}.positions
           WHERE portfolio_id = $1
           AND closed_at >= NOW() - INTERVAL '30 days'`,
          [portfolioId]
        );

        portfolioStats = {
          totalBalance: parseFloat(portfolio.total_balance),
          currentRiskPercent: riskStatus.riskUsagePercent,
          openCount: openPositions.length,
          totalPnl: parseFloat(pnlResult.rows[0]?.total_pnl || 0),
          maxRiskPercent: parseFloat(portfolio.max_risk_percent)
        };
      }
    }

    // Lấy tổng quan thị trường từ API nội bộ
    let marketOverview = {};
    try {
      const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
      const ovRes = await fetch(`${API_BASE}/api/market/overview`);
      if (ovRes.ok) {
        const ovData = await ovRes.json();
        const indices = ovData?.data;
        if (Array.isArray(indices)) {
          const vnindex = indices.find(i => i.code === 'VNINDEX' || i.indexId === 'VNINDEX');
          const vn30 = indices.find(i => i.code === 'VN30' || i.indexId === 'VN30');
          marketOverview = {
            vnindexChange: vnindex?.changePercent || vnindex?.change_percent,
            vn30Change: vn30?.changePercent || vn30?.change_percent
          };
        }
      }
    } catch {
      // Bỏ qua nếu không lấy được market overview
    }

    // Gọi AI tạo tóm tắt (chỉ nếu có GEMINI_API_KEY)
    let aiSummary = null;
    if (process.env.GEMINI_API_KEY) {
      try {
        aiSummary = await generateMarketSummary({ portfolioStats, openPositions, marketOverview });
      } catch (aiErr) {
        console.error('[AI Dashboard] Failed to generate summary:', aiErr.message);
      }
    }

    // Lấy signals gần nhất
    const recentSignals = await query(
      `SELECT s.symbol, s.exchange, s.action, s.confidence_score, s.created_at
       FROM ${DB_SCHEMA}.signals s
       WHERE (s.expires_at IS NULL OR s.expires_at > NOW())
       ORDER BY s.created_at DESC
       LIMIT 5`
    );

    // Lấy AI evaluations gần nhất
    const recentEvals = await query(
      `SELECT symbol, exchange, verdict, overall_score, created_at
       FROM ${DB_SCHEMA}.ai_evaluations
       ORDER BY created_at DESC
       LIMIT 5`
    );

    res.json({
      success: true,
      data: {
        portfolio: portfolioStats,
        market_overview: marketOverview,
        ai_summary: aiSummary,
        recent_signals: recentSignals.rows,
        recent_evaluations: recentEvals.rows,
        open_positions_count: openPositions.length,
        generated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/evaluations
 * Lịch sử đánh giá AI
 */
/**
 * POST /api/ai/watchlist-analysis
 * Phân tích AI on-demand cho một mã trong watchlist của user.
 * Body: { symbol, exchange? }
 * Trả về: trend, signals, risk summary, khuyến nghị hành động.
 */
export async function analyzeWatchlistSymbol(req, res, next) {
  try {
    const { symbol, exchange = 'HOSE' } = req.body;
    if (!symbol) return res.status(400).json({ success: false, message: 'symbol là bắt buộc' });

    const sym = symbol.trim().toUpperCase();

    // Kiểm tra symbol có trong watchlist của user không
    const wlCheck = await query(
      `SELECT id FROM ${DB_SCHEMA}.watchlists WHERE user_id = $1 AND symbol = $2 LIMIT 1`,
      [req.user.userId, sym]
    );
    if (wlCheck.rows.length === 0) {
      return res.status(403).json({ success: false, message: `${sym} không có trong watchlist của bạn` });
    }

    // Lấy giá hiện tại và OHLCV song song (dùng helpers đã có trong file)
    const [currentPrice, ohlcvData] = await Promise.all([
      fetchCurrentPriceVND(sym, exchange),
      fetchOHLCV(sym, exchange, 50)   // lấy 50 nến để AI có đủ context
    ]);

    if (!ohlcvData || ohlcvData.length < 5) {
      return res.status(503).json({
        success: false,
        message: `Không đủ dữ liệu lịch sử cho ${sym} (cần ít nhất 5 phiên). VPBank API có thể tạm thời không khả dụng.`
      });
    }

    // Gọi AI phân tích xu hướng với đầy đủ dữ liệu
    const trendResult = await analyzeTrend({ symbol: sym, exchange, ohlcvData });

    // Map đúng từ response AI (AI trả key_levels.support, key_levels.resistance)
    const keyLevels = trendResult.key_levels || {};

    const record = {
      symbol: sym,
      exchange,
      current_price: currentPrice,
      candles_used: ohlcvData.length,
      trend: trendResult.trend,
      strength: trendResult.strength,
      timeframe: trendResult.timeframe,
      summary: trendResult.summary || trendResult.analysis,
      signals: trendResult.signals || [],
      support_levels: keyLevels.support || [],
      resistance_levels: keyLevels.resistance || [],
      volume_analysis: trendResult.volume_analysis,
      recommendation: trendResult.recommendation,
      analyzed_at: new Date().toISOString()
    };

    // Lưu lịch sử phân tích vào DB
    try {
      await query(
        `INSERT INTO ${DB_SCHEMA}.ai_analyses
           (user_id, symbol, exchange, trend, strength, recommendation, summary,
            signals, key_levels, volume_analysis, current_price, candles_used)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          req.user.userId, sym, exchange,
          record.trend, record.strength, record.recommendation,
          record.summary,
          JSON.stringify(record.signals),
          JSON.stringify({ support: record.support_levels, resistance: record.resistance_levels }),
          record.volume_analysis,
          record.current_price, record.candles_used
        ]
      );
    } catch (dbErr) {
      console.warn('[AI Analysis] Không lưu được lịch sử:', dbErr.message);
    }

    res.json({ success: true, data: record });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/watchlist-history
 * Lấy lịch sử phân tích AI cho một mã trong watchlist.
 * Query: { symbol, exchange?, limit? }
 */
export async function getWatchlistHistory(req, res, next) {
  try {
    const { symbol, exchange = 'HOSE', limit = 20 } = req.query;
    if (!symbol) return res.status(400).json({ success: false, message: 'symbol là bắt buộc' });

    const result = await query(
      `SELECT id, symbol, exchange, trend, strength, recommendation, summary,
              signals, key_levels, volume_analysis, current_price, candles_used, created_at
       FROM ${DB_SCHEMA}.ai_analyses
       WHERE user_id = $1 AND symbol = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [req.user.userId, symbol.toUpperCase(), Math.min(parseInt(limit) || 20, 50)]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

// ─── Validation Schemas (mới) ────────────────────────────────────────────────

const positionReviewSchema = Joi.object({
  portfolio_id: Joi.string().uuid().required()
});

const marketRegimeSchema = Joi.object({
  force_refresh: Joi.boolean().optional().default(false)
});

/**
 * POST /api/ai/position-review
 * AI review tất cả vị thế đang mở của portfolio, đề xuất điều chỉnh SL/TP
 */
export async function reviewPositions(req, res, next) {
  try {
    const { error, value } = positionReviewSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { portfolio_id } = value;

    // Kiểm tra portfolio thuộc về user
    const portResult = await query(
      `SELECT * FROM ${DB_SCHEMA}.portfolios WHERE id = $1 AND user_id = $2`,
      [portfolio_id, req.user.userId]
    );
    if (!portResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'Portfolio không tồn tại' });
    }

    // Lấy tất cả vị thế OPEN
    const posResult = await query(
      `SELECT id, portfolio_id, symbol, exchange, entry_price, stop_loss, take_profit,
              quantity, side, stop_type, trailing_current_stop
       FROM ${DB_SCHEMA}.positions
       WHERE portfolio_id = $1 AND status = 'OPEN'
       ORDER BY opened_at DESC`,
      [portfolio_id]
    );
    const positions = posResult.rows;

    if (positions.length === 0) {
      return res.json({
        success: true,
        data: {
          positions_reviewed: 0,
          recommendations: [],
          portfolio_health_score: 100,
          message: 'Không có vị thế nào đang mở'
        }
      });
    }

    // Lấy giá hiện tại song song cho tất cả symbols
    const symbols = [...new Set(positions.map(p => p.symbol))];
    const priceMap = {};
    await Promise.all(
      symbols.map(async (sym) => {
        const pos = positions.find(p => p.symbol === sym);
        const price = await fetchCurrentPriceVND(sym, pos?.exchange || 'HOSE');
        if (price) priceMap[sym] = price;
      })
    );

    // Gọi AI review
    const recommendations = await reviewOpenPositions({ positions, currentPrices: priceMap });

    // Tính portfolio health score (100 = tốt, giảm theo cảnh báo)
    const highUrgencyCount = recommendations.filter(r => r.urgency === 'HIGH').length;
    const exitCount = recommendations.filter(r => r.action === 'EXIT').length;
    const healthScore = Math.max(0, 100 - (highUrgencyCount * 20) - (exitCount * 15));

    // Lưu lịch sử vào DB
    let reviewId = null;
    try {
      const saveResult = await query(
        `INSERT INTO ${DB_SCHEMA}.ai_position_reviews
           (user_id, portfolio_id, positions_reviewed, portfolio_health_score, recommendations, current_prices)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          req.user.userId,
          portfolio_id,
          positions.length,
          healthScore,
          JSON.stringify(recommendations),
          JSON.stringify(priceMap)
        ]
      );
      reviewId = saveResult.rows[0]?.id;
    } catch (dbErr) {
      console.warn('[AI Review] Không lưu được lịch sử:', dbErr.message);
    }

    res.json({
      success: true,
      data: {
        id: reviewId,
        positions_reviewed: positions.length,
        recommendations,
        portfolio_health_score: healthScore,
        current_prices: priceMap,
        reviewed_at: new Date().toISOString()
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/position-review-history
 * Lấy lịch sử AI review vị thế của portfolio
 * Query: { portfolio_id, limit? }
 */
export async function getPositionReviewHistory(req, res, next) {
  try {
    const { portfolio_id, limit = 20 } = req.query;
    if (!portfolio_id) {
      return res.status(400).json({ success: false, message: 'portfolio_id là bắt buộc' });
    }

    // Kiểm tra portfolio thuộc về user
    const portCheck = await query(
      `SELECT id FROM ${DB_SCHEMA}.portfolios WHERE id = $1 AND user_id = $2`,
      [portfolio_id, req.user.userId]
    );
    if (!portCheck.rows[0]) {
      return res.status(404).json({ success: false, message: 'Portfolio không tồn tại' });
    }

    const result = await query(
      `SELECT id, positions_reviewed, portfolio_health_score, recommendations,
              current_prices, applied_count, created_at
       FROM ${DB_SCHEMA}.ai_position_reviews
       WHERE portfolio_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [portfolio_id, Math.min(parseInt(limit) || 20, 50)]
    );

    res.json({ success: true, data: result.rows });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/ai/position-review-history/:id/applied
 * Cập nhật applied_count khi user áp dụng đề xuất
 */
export async function markReviewApplied(req, res, next) {
  try {
    const { id } = req.params;
    await query(
      `UPDATE ${DB_SCHEMA}.ai_position_reviews
       SET applied_count = applied_count + 1
       WHERE id = $1 AND user_id = $2`,
      [id, req.user.userId]
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/ai/market-regime
 * Phát hiện chế độ thị trường từ dữ liệu VNINDEX
 */
export async function getMarketRegime(req, res, next) {
  try {
    const { error, value } = marketRegimeSchema.validate(req.body || {}, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }
    const { force_refresh } = value;

    // Trả cache nếu còn hiệu lực
    if (!force_refresh && regimeCache.data && (Date.now() - regimeCache.timestamp < REGIME_CACHE_TTL)) {
      return res.json({
        success: true,
        data: regimeCache.data,
        cached: true,
        cache_age_minutes: Math.floor((Date.now() - regimeCache.timestamp) / 60000)
      });
    }

    // Lấy VNINDEX OHLCV
    const vnindexData = await fetchOHLCV('VNINDEX', 'HOSE', 30);

    // Lấy market breadth từ overview
    let marketBreadth = {};
    try {
      const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
      const ovRes = await fetch(`${API_BASE}/api/market/overview`);
      if (ovRes.ok) {
        const ovData = await ovRes.json();
        if (Array.isArray(ovData?.data)) {
          const vnindex = ovData.data.find(i => i.code === 'VNINDEX' || i.indexId === 'VNINDEX');
          if (vnindex) {
            marketBreadth = {
              advancing: vnindex.advances ?? vnindex.advancing ?? 0,
              declining: vnindex.declines ?? vnindex.declining ?? 0,
              unchanged: vnindex.noChanges ?? vnindex.unchanged ?? 0
            };
          }
        }
      }
    } catch { /* Bỏ qua nếu không lấy được */ }

    const result = await detectMarketRegime({ vnindexData, marketBreadth });

    const cacheData = {
      ...result,
      vnindex_candles_used: vnindexData.length,
      generated_at: new Date().toISOString()
    };
    regimeCache = { data: cacheData, timestamp: Date.now() };

    res.json({
      success: true,
      data: cacheData,
      cached: false
    });
  } catch (error) {
    next(error);
  }
}

export async function getEvaluations(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;
    const symbol = req.query.symbol;

    let conditions = [];
    const values = [];
    let idx = 1;

    if (symbol) {
      conditions.push(`ae.symbol = $${idx++}`);
      values.push(symbol.toUpperCase());
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(
      `SELECT ae.*, s.action as signal_action, ss.name as source_name
       FROM ${DB_SCHEMA}.ai_evaluations ae
       LEFT JOIN ${DB_SCHEMA}.signals s ON ae.signal_id = s.id
       LEFT JOIN ${DB_SCHEMA}.signal_sources ss ON ae.source_id = ss.id
       ${where}
       ORDER BY ae.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset]
    );

    res.json({
      success: true,
      data: result.rows,
      pagination: { limit, offset }
    });
  } catch (error) {
    next(error);
  }
}

// ─── AI Recommendations ───────────────────────────────────────────────────────

/**
 * GET /api/ai/recommendations?limit=20
 * Lịch sử AI recommendations của user
 */
export async function listRecommendations(req, res, next) {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const recs = await AiRecommendation.findByUser(req.user.userId, { limit });
    res.json({ success: true, data: recs, count: recs.length });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/recommendations/:id
 */
export async function getRecommendation(req, res, next) {
  try {
    const rec = await AiRecommendation.findById(req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Recommendation không tồn tại' });
    if (rec.user_id !== req.user.userId) return res.status(403).json({ success: false, message: 'Không có quyền' });
    res.json({ success: true, data: rec });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/ai/recommendations/:id/apply
 * Body: { selected_level: 'aggressive' | 'moderate' | 'conservative' }
 */
export async function applyRecommendation(req, res, next) {
  try {
    const { selected_level } = req.body;
    if (!['aggressive', 'moderate', 'conservative'].includes(selected_level)) {
      return res.status(400).json({ success: false, message: 'selected_level phải là aggressive | moderate | conservative' });
    }
    const rec = await AiRecommendation.findById(req.params.id);
    if (!rec) return res.status(404).json({ success: false, message: 'Recommendation không tồn tại' });
    if (rec.user_id !== req.user.userId) return res.status(403).json({ success: false, message: 'Không có quyền' });

    const updated = await AiRecommendation.markApplied(req.params.id, selected_level);
    if (!updated) {
      return res.status(409).json({ success: false, message: 'Recommendation đã được áp dụng hoặc đã hết hạn' });
    }
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

// ─── Capital Allocation Schemas ──────────────────────────────────────────────

const positionSizingSchema = Joi.object({
  portfolio_id: Joi.string().uuid().required(),
  symbol: Joi.string().min(1).max(20).optional(),
});

const riskBudgetQuerySchema = Joi.object({
  portfolio_id: Joi.string().uuid().required(),
});

// ─── Capital Allocation Handlers ─────────────────────────────────────────────

/**
 * POST /api/ai/position-sizing
 * Tinh half-Kelly position sizing dua tren lich su giao dich.
 * Body: { portfolio_id, symbol? }
 */
export async function getPositionSizing(req, res, next) {
  try {
    const { error, value } = positionSizingSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { portfolio_id, symbol } = value;

    // Kiem tra portfolio thuoc ve user
    const portResult = await query(
      `SELECT id FROM ${DB_SCHEMA}.portfolios WHERE id = $1 AND user_id = $2`,
      [portfolio_id, req.user.userId]
    );
    if (!portResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'Portfolio không tồn tại' });
    }

    // Lay trade stats tu closed positions
    const tradeStats = await getTradeStats(portfolio_id);

    // Tinh half-Kelly tu combined stats
    const { winRate, avgWinLoss } = tradeStats.combined;
    const kellyResult = calculateHalfKelly(winRate, avgWinLoss);

    // Them context neu co symbol cu the
    if (symbol) {
      kellyResult.interpretation = `Voi ma ${symbol.toUpperCase()}, ${kellyResult.interpretation}`;
    }

    res.json({
      success: true,
      data: {
        kelly: kellyResult,
        stats: tradeStats,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/risk-budget?portfolio_id=xxx
 * Tinh risk budget hien tai cua portfolio.
 * Query: { portfolio_id }
 */
export async function getRiskBudget(req, res, next) {
  try {
    const { error, value } = riskBudgetQuerySchema.validate(req.query, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { portfolio_id } = value;

    // Kiem tra portfolio thuoc ve user va lay totalBalance + maxRiskPercent
    const portResult = await query(
      `SELECT id, total_balance, max_risk_percent FROM ${DB_SCHEMA}.portfolios WHERE id = $1 AND user_id = $2`,
      [portfolio_id, req.user.userId]
    );
    if (!portResult.rows[0]) {
      return res.status(404).json({ success: false, message: 'Portfolio không tồn tại' });
    }

    const portfolio = portResult.rows[0];
    const totalBalance = parseFloat(portfolio.total_balance) || 0;
    const maxRiskPercent = parseFloat(portfolio.max_risk_percent) || 5;

    const riskBudget = await calculateRiskBudget(portfolio_id, totalBalance, maxRiskPercent);

    res.json({
      success: true,
      data: riskBudget,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/rebalancing?portfolio_id=xxx
 * Phan tich sector concentration va de xuat tai co cau portfolio.
 * Authentication required (authenticateToken middleware).
 */
export async function getRebalancingSuggestions(req, res, next) {
  try {
    const { portfolio_id } = req.query;

    if (!portfolio_id) {
      return res.status(400).json({ success: false, message: 'portfolio_id là bắt buộc' });
    }

    // Lay open positions cua portfolio
    const positionsResult = await query(
      `SELECT symbol, entry_price, quantity, side, exchange
       FROM ${DB_SCHEMA}.positions
       WHERE portfolio_id = $1 AND status = 'OPEN'`,
      [portfolio_id]
    );

    const positions = positionsResult.rows;

    // Tinh totalPortfolioValue tu open positions (entry_price * quantity)
    const totalPortfolioValue = positions.reduce((sum, pos) => {
      const value = Number(pos.entry_price) * Number(pos.quantity);
      return sum + (isNaN(value) ? 0 : value);
    }, 0);

    const result = await generateRebalancingSuggestions(positions, totalPortfolioValue);

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

// ─── Risk Scenario Simulation Schemas ────────────────────────────────────────

const varSchema = Joi.object({
  portfolio_id: Joi.string().uuid().required(),
  confidence_level: Joi.number().min(0.9).max(0.99).default(0.95),
  lookback_days: Joi.number().integer().min(20).max(250).default(60),
});

const monteCarloSchema = Joi.object({
  portfolio_id: Joi.string().uuid().required(),
  num_paths: Joi.number().integer().min(100).max(5000).default(1000),
  num_days: Joi.number().integer().min(5).max(60).default(20),
});

const stressTestSchema = Joi.object({
  portfolio_id: Joi.string().uuid().required(),
  custom_scenario: Joi.number().min(-50).max(0).optional(),
});

const sectorConcentrationSchema = Joi.object({
  portfolio_id: Joi.string().uuid().required(),
});

// ─── Risk Scenario Simulation Handlers ───────────────────────────────────────

/**
 * GET /api/ai/var?portfolio_id=xxx&confidence_level=0.95&lookback_days=60
 * Historical VaR calculation — RISK-01
 */
export async function getVaR(req, res, next) {
  try {
    const { error, value } = varSchema.validate(req.query, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { portfolio_id, confidence_level: confidenceLevel, lookback_days: lookbackDays } = value;

    // Query positions OPEN cua portfolio
    const positionsResult = await query(
      `SELECT symbol, entry_price, quantity, exchange
       FROM ${DB_SCHEMA}.positions
       WHERE portfolio_id = $1 AND status = 'OPEN'`,
      [portfolio_id]
    );

    const positions = positionsResult.rows.map(p => ({
      symbol: p.symbol,
      entry_price: parseFloat(p.entry_price),
      quantity: parseInt(p.quantity),
      exchange: p.exchange || 'HOSE',
    }));

    // Neu khong co positions, tra ve ket qua rong
    if (positions.length === 0) {
      return res.json({
        success: true,
        data: {
          portfolioVaR: { varVnd: 0, varPercent: 0, confidenceLevel },
          positionVaRs: [],
          summary: `Với ${(confidenceLevel * 100).toFixed(0)}% tin cậy, max loss 1 ngày là 0 VND (0% portfolio)`,
        },
      });
    }

    // Fetch OHLCV 5 concurrent max
    const symbols = [...new Set(positions.map(p => p.symbol))];
    const exchangeMap = {};
    for (const p of positions) {
      exchangeMap[p.symbol] = p.exchange;
    }
    const limit = lookbackDays + 10;
    const ohlcvBySymbol = {};

    for (let i = 0; i < symbols.length; i += 5) {
      const batch = symbols.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(sym => fetchOHLCV(sym, exchangeMap[sym] || 'HOSE', limit))
      );
      batch.forEach((sym, idx) => { ohlcvBySymbol[sym] = results[idx]; });
    }

    const result = calculateHistoricalVaR({ positions, ohlcvBySymbol, confidenceLevel, lookbackDays });

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/ai/monte-carlo
 * Monte Carlo simulation 1000 paths — RISK-02
 * Body: { portfolio_id, num_paths?, num_days? }
 */
export async function getMonteCarloSimulation(req, res, next) {
  try {
    const { error, value } = monteCarloSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { portfolio_id, num_paths: numPaths, num_days: numDays } = value;

    // Query positions OPEN
    const positionsResult = await query(
      `SELECT symbol, entry_price, quantity, exchange
       FROM ${DB_SCHEMA}.positions
       WHERE portfolio_id = $1 AND status = 'OPEN'`,
      [portfolio_id]
    );

    const positions = positionsResult.rows.map(p => ({
      symbol: p.symbol,
      entry_price: parseFloat(p.entry_price),
      quantity: parseInt(p.quantity),
      exchange: p.exchange || 'HOSE',
    }));

    // Build exchangeBySymbol map
    const exchangeBySymbol = {};
    for (const p of positions) {
      exchangeBySymbol[p.symbol] = p.exchange;
    }

    // Fetch OHLCV 250 ngay (can nhieu data cho mu, sigma chinh xac)
    const symbols = [...new Set(positions.map(p => p.symbol))];
    const ohlcvBySymbol = {};

    for (let i = 0; i < symbols.length; i += 5) {
      const batch = symbols.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(sym => fetchOHLCV(sym, exchangeBySymbol[sym] || 'HOSE', 250))
      );
      batch.forEach((sym, idx) => { ohlcvBySymbol[sym] = results[idx]; });
    }

    const rawResult = runMonteCarloSimulation({ positions, ohlcvBySymbol, numPaths, numDays, exchangeBySymbol });

    // KHONG tra raw paths (1000 paths qua lon) — chi tra summary + percentile bands
    const { percentileBands, probabilityOfLoss, initialValue } = rawResult;

    // Tinh finalValueDistribution tu percentile bands ngay cuoi
    const lastDay = numDays - 1;
    const finalValueDistribution = {
      p5: percentileBands.p5[lastDay],
      p25: percentileBands.p25[lastDay],
      p50: percentileBands.p50[lastDay],
      p75: percentileBands.p75[lastDay],
      p95: percentileBands.p95[lastDay],
    };

    return res.json({
      success: true,
      data: {
        percentileBands,
        probabilityOfLoss,
        initialValue,
        finalValueDistribution,
        numPaths,
        numDays,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/ai/stress-test
 * Stress test scenarios -10/-15/-20% + custom — RISK-03
 * Body: { portfolio_id, custom_scenario? }
 */
export async function getStressTestResult(req, res, next) {
  try {
    const { error, value } = stressTestSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { portfolio_id, custom_scenario } = value;

    // Query positions OPEN
    const positionsResult = await query(
      `SELECT symbol, entry_price, quantity
       FROM ${DB_SCHEMA}.positions
       WHERE portfolio_id = $1 AND status = 'OPEN'`,
      [portfolio_id]
    );

    const positions = positionsResult.rows.map(p => ({
      symbol: p.symbol,
      entry_price: parseFloat(p.entry_price),
      quantity: parseInt(p.quantity),
    }));

    const result = calculateStressTest({
      positions,
      customScenario: custom_scenario !== undefined ? custom_scenario : null,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/ai/sector-concentration?portfolio_id=xxx
 * Sector concentration analysis — RISK-04
 */
export async function getSectorConcentrationResult(req, res, next) {
  try {
    const { error, value } = sectorConcentrationSchema.validate(req.query, { stripUnknown: true });
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }

    const { portfolio_id } = value;

    // Query positions OPEN
    const positionsResult = await query(
      `SELECT symbol, entry_price, quantity
       FROM ${DB_SCHEMA}.positions
       WHERE portfolio_id = $1 AND status = 'OPEN'`,
      [portfolio_id]
    );

    const positions = positionsResult.rows.map(p => ({
      symbol: p.symbol,
      entry_price: parseFloat(p.entry_price),
      quantity: parseInt(p.quantity),
    }));

    const result = calculateSectorConcentration({ positions });

    return res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}
