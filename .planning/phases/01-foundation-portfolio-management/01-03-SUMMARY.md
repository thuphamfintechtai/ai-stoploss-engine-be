---
phase: 01-foundation-portfolio-management
plan: "03"
subsystem: backend-capital-management
tags: [capital-service, settlement, t+2, cron, cash-balance]
dependency_graph:
  requires: [01-01]
  provides: [capital-service, settlement-worker]
  affects: [portfolio-cash-balance, settlement-events]
tech_stack:
  added: []
  patterns: [SELECT-FOR-UPDATE, node-cron, T+2-settlement, VN-holidays]
key_files:
  created:
    - ai-stoploss-engine-be/services/portfolio/capitalService.js
    - ai-stoploss-engine-be/workers/settlementWorker.js
    - ai-stoploss-engine-be/tests/services/capitalService.test.js
    - ai-stoploss-engine-be/tests/services/settlement.test.js
  modified:
    - ai-stoploss-engine-be/index.js
decisions:
  - "SELECT FOR UPDATE de tranh race condition khi nhieu user mua cung luc"
  - "VN_HOLIDAYS hardcode 2026-2027 vi khong co API chinh thuc tu HOSE/HNX"
  - "Settlement cron chay 9AM Mon-Fri truoc gio mo cua san (9:15 AM)"
metrics:
  duration: "~8 minutes"
  completed: "2026-03-27"
  tasks: 2
  files_changed: 5
---

# Phase 01 Plan 03: CapitalService & SettlementWorker Summary

CapitalService quan ly cash balance portfolio voi T+2 settlement theo quy dinh HOSE/HNX, SettlementWorker cron job chuyen tien pending sang available moi ngay 9AM Mon-Fri.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | CapitalService - Cash Balance Management voi T+2 Settlement | 7eb973c | services/portfolio/capitalService.js, tests/services/capitalService.test.js |
| 2 | Settlement Worker (cron job) + Register trong index.js | 907cb33 | workers/settlementWorker.js, index.js, tests/services/settlement.test.js |

## What Was Built

### CapitalService (`services/portfolio/capitalService.js`)

- `deductForBuy(portfolioId, totalCost)`: SELECT FOR UPDATE tren portfolios, check available_cash >= totalCost, UPDATE tru available_cash. Throw error statusCode=422 khi khong du tien.
- `addPendingSettlement(portfolioId, netAmount, settlementDate)`: UPDATE pending_settlement_cash += netAmount, INSERT settlement_events record voi status='PENDING'.
- `processSettlements()`: Query PENDING events <= CURRENT_DATE, chuyen tung event: available += amount, pending -= amount, status = SETTLED.
- `getBalance(portfolioId)`: Return { total_balance, available_cash, pending_settlement_cash, deployed_cash }.
- `addBusinessDays(date, days)`: Skip weekends (Sat/Sun) va VN_HOLIDAYS 2026-2027 (17 ngay nghi le).

### SettlementWorker (`workers/settlementWorker.js`)

- Cron schedule `0 9 * * 1-5`: chay moi ngay Mon-Fri luc 9:00 AM.
- Goi `CapitalService.processSettlements()`, log ket qua.
- Error handling: catch va log, khong crash worker.

### index.js Update

- Import `startSettlementWorker` tu workers/settlementWorker.js.
- Goi `startSettlementWorker()` ngay sau `startWorker()` trong `startServer()`.

## Test Results

16/16 tests pass:
- capitalService.test.js: 12 tests (addBusinessDays x4, deductForBuy x3, addPendingSettlement x1, processSettlements x2, getBalance x2)
- settlement.test.js: 4 tests (export check, cron pattern, processSettlements called, error handling)

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - CapitalService dung real SQL queries, khong co hardcoded data. VN_HOLIDAYS la intentional hardcode (khong co API chinh thuc, duoc document trong code voi TODO).

## Self-Check: PASSED

Files exist:
- FOUND: ai-stoploss-engine-be/services/portfolio/capitalService.js
- FOUND: ai-stoploss-engine-be/workers/settlementWorker.js
- FOUND: ai-stoploss-engine-be/tests/services/capitalService.test.js
- FOUND: ai-stoploss-engine-be/tests/services/settlement.test.js

Commits exist:
- 8b7efab: test(01-03): add failing tests for CapitalService (RED)
- 7eb973c: feat(01-03): implement CapitalService with T+2 settlement and VN holidays (GREEN)
- 907cb33: feat(01-03): add SettlementWorker cron job and register in index.js

Acceptance criteria:
- [x] services/portfolio/capitalService.js ton tai
- [x] Chua "FOR UPDATE" (row locking)
- [x] Chua "VN_HOLIDAYS" array voi 17 entries (>= 10)
- [x] Chua "addBusinessDays" function
- [x] Chua "statusCode: 422" khi khong du tien
- [x] Export default CapitalService va named export addBusinessDays
- [x] Tests pass: 16/16
- [x] workers/settlementWorker.js ton tai
- [x] cron.schedule '0 9 * * 1-5'
- [x] CapitalService.processSettlements() duoc goi
- [x] Export startSettlementWorker
- [x] index.js import va goi startSettlementWorker()
