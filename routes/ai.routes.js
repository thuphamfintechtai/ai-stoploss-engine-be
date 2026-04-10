import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import {
  suggestSLTP,
  analyzeMarketTrend,
  evaluateRisk,
  getSignals,
  getDashboardSummary,
  getEvaluations,
  analyzeWatchlistSymbol,
  getWatchlistHistory,
  reviewPositions,
  getMarketRegime,
  getPositionReviewHistory,
  markReviewApplied,
  listRecommendations,
  getRecommendation,
  applyRecommendation,
  getPositionSizing,
  getRiskBudget,
  getRebalancingSuggestions,
  getVaR,
  getMonteCarloSimulation,
  getStressTestResult,
  getSectorConcentrationResult,
} from '../controllers/ai.controller.js';

const router = express.Router();

// Tất cả AI routes cần xác thực
router.use(authenticateToken);

/**
 * POST /api/ai/suggest-sltp
 * AI gợi ý Stop Loss và Take Profit
 * Body: { symbol, exchange?, current_price?, rr_ratio?, side?, ohlcv_data? }
 */
router.post('/suggest-sltp', suggestSLTP);

/**
 * POST /api/ai/analyze-trend
 * Phân tích xu hướng thị trường
 * Body: { symbol, exchange?, ohlcv_data?, indicators? }
 */
router.post('/analyze-trend', analyzeMarketTrend);

/**
 * POST /api/ai/evaluate-risk
 * Đánh giá mức độ rủi ro của giao dịch
 * Body: { symbol, exchange?, portfolio_id, entry_price, stop_loss, take_profit?, quantity }
 */
router.post('/evaluate-risk', evaluateRisk);

/**
 * GET /api/ai/signals
 * Lấy danh sách tín hiệu AI chưa hết hạn
 * Query: { symbol?, limit?, offset? }
 */
router.get('/signals', getSignals);

/**
 * GET /api/ai/dashboard
 * Tóm tắt thị trường và portfolio cho dashboard
 * Query: { portfolio_id? }
 */
router.get('/dashboard', getDashboardSummary);

/**
 * GET /api/ai/evaluations
 * Lịch sử đánh giá AI
 * Query: { symbol?, limit?, offset? }
 */
router.get('/evaluations', getEvaluations);

/**
 * POST /api/ai/watchlist-analysis
 * Phân tích AI on-demand cho mã trong watchlist
 * Body: { symbol, exchange? }
 */
router.post('/watchlist-analysis', analyzeWatchlistSymbol);

/**
 * GET /api/ai/watchlist-history?symbol=ACB&limit=20
 * Lịch sử phân tích AI cho một mã
 */
router.get('/watchlist-history', getWatchlistHistory);

/**
 * POST /api/ai/position-review
 * AI review tất cả vị thế đang mở, đề xuất điều chỉnh SL/TP
 * Body: { portfolio_id }
 */
router.post('/position-review', reviewPositions);

/**
 * POST /api/ai/market-regime
 * Phát hiện chế độ thị trường (BULL/BEAR/SIDEWAYS/VOLATILE)
 * Body: { force_refresh? }
 */
router.post('/market-regime', getMarketRegime);

/**
 * GET /api/ai/position-review-history?portfolio_id=...&limit=20
 * Lịch sử AI review vị thế của portfolio
 */
router.get('/position-review-history', getPositionReviewHistory);

/**
 * PATCH /api/ai/position-review-history/:id/applied
 * Đánh dấu đã áp dụng đề xuất (tăng applied_count)
 */
router.patch('/position-review-history/:id/applied', markReviewApplied);

/**
 * GET /api/ai/recommendations?limit=20
 * Lịch sử AI recommendations của user hiện tại
 */
router.get('/recommendations', listRecommendations);

/**
 * GET /api/ai/recommendations/:id
 * Chi tiết một recommendation
 */
router.get('/recommendations/:id', getRecommendation);

/**
 * POST /api/ai/recommendations/:id/apply
 * Body: { selected_level: 'aggressive' | 'moderate' | 'conservative' }
 * Đánh dấu user đã áp dụng recommendation
 */
router.post('/recommendations/:id/apply', applyRecommendation);

/**
 * POST /api/ai/position-sizing
 * Tinh half-Kelly position sizing dua tren lich su giao dich
 * Body: { portfolio_id, symbol? }
 */
router.post('/position-sizing', getPositionSizing);

/**
 * GET /api/ai/risk-budget?portfolio_id=xxx
 * Tinh risk budget hien tai cua portfolio
 * Query: { portfolio_id }
 */
router.get('/risk-budget', getRiskBudget);

/**
 * GET /api/ai/rebalancing?portfolio_id=xxx
 * Phan tich sector concentration, canh bao > 30%, de xuat tai co cau
 * Query: { portfolio_id }
 */
router.get('/rebalancing', getRebalancingSuggestions);

/**
 * GET /api/ai/var?portfolio_id=xxx&confidence_level=0.95&lookback_days=60
 * Historical VaR calculation — RISK-01
 */
router.get('/var', getVaR);

/**
 * POST /api/ai/monte-carlo
 * Monte Carlo simulation 1000 paths — RISK-02
 * Body: { portfolio_id, num_paths?, num_days? }
 */
router.post('/monte-carlo', getMonteCarloSimulation);

/**
 * POST /api/ai/stress-test
 * Stress test scenarios -10/-15/-20% — RISK-03
 * Body: { portfolio_id, custom_scenario? }
 */
router.post('/stress-test', getStressTestResult);

/**
 * GET /api/ai/sector-concentration?portfolio_id=xxx
 * Sector concentration analysis — RISK-04
 */
router.get('/sector-concentration', getSectorConcentrationResult);

export default router;
