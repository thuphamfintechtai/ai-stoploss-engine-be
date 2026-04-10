---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 04-risk-scenario-simulation-04-02-PLAN.md
last_updated: "2026-03-28T15:17:36.196Z"
last_activity: 2026-03-28
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 22
  completed_plans: 23
  percent: 74
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-26)

**Core value:** Giup nha dau tu quan ly rui ro thong minh -- biet khi nao cat lo, khi nao chot loi, voi AI ho tro phan tich thay vi quyet dinh cam tinh.
**Current focus:** Phase 04 — risk-scenario-simulation

## Current Position

Phase: 05
Plan: Not started
Status: Ready to execute
Last activity: 2026-04-01 - Completed quick task 260401-x9v: Fix vpbankFetch HTML response handling in market.controller.js

Progress: [███████░░░] 74%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01-foundation-portfolio-management P01 | 5 | 3 tasks | 18 files |
| Phase 01-foundation-portfolio-management P03 | 8 minutes | 2 tasks | 5 files |
| Phase 01-foundation-portfolio-management P02 | 4 | 2 tasks | 9 files |
| Phase 01-foundation-portfolio-management P04 | 10 min | 2 tasks | 8 files |
| Phase 01-foundation-portfolio-management P06 | 10 min | 2 tasks | 6 files |
| Phase 01-foundation-portfolio-management P05 | 15 min | 3 tasks | 7 files |
| Phase 01-foundation-portfolio-management P07 | 5 min | 2 tasks | 1 files |
| Phase 01-foundation-portfolio-management P08 | 15 | 2 tasks | 3 files |
| Phase 02-paper-trading-engine P01 | 4 min | 2 tasks | 5 files |
| Phase 02-paper-trading-engine P04 | 15 | 2 tasks | 4 files |
| Phase 02-paper-trading-engine P03 | 10 | 1 tasks | 3 files |
| Phase 02-paper-trading-engine P02-02 | 25m | 2 tasks | 5 files |
| Phase 02-paper-trading-engine P05 | 5 | 3 tasks | 5 files |
| Phase 03-ai-enhancement P01 | 3 min | 2 tasks | 8 files |
| Phase 03-ai-enhancement P03 | 25 | 2 tasks | 3 files |
| Phase 03-ai-enhancement P02 | 15 | 2 tasks | 4 files |
| Phase 03-ai-enhancement P04 | 5 min | 2 tasks | 4 files |
| Phase 03 P05 | 8 | 2 tasks | 4 files |
| Phase 03-ai-enhancement P06 | 25 | 3 tasks | 4 files |
| Phase 04-risk-scenario-simulation P01 | 15min | 2 tasks | 8 files |
| Phase 04-risk-scenario-simulation P02 | 15 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Tach Portfolio Management vs Paper Trading la Phase 1 -- moi thu khac phu thuoc vao day
- [Roadmap]: Phase 2 (Paper Trading) va Phase 3 (AI) co the chay song song sau Phase 1
- [Roadmap]: Phase 4 (Risk Simulation) phu thuoc Phase 3 vi can SL/TP data chinh xac lam input
- [Phase 01-foundation-portfolio-management]: Context column DEFAULT 'PAPER' -- data cu tu dong la PAPER, khong can complex data migration
- [Phase 01-foundation-portfolio-management]: Copy + re-export pattern cho shared kernel -- backward compat 100%, existing imports khong bi break
- [Phase 01-foundation-portfolio-management]: stop_loss DROP NOT NULL + CHECK constraint moi cho phep NULL chi khi context=REAL
- [Phase 01-foundation-portfolio-management]: SELECT FOR UPDATE de tranh race condition khi nhieu user mua cung luc
- [Phase 01-foundation-portfolio-management]: VN_HOLIDAYS hardcode 2026-2027, settlement cron chay 9AM Mon-Fri truoc gio mo san
- [Phase 01-foundation-portfolio-management]: SELL side trong createRealOrder delegate sang /close endpoint -- giu concern separation ro rang
- [Phase 01-foundation-portfolio-management]: Order.create va Position.create updated de support context column (migration 007) -- backward compatible voi default PAPER
- [Phase 01-foundation-portfolio-management]: Re-export wrapper pattern giu nguyen API surface -- routes khong can thay doi
- [Phase 01-foundation-portfolio-management]: Context guard trong paper fillEngine -- check order.context !== 'PAPER' truoc khi xu ly
- [Phase 01-foundation-portfolio-management]: CapitalService.deductForBuy duoc goi trong service layer (realOrderService), giu business logic tach khoi controller
- [Phase 01-foundation-portfolio-management]: total_unrealized_pnl tam thoi = 0, Phase 5 se tich hop VPBS market price
- [Phase 01-foundation-portfolio-management]: mainTab state (REAL/PAPER) tach biet voi activeTab de tranh collision voi paper trading tabs hien co
- [Phase 01-foundation-portfolio-management]: vi.mock capitalService.js dat truoc import RealOrderService -- vitest hoisting dam bao mock active truoc khi module load
- [Phase 01-08]: Render PortfolioSummaryCard chi khi realSummary !== null de tranh flash empty state
- [Phase 02-paper-trading-engine]: PaperMatchingEngine dung static class methods -- KHONG import slippageCalculator.js (SL/TP slippage khac voi order fill slippage)
- [Phase 02-paper-trading-engine]: paper_settlement_events tach biet khoi settlement_events REAL -- khong mix data giua 2 module
- [Phase 02-paper-trading-engine]: Chi import addBusinessDays helper tu capitalService.js, KHONG import CapitalService class -- giu dependency toi thieu
- [Phase 02-paper-trading-engine]: Dung portfolio.routes.js cho route paper-performance, goi Promise.all de parallel 3 queries, profit_factor = 0 khi gross_loss = 0
- [Phase 02-paper-trading-engine]: editOrderSchema chi cho phep limit_price + quantity (per D-09), reject side/symbol fields
- [Phase 02-paper-trading-engine]: cancelOrder chi refund neu side=BUY va simulation_mode=REALISTIC
- [Phase 02-paper-trading-engine]: fillOrderInstant giữ nguyên nhưng thêm deductForBuy và addPendingSettlement (Pitfall 4 fix và SELL T+2)
- [Phase 02-paper-trading-engine]: PaperFillWorker dùng 3 cron jobs: fill */30s, expire 15:00, settlement 09:00 với market hours guard
- [Phase 02-paper-trading-engine]: PaperOrderManager thay the inline order table de co edit/cancel UI day du
- [Phase 02-paper-trading-engine]: Default simulationMode = REALISTIC cho paper trading
- [Phase 03-ai-enhancement P01]: REGIME_MULTIPLIERS VOLATILE=2.5, BULLISH=1.5, BEARISH=1.5, SIDEWAYS=1.0 (per D-03/D-04)
- [Phase 03-ai-enhancement P01]: BB percentile nguong 70%: (upper-lower)/middle*100 > 70 cho VOLATILE detection
- [Phase 03-ai-enhancement P01]: priceBandValidator dung snapToTickSize tu shared/tickSizeEngine.js -- khong duplicate logic
- [Phase 03-ai-enhancement P01]: indicatorCache TTL stale check lazy eviction trong getter -- khong dung setInterval
- [Phase 03-ai-enhancement]: probabilityTP service dung log-normal distribution voi simple-statistics (probit, mean, stddev)
- [Phase 03-ai-enhancement]: Fetch OHLCV 200 ngay rieng cho probability TP, giu 50 ngay cho SL - khong anh huong nhau
- [Phase 03-ai-enhancement]: calculateDynamicSL trailing logic: LONG chi tang, SHORT chi giam de dam bao SL khong bao gio di nguoc chieu co loi
- [Phase 03-ai-enhancement]: Dynamic SL cron chay ca REAL va PAPER positions, gioi han 5 concurrent symbols de tranh VPBS rate limit
- [Phase 03-ai-enhancement]: Half-Kelly cap 25% tránh over-leverage, combined stats = average of contexts
- [Phase 03]: Promise.race 5s timeout cho Gemini rebalancing narrative, fallback rule-based bang tieng Viet
- [Phase 03]: Sector concentration threshold 30% per D-18 cho rebalancing warnings
- [Phase 03-ai-enhancement]: Su dung wsService.socket.on truc tiep cho DYNAMIC_SL_UPDATE vi WebSocketService chua co wrapper method
- [Phase 03-ai-enhancement]: Reuse RiskGauge component cho risk budget display de nhat quan UI
- [Phase 04-risk-scenario-simulation]: simple-statistics export quantile() khong phai percentile() -- dung quantile() trong varService va monteCarloService
- [Phase 04-risk-scenario-simulation]: Value-based concentration (entry_price x qty) trong sectorConcentration, phan biet voi risk-based trong capitalAllocation
- [Phase 04-risk-scenario-simulation]: SECTOR_BETAS: BANKING:1.2, REAL_ESTATE:1.5, TECHNOLOGY:0.8, STEEL:1.3, SECURITIES:1.4, ENERGY:0.9, CONSUMER:0.7, RETAIL:0.8, OTHER:1.0
- [Phase 04-risk-scenario-simulation]: Monte Carlo endpoint returns only percentileBands + finalValueDistribution, not raw 1000 paths to avoid payload bloat

### Pending Todos

None yet.

### Blockers/Concerns

- T+2 holiday calendar: Can hardcode lich nghi le HOSE/HNX 2026-2027 (khong co API chinh thuc)
- Probabilistic TP cho VN market: Log-normal distribution co the bi distort boi gia tran/san -- can backtest voi du lieu thuc

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260401-x9v | Fix vpbankFetch HTML response handling in market.controller.js | 2026-04-01 | 21b06c3 | [260401-x9v-fix-vpbankfetch-html-response-handling-i](./quick/260401-x9v-fix-vpbankfetch-html-response-handling-i/) |

## Session Continuity

Last session: 2026-03-27T06:00:28.582Z
Stopped at: Completed 04-risk-scenario-simulation-04-02-PLAN.md
Resume file: None
