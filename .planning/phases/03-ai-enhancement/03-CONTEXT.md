# Phase 3: AI Enhancement - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous)

<domain>
## Phase Boundary

Nâng cấp 3 module AI: (1) Dynamic Stop Loss — SL tự điều chỉnh theo ATR hiện tại + regime thị trường, không còn tĩnh 1 lần, (2) Probability-based Take Profit — TP dựa trên phân phối thống kê log-normal từ dữ liệu lịch sử, hiển thị xác suất đạt mỗi mức, (3) AI Capital Allocation — position sizing Kelly Criterion + risk budget visualization + rebalancing suggestions.

</domain>

<decisions>
## Implementation Decisions

### Dynamic Stop Loss (AISL-01 to AISL-06)
- **D-01:** SL recalculate mỗi 5 phút trong giờ giao dịch qua node-cron worker
- **D-02:** Dùng `trading-signals` package (^7.4.3) thay thế ATR tự viết trong aiService.js — streaming API, TypeScript-native
- **D-03:** Regime detection: Bollinger Band percentile > 70 = VOLATILE, SMA50/SMA200 crossover cho BULLISH/BEARISH, else SIDEWAYS
- **D-04:** SL thích ứng regime: VOLATILE → mở rộng ATR multiplier 2.5x, TRENDING → standard 1.5x, SIDEWAYS → thu hẹp 1.0x
- **D-05:** Trailing stop thông minh: khoảng cách = ATR × regime_multiplier. Mở rộng khi vol cao, thu hẹp khi thấp
- **D-06:** Clamp SL trong biên độ giá sàn (HOSE +/-7%, HNX +/-10%) — dùng vnStockRules.ts
- **D-07:** Gemini narrative giải thích TẠI SAO SL thay đổi, với fallback rule-based khi API timeout 5s
- **D-08:** Cache regime 30 phút — không gọi Gemini mỗi 5 phút

### Probability-based Take Profit (AITP-01 to AITP-04)
- **D-09:** Dùng `simple-statistics` package (^7.8.9) cho log-normal distribution, percentile, CDF
- **D-10:** Tính probability từ 60-200 ngày dữ liệu OHLCV lịch sử (daily returns)
- **D-11:** Hiển thị 3-5 mức TP với xác suất + timeframe: "70% đạt 25,500 VND trong 5 ngày"
- **D-12:** Thay thế TP cơ học (ATR × RR) bằng probability-based làm default suggestion
- **D-13:** Label "experimental" cho probability-based TP — thu thập feedback
- **D-14:** Fallback: nếu không đủ dữ liệu lịch sử (< 60 ngày), dùng ATR × RR cũ với warning

### AI Capital Allocation (AICAP-01 to AICAP-03)
- **D-15:** Kelly Criterion phân số (half-Kelly recommended): f* = (p × b - q) / b × 0.5, với p = win rate, b = avg win/avg loss
- **D-16:** Win rate và avg R:R tính từ closed positions (cả REAL và PAPER)
- **D-17:** Risk budget visualization: gauge hiển thị "Đã dùng X% ngân sách rủi ro" — tái sử dụng RiskManagerView pattern
- **D-18:** Rebalancing suggestion qua Gemini: "HPG chiếm 40% portfolio — xem xét giảm" với fallback rule-based (> 30% = warn)
- **D-19:** Sector classification hardcode cho VN stocks phổ biến (banking, real estate, tech, retail,...)

### Claude's Discretion
- Cách tổ chức code cho 3 AI modules (tách file hay gộp)
- Chart/visualization cho probability distribution
- Caching strategy cho historical OHLCV data
- Error handling khi VPBS API không trả đủ historical data

</decisions>

<canonical_refs>
## Canonical References

### Research
- `.planning/research/STACK.md` — trading-signals, simple-statistics recommendations
- `.planning/research/FEATURES.md` — AI feature breakdown, complexity estimates
- `.planning/research/PITFALLS.md` — SL overfitting, TP without probability, Gemini dependency
- `.planning/research/ARCHITECTURE.md` — AI Services Context (stateless advisors)

### Codebase
- `.planning/codebase/ARCHITECTURE.md` — Current AI service layer
- `.planning/codebase/CONVENTIONS.md` — Code patterns

### Key Source Files
- `ai-stoploss-engine-be/services/aiService.js` — Current AI service (ATR calc, Gemini integration)
- `ai-stoploss-engine-be/controllers/ai.controller.js` — Current AI endpoints
- `ai-stoploss-engine-be/routes/ai.routes.js` — AI API routes
- `ai-stoploss-engine-be/workers/stopLossMonitor.js` — Current SL monitor (needs dynamic upgrade)
- `ai-stoploss-engine-be/services/shared/riskCalculator.js` — Risk calculation shared kernel
- `ai-stoploss-engine-fe/components/TradingTerminal.tsx` — AI suggest UI integration point
- `ai-stoploss-engine-fe/components/RiskManagerView.tsx` — Risk gauge pattern to reuse
- `ai-stoploss-engine-fe/components/AiMonitorPanel.tsx` — AI position review panel

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `aiService.js` — Gemini integration, regime detection (upgrade in place)
- `stopLossMonitor.js` — Worker pattern, PAPER context filter (add REAL dynamic SL)
- `RiskManagerView.tsx` — Risk gauge semicircle component (reuse for budget visualization)
- `AiMonitorPanel.tsx` — Position review cards (extend with dynamic SL info)
- `TradingTerminal.tsx` — AI suggest button (upgrade to show probability-based TP)

### Established Patterns
- Gemini API with 15min cache for regime
- Rule-based calculation + Gemini narrative text
- node-cron workers (settlement, fill, stopLoss)
- Vitest with mock helpers

### Integration Points
- AI routes: extend `/api/ai/suggest-sltp` with probability-based TP
- Worker: upgrade stopLossMonitor for dynamic SL recalculation
- Frontend: TradingTerminal AI suggest panel, RiskManagerView budget gauge

</code_context>

<specifics>
## Specific Ideas

- User muốn AI thực sự "thông minh" — không chỉ công thức cố định
- Probability-based TP là core differentiator — phải hiển thị % xác suất rõ ràng
- Dynamic SL phải giải thích TẠI SAO thay đổi — không chỉ thay đổi âm thầm
- Label "experimental" cho features mới — honest about limitations

</specifics>

<deferred>
## Deferred Ideas

- Correlation analysis between positions — needs large historical data, defer to v2
- Monte Carlo for SL optimization — defer to Phase 4 (Risk Simulation)
- Machine learning model training — too complex for v1, rule-based + Gemini sufficient

</deferred>

---

*Phase: 03-ai-enhancement*
*Context gathered: 2026-03-27 via smart discuss (autonomous)*
