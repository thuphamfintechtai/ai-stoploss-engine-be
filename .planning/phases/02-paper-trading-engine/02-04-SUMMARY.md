---
phase: 02-paper-trading-engine
plan: "04"
subsystem: paper-trading
tags: [performance, metrics, buy-hold, drawdown, paper-trading]
dependency_graph:
  requires: ["02-01"]
  provides: ["PAPER-06", "paper-performance-api"]
  affects: ["paper-trading-frontend"]
tech_stack:
  added: []
  patterns: ["TDD red-green", "service-controller-route", "Joi validateQuery"]
key_files:
  created:
    - ai-stoploss-engine-be/services/paper/paperPerformanceService.js
    - ai-stoploss-engine-be/controllers/paper/paperPerformance.controller.js
    - ai-stoploss-engine-be/tests/services/paperPerformance.test.js
  modified:
    - ai-stoploss-engine-be/routes/portfolio.routes.js
decisions:
  - "Dung portfolio.routes.js cho route paper-performance (option A) vi phu hop hon voi pattern hien tai (real-summary, real-orders deu o day)"
  - "getFullReport dung Promise.all de goi 3 queries parallel, tang performance"
  - "profit_factor = 0 khi gross_loss = 0 (tranh div-by-zero, tranh Infinity)"
metrics:
  duration: "~15 phut"
  completed_date: "2026-03-27"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
requirements: [PAPER-06]
---

# Phase 02 Plan 04: Paper Trading Performance Report Summary

**One-liner:** Performance report service tinh P&L, win rate, profit factor, max drawdown va Buy & Hold comparison cho PAPER positions voi filter theo tuan/thang/all.

## What Was Built

### Task 1: PaperPerformanceService (TDD)

Service tinh hieu suat paper trading voi 4 phuong thuc:

- **`getPerformanceReport(portfolioId, { period })`** — Tinh total trades, winning/losing trades, total P&L, gross profit/loss, avg win/loss, win rate (%), profit factor. Chi query `context = 'PAPER'` (Pitfall 6). Filter theo period: week (7 ngay), month (30 ngay), all (khong filter).

- **`getMaxDrawdown(portfolioId, { period })`** — Build equity curve tu closed positions ORDER BY closed_at, tinh max drawdown bang cach track peak va trough. Tra ve `max_drawdown_vnd` va `max_drawdown_pct`.

- **`getBuyAndHoldReturn(portfolioId)`** — Tinh NET holdings (BUY qty - SELL qty) per symbol, GROUP BY symbol HAVING net_qty > 0 (Pitfall 7). Fetch gia hien tai tu marketPriceService cho moi symbol. Tra ve buy_hold_value, buy_hold_cost, buy_hold_return, buy_hold_return_pct.

- **`getFullReport(portfolioId, options)`** — Goi 3 methods tren song song (Promise.all), merge ket qua.

**Tests:** 13 tests pass, cover: 3 closed positions (2 win 1 loss), zero trades, PAPER context guard, week/month/all filters, drawdown equity curve, net holdings buy & hold.

### Task 2: Performance Report API Endpoint

- **`paperPerformance.controller.js`** — Export `getPerformanceReport` handler va `performanceQuerySchema` (Joi: period valid('all','week','month').default('all')). Dung `ensurePortfolioOwnership` pattern tu paperOrder.controller.js.

- **`portfolio.routes.js`** — Them route `GET /:portfolioId/paper-performance` voi `validateQuery(performanceQuerySchema)` middleware. Import `validateQuery` tu validation.js (deviation nho: them vao import list vi chua co).

## API Endpoint

```
GET /api/portfolios/:portfolioId/paper-performance?period=all|week|month

Response:
{
  "success": true,
  "data": {
    "total_trades": 10,
    "winning_trades": 7,
    "losing_trades": 3,
    "total_pnl": 5000000,
    "gross_profit": 7000000,
    "gross_loss": 2000000,
    "avg_win": 1000000,
    "avg_loss": 666666,
    "win_rate": 70.00,
    "profit_factor": 3.50,
    "max_drawdown_vnd": 1000000,
    "max_drawdown_pct": 15.38,
    "buy_hold_value": 25000000,
    "buy_hold_cost": 20000000,
    "buy_hold_return": 5000000,
    "buy_hold_return_pct": 25.00,
    "holdings": [...]
  }
}
```

## Commits

| Hash | Message |
|------|---------|
| e79bfc4 | test(02-04): add failing tests for PaperPerformanceService |
| 18f83ac | feat(02-04): add PaperPerformanceService with P&L metrics, drawdown, and buy & hold |
| aa7bc25 | feat(02-04): add performance report API endpoint and route |

## Deviations from Plan

None - plan executed exactly as written.

Minor adjustment: `validateQuery` was added to the import from `middleware/validation.js` in `portfolio.routes.js` since it wasn't imported before — this is Rule 3 (blocking issue fix, not a deviation).

## Known Stubs

None. All data flows from real database queries. Buy & Hold fetches live prices from marketPriceService (if market is closed, symbols with no price data are skipped but not shown as stub data).

## Self-Check: PASSED
