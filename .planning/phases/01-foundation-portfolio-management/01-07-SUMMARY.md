---
phase: 01-foundation-portfolio-management
plan: "07"
subsystem: testing
tags: [test-fix, mock, regression, capitalService]
dependency_graph:
  requires: [01-06]
  provides: [clean-test-suite]
  affects: [ci-pipeline]
tech_stack:
  added: []
  patterns: [vitest-module-mock]
key_files:
  created: []
  modified:
    - ai-stoploss-engine-be/tests/services/realOrderService.test.js
decisions:
  - "vi.mock capitalService.js duoc dat truoc import RealOrderService -- vitest hoisting dam bao mock active truoc khi module load"
  - "Mock deductForBuy tra undefined (thanh cong khong throw) -- tests kiem tra order/position creation, khong test capital logic"
metrics:
  duration: "5 minutes"
  completed: "2026-03-27"
  tasks_completed: 2
  files_modified: 1
---

# Phase 01 Plan 07: Fix CapitalService Mock Regression Summary

**One-liner:** Them vi.mock cho CapitalService.deductForBuy vao realOrderService.test.js, fix 4 failing tests do Plan 06 wire CapitalService nhung khong cap nhat test suite.

## What Was Fixed

### Root Cause

Plan 06 da integrate `CapitalService.deductForBuy` vao `realOrderService.js` (line 49):

```javascript
await CapitalService.deductForBuy(portfolioId, totalCost);
```

Nhung `realOrderService.test.js` chua co `vi.mock` tuong ung cho `capitalService.js`. Khi test chay:

1. `CapitalService` duoc import that (khong duoc mock)
2. `deductForBuy` goi `SELECT FOR UPDATE` qua mock database client
3. `mockClient.query` tra ve `rows: []` (theo database mock hien co)
4. `rows[0].available_cash` = `undefined` -> `NaN < totalCost` -> throw 422 "Insufficient funds"
5. 4 tests `recordBuyOrder` fail voi unintended 422 error

### Solution

Them `vi.mock('../../services/portfolio/capitalService.js')` vao khoi vi.mock phia tren cac dong `import` trong test file, voi:

- `deductForBuy: vi.fn().mockResolvedValue(undefined)` — khong throw, simulate du tien
- `addPendingSettlement: vi.fn().mockResolvedValue(undefined)` — mock day du interface
- `getBalance: vi.fn().mockResolvedValue({...})` — tra ve 10 ty VND available

## Test Results

| Test Suite | Before Fix | After Fix |
|------------|------------|-----------|
| realOrderService.test.js | 2/6 pass | 6/6 pass |
| Full suite | 35/39 pass | 39/39 pass |

```
Test Files  6 passed (6)
     Tests  39 passed (39)
  Duration  404ms
```

## Files Modified

| File | Change |
|------|--------|
| `ai-stoploss-engine-be/tests/services/realOrderService.test.js` | Them vi.mock block cho capitalService.js (13 lines) |

## Commits

| Hash | Description |
|------|-------------|
| e5c34f3 | test(01-07): add CapitalService mock to realOrderService tests |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- [x] File modified ton tai: `ai-stoploss-engine-be/tests/services/realOrderService.test.js`
- [x] Commit e5c34f3 ton tai
- [x] 39/39 tests pass
- [x] vi.mock capitalService.js co trong file test
