---
phase: 01-foundation-portfolio-management
plan: "06"
subsystem: backend-portfolio
tags: [capital-service, cash-flow, portfolio-summary, settlement, pnl]
dependency_graph:
  requires: [01-02, 01-03, 01-04]
  provides: [cash-flow-complete, portfolio-summary-endpoint]
  affects: [ai-stoploss-engine-be]
tech_stack:
  added: []
  patterns:
    - CapitalService.deductForBuy wired vao recordBuyOrder truoc khi tao order/position
    - CapitalService.addPendingSettlement wired vao closePosition sau khi dong vi the
    - T+2 settlement date tinh qua addBusinessDays (skip weekends + VN holidays)
    - Portfolio summary aggregate OPEN positions (total_value) va CLOSED_MANUAL (realized_pnl)
    - TDD pattern: test FAIL truoc -> implementation -> test PASS
key_files:
  created:
    - ai-stoploss-engine-be/controllers/portfolio/portfolioSummary.controller.js
    - ai-stoploss-engine-be/tests/services/portfolioSummary.test.js
  modified:
    - ai-stoploss-engine-be/services/portfolio/realOrderService.js
    - ai-stoploss-engine-be/services/portfolio/realPositionService.js
    - ai-stoploss-engine-be/controllers/portfolio/realOrder.controller.js
    - ai-stoploss-engine-be/routes/portfolio.routes.js
decisions:
  - "CapitalService.deductForBuy duoc goi trong service (realOrderService) khong phai controller -- giu business logic trong service layer"
  - "closePosition trong transaction nhung addPendingSettlement goi sau transaction -- CapitalService tu quan ly transaction cua no"
  - "total_unrealized_pnl = 0 tam thoi, Phase 5 tich hop VPBS market price"
metrics:
  duration: "~10 minutes"
  completed_date: "2026-03-27"
  tasks_completed: 2
  files_modified: 6
---

# Phase 01 Plan 06: CapitalService Integration + Portfolio Summary

Wire CapitalService vao real buy/sell flow va xay dung portfolio summary endpoint voi total_value, realized P&L, % return.

## Tasks Completed

### Task 1: Wire CapitalService vao Real Order + Position Close Flow

**Commit:** `ai-stoploss-engine-be@8d8adef`

**realOrderService.js:**
- Import CapitalService tu `./capitalService.js`
- Tinh `totalCost = (filledPrice * quantity) + buyFeeVnd`
- Goi `CapitalService.deductForBuy(portfolioId, totalCost)` TRUOC khi tao order/position
- Neu khong du tien (422) -> error bubble up tu nhien

**realPositionService.js:**
- Import `CapitalService, { addBusinessDays }` tu `./capitalService.js`
- Sau khi update position sang CLOSED_MANUAL, tinh `netSellProceeds`
- Goi `CapitalService.addPendingSettlement(portfolioId, netSellProceeds, settlementDate)` (T+2)
- Return them `settlementDate` trong response

**realOrder.controller.js:**
- Catch `error.statusCode === 422` va tra ve 422 response ro rang
- Khong pass 422 error xuong global error handler

### Task 2: Portfolio Summary Endpoint (TDD)

**Commit (test):** `ai-stoploss-engine-be@05ce49a`
**Commit (impl):** `ai-stoploss-engine-be@4dcdfd9`

**portfolioSummary.controller.js:**
- `GET /:portfolioId/real-summary` endpoint
- Lay cash balance tu `CapitalService.getBalance`
- Aggregate OPEN real positions: `SUM(entry_price * quantity)` = total_value
- Aggregate CLOSED_MANUAL positions: `SUM(realized_pnl_vnd)` = total_realized_pnl
- Tinh `percent_return = total_pnl / total_balance * 100`
- Response: `{ total_value, total_realized_pnl, total_unrealized_pnl, total_pnl, percent_return, position_count, closed_count, cash_balance }`

**routes/portfolio.routes.js:**
- Them `router.get('/:portfolioId/real-summary', portfolioSummaryController.getPortfolioSummary)`

**Tests (5 passed):**
- Portfolio rong tra ve zeros
- Tinh tong gia tri dung voi 2 OPEN positions
- Tinh realized P&L dung voi 1 CLOSED_MANUAL position
- Tinh percent_return chinh xac theo total_balance
- Response co cau truc day du

## Verification

```bash
grep -q "CapitalService.deductForBuy" services/portfolio/realOrderService.js
grep -q "CapitalService.addPendingSettlement" services/portfolio/realPositionService.js
grep -q "addBusinessDays" services/portfolio/realPositionService.js
# => PASS

npx vitest run tests/services/portfolioSummary.test.js
# => 5 tests PASSED

grep -q "real-summary" routes/portfolio.routes.js
# => PASS
```

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

- `total_unrealized_pnl = 0` trong portfolioSummary.controller.js (line ~52): Tam thoi hardcode = 0. Phase 5 se tich hop VPBS market price de tinh unrealized P&L chinh xac.

## Self-Check: PASSED

Files created/modified:
- FOUND: ai-stoploss-engine-be/controllers/portfolio/portfolioSummary.controller.js
- FOUND: ai-stoploss-engine-be/tests/services/portfolioSummary.test.js
- FOUND: ai-stoploss-engine-be/services/portfolio/realOrderService.js (CapitalService.deductForBuy)
- FOUND: ai-stoploss-engine-be/services/portfolio/realPositionService.js (addPendingSettlement)
- FOUND: ai-stoploss-engine-be/routes/portfolio.routes.js (real-summary route)

Commits:
- FOUND: 8d8adef (Task 1 - wire CapitalService)
- FOUND: 05ce49a (Task 2 - RED tests)
- FOUND: 4dcdfd9 (Task 2 - GREEN implementation)
