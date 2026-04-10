# Phase 4: Risk Scenario Simulation - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous)

<domain>
## Phase Boundary

Xây dựng 4 công cụ đánh giá rủi ro "institutional-grade": (1) VaR — "Với 95% tin cậy, max loss 1 ngày là X VND", (2) Monte Carlo — mô phỏng 1000+ đường đi portfolio, (3) Stress Test — "Nếu VNINDEX giảm 10/15/20%?", (4) Sector Concentration Warning — cảnh báo khi quá nhiều vốn vào 1 ngành.

</domain>

<decisions>
## Implementation Decisions

### VaR Calculation (RISK-01)
- **D-01:** Historical Simulation VaR: dùng actual daily returns từ 60-250 ngày, sắp xếp, lấy percentile 5% (95% confidence)
- **D-02:** Dùng `simple-statistics` (đã install Phase 3) cho percentile, mean, stddev
- **D-03:** VaR cho individual position + portfolio level
- **D-04:** Hiển thị: "Với 95% tin cậy, max loss 1 ngày là X VND (Y% portfolio)"

### Monte Carlo Simulation (RISK-02)
- **D-05:** Geometric Brownian Motion (GBM): dS = μSdt + σSdW
- **D-06:** 1000 paths, 20 trading days forward (1 tháng)
- **D-07:** Price band clamp mỗi ngày (HOSE +/-7%, HNX +/-10%) — VN market specific
- **D-08:** Output: percentile bands (5th, 25th, 50th, 75th, 95th), probability of loss > X%
- **D-09:** Chạy server-side trong Node.js — không cần Web Workers cho 1000 paths

### Stress Test (RISK-03)
- **D-10:** 3 predefined scenarios: VNINDEX -10%, -15%, -20%
- **D-11:** Per-position impact: position_value × beta × scenario_drop (beta ước tính từ correlation với VNINDEX)
- **D-12:** Beta ước tính đơn giản: banking stocks 1.2, real estate 1.5, tech 0.8, utilities 0.5 (hardcode từ sectorClassification)
- **D-13:** Custom scenario: user nhập % drop, hệ thống tính impact

### Sector Concentration (RISK-04)
- **D-14:** Tái sử dụng sectorClassification.js từ Phase 3
- **D-15:** Warning threshold: > 40% vốn vào 1 ngành = RED, > 30% = YELLOW
- **D-16:** Hiển thị pie chart sector breakdown

### Claude's Discretion
- Visualization library cho Monte Carlo paths (Recharts đã có trong FE)
- Caching strategy cho simulation results
- API response format cho large Monte Carlo data (stream vs batch)
- Error handling khi không đủ historical data cho VaR/Monte Carlo

</decisions>

<canonical_refs>
## Canonical References

### Research
- `.planning/research/FEATURES.md` — VaR, Monte Carlo, stress test feature specs
- `.planning/research/STACK.md` — simple-statistics for VaR, mathjs for covariance (defer)
- `.planning/research/PITFALLS.md` — Price band distortion in Monte Carlo

### Key Source Files
- `ai-stoploss-engine-be/services/ai/capitalAllocation.js` — Risk budget (Phase 3, extend)
- `ai-stoploss-engine-be/services/ai/sectorClassification.js` — Sector mapping (reuse)
- `ai-stoploss-engine-be/services/ai/indicatorCache.js` — OHLCV data caching (reuse)
- `ai-stoploss-engine-be/services/shared/riskCalculator.js` — Current risk calc
- `ai-stoploss-engine-fe/components/RiskManagerView.tsx` — Risk UI (extend)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `simple-statistics` — percentile, mean, stddev (already installed)
- `sectorClassification.js` — sector mapping + getSector()
- `indicatorCache.js` — OHLCV data with TTL cache
- `RiskManagerView.tsx` — Risk gauge, sector bars (extend)
- Recharts — already in frontend for charts

### Integration Points
- New API routes: `/api/ai/var`, `/api/ai/monte-carlo`, `/api/ai/stress-test`
- Extend RiskManagerView.tsx with new tabs/sections
- Reuse portfolio position data for calculations

</code_context>

<specifics>
## Specific Ideas

- Monte Carlo visualization — fan chart showing probability bands
- VaR should be simple and clear — one number, one sentence
- Stress test should feel actionable — "If X happens, you lose Y, consider Z"

</specifics>

<deferred>
## Deferred Ideas

- Correlation matrix between positions — v2 (needs large historical data)
- Conditional VaR (CVaR/Expected Shortfall) — v2
- Real-time VaR updates via WebSocket — v2

</deferred>

---

*Phase: 04-risk-scenario-simulation*
*Context gathered: 2026-03-27 via smart discuss (autonomous)*
