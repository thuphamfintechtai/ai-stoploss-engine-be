---
phase: 01-foundation-portfolio-management
plan: 02
subsystem: backend-services
tags: [real-order, real-position, tdd, services, controllers, routes, vitest]

# Dependency graph
requires: [01-01]
provides:
  - RealOrderService: recordBuyOrder + getTransactionHistory (context=REAL, no fillEngine)
  - RealPositionService: closePosition + getOpenPositions (CLOSED_MANUAL, P&L with fees)
  - realOrder.controller.js: createRealOrder, getTransactionHistory, createRealOrderSchema
  - realPosition.controller.js: closePosition, getOpenPositions, closePositionSchema
  - 4 new API routes: POST/GET real-orders, GET real-positions, POST real-positions/:id/close
affects: [01-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "services/portfolio/ subdirectory cho domain-specific services"
    - "controllers/portfolio/ subdirectory cho domain-specific controllers"
    - "TDD: test truoc (RED), implement sau (GREEN), 11 test cases"
    - "Transaction-safe closePosition: find + create sell order + update position trong 1 transaction"
    - "context='REAL' phan biet real orders khoi paper trading"

key-files:
  created:
    - ai-stoploss-engine-be/services/portfolio/realOrderService.js
    - ai-stoploss-engine-be/services/portfolio/realPositionService.js
    - ai-stoploss-engine-be/controllers/portfolio/realOrder.controller.js
    - ai-stoploss-engine-be/controllers/portfolio/realPosition.controller.js
    - ai-stoploss-engine-be/tests/services/realOrderService.test.js
    - ai-stoploss-engine-be/tests/services/realPositionService.test.js
  modified:
    - ai-stoploss-engine-be/routes/portfolio.routes.js
    - ai-stoploss-engine-be/models/Order.js
    - ai-stoploss-engine-be/models/Position.js

key-decisions:
  - "SELL side trong createRealOrder delegate sang realPosition.controller (/close endpoint) thay vi xu ly lang man trong 1 endpoint"
  - "Order.create va Position.create duoc update de accept context, status, manualEntry -- models phai ho tro cac columns tu migration 007"
  - "Transaction-safe closePosition: find + sell order + update position trong 1 DB transaction"

patterns-established:
  - "controllers/portfolio/ cho Real order controllers (tach khoi controllers/ goc)"
  - "services/portfolio/ cho Real order services"
  - "TDD pattern: vi.mock truoc khi import service, then test RED -> GREEN"

requirements-completed: [FOUND-03, PORT-01, PORT-04, PORT-05]

# Metrics
duration: 4min
completed: 2026-03-27
---

# Phase 01 Plan 02: RealOrderService + RealPositionService + Controllers + Routes Summary

**RealOrderService (recordBuyOrder + transaction history) + RealPositionService (closePosition voi calculateFees, CLOSED_MANUAL) + 2 controllers + 4 API routes, TDD 11 tests pass**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-27T07:32:00Z
- **Completed:** 2026-03-27T07:36:00Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments

- Task 1: TDD implementation RealOrderService va RealPositionService voi 11 unit tests pass
- Task 2: Controllers + Routes cho 4 endpoints moi, Joi validation, no CapitalService
- Deviation fix: Order.create va Position.create updated de support context/manualEntry/buyFeeVnd (migration 007 columns)

## Task Commits

Moi task duoc commit rieng biet:

1. **Task 1 RED** - `b0139cf` (test): failing tests for RealOrderService va RealPositionService
2. **Task 1 GREEN** - `e453f58` (feat): implement RealOrderService va RealPositionService + model fixes
3. **Task 2** - `2387abe` (feat): controllers va routes cho real order entry va position close

## Files Created/Modified

- `ai-stoploss-engine-be/services/portfolio/realOrderService.js` - RealOrderService: recordBuyOrder (context=REAL, KHONG fillEngine) + getTransactionHistory
- `ai-stoploss-engine-be/services/portfolio/realPositionService.js` - RealPositionService: closePosition (transaction, calculateFees, CLOSED_MANUAL) + getOpenPositions
- `ai-stoploss-engine-be/controllers/portfolio/realOrder.controller.js` - HTTP handler: createRealOrder (BUY side), getTransactionHistory, createRealOrderSchema
- `ai-stoploss-engine-be/controllers/portfolio/realPosition.controller.js` - HTTP handler: closePosition, getOpenPositions, closePositionSchema
- `ai-stoploss-engine-be/routes/portfolio.routes.js` - 4 routes moi (POST/GET real-orders, GET real-positions, POST close); routes cu khong bi anh huong
- `ai-stoploss-engine-be/tests/services/realOrderService.test.js` - 6 test cases (TDD)
- `ai-stoploss-engine-be/tests/services/realPositionService.test.js` - 5 test cases (TDD)
- `ai-stoploss-engine-be/models/Order.js` - Them context/status/manualEntry/actualFilledAt params
- `ai-stoploss-engine-be/models/Position.js` - Them context/buyFeeVnd params

## Decisions Made

- **SELL side delegate sang /close endpoint**: createRealOrder chi xu ly BUY. SELL side tra ve 400 voi goi y dung `/close` endpoint. Giu concern separation ro rang.
- **Order.create va Position.create updated**: Cac models khong ho tro context (migration 007 column). Update models la correctness fix, khong phai architectural change.
- **Transaction cho closePosition**: Find + create sell order + update position trong 1 DB transaction de dam bao atomicity.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Order.create va Position.create khong ho tro context column (migration 007)**
- **Found during:** Task 1 implementation
- **Issue:** Order.create hardcodes `status='PENDING'`, khong co context/manualEntry/actualFilledAt params. Position.create khong co context/buyFeeVnd params. Cac fields nay la required cho REAL orders.
- **Fix:** Added optional params voi default values (backward compatible). Order.create: context='PAPER', status='PENDING', manualEntry=false, actualFilledAt=null. Position.create: context='PAPER', buyFeeVnd=0.
- **Files modified:** models/Order.js, models/Position.js
- **Commits:** e453f58

## Known Stubs

None - tat ca data duoc wire tu database, khong co placeholder.

## Next Phase Readiness

- RealOrderService san sang cho Plan 06 (CapitalService wire: cash deduction sau recordBuyOrder)
- RealPositionService san sang cho Plan 06 (pending settlement sau closePosition)
- 4 API endpoints san sang cho frontend integration (Plan 04)
- 27 total unit tests pass (bao gom cac tests tu Plan 01)

## Self-Check: PASSED

- [x] services/portfolio/realOrderService.js ton tai
- [x] services/portfolio/realPositionService.js ton tai
- [x] controllers/portfolio/realOrder.controller.js ton tai
- [x] controllers/portfolio/realPosition.controller.js ton tai
- [x] tests/services/realOrderService.test.js ton tai (6 tests)
- [x] tests/services/realPositionService.test.js ton tai (5 tests)
- [x] routes/portfolio.routes.js updated voi 4 routes moi
- [x] All commits exist: b0139cf, e453f58, 2387abe
- [x] 11 new tests pass, 27 total tests pass

---
*Phase: 01-foundation-portfolio-management*
*Completed: 2026-03-27*
