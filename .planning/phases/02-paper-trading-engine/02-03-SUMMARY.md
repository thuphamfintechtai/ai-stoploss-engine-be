---
phase: 02-paper-trading-engine
plan: "03"
subsystem: paper-trading
tags: [order-management, edit-order, cancel-refund, virtual-balance, tdd]
dependency_graph:
  requires: ["02-01"]
  provides: ["PAPER-04", "edit-order-endpoint", "cancel-refund"]
  affects: ["orders.routes.js", "paperOrder.controller.js"]
tech_stack:
  added: []
  patterns:
    - "Optimistic locking cho PATCH order (WHERE status = PENDING)"
    - "TDD: RED (failing tests) -> GREEN (implement) -> verify"
    - "Tick size snap tren edited limit_price (warning only)"
    - "Delta cost/refund khi edit quantity (chi BUY REALISTIC)"
key_files:
  created:
    - ai-stoploss-engine-be/tests/services/paperOrderManagement.test.js
  modified:
    - ai-stoploss-engine-be/controllers/paper/paperOrder.controller.js
    - ai-stoploss-engine-be/routes/orders.routes.js
decisions:
  - "editOrderSchema chi cho phep limit_price + quantity (per D-09), reject side/symbol"
  - "cancelOrder chi refund neu side=BUY va simulation_mode=REALISTIC (INSTANT khong deduct truoc)"
  - "Import tickSizeEngine tu services/shared/ thay vi services/ (dung path chuan)"
metrics:
  duration_minutes: 10
  completed_at: "2026-03-27T03:44:56Z"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 2
---

# Phase 02 Plan 03: Edit Order Endpoint + Cancel Refund Summary

**One-liner:** PATCH endpoint cho sua lenh PENDING (limit_price + quantity) voi tick size snap, virtual balance delta adjust, va refund khi cancel REALISTIC BUY order.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 (RED) | Failing tests cho editOrder + cancelOrder refund | e0a8b4c | tests/services/paperOrderManagement.test.js |
| 1 (GREEN) | editOrder controller + cancelOrder refund + PATCH route | ae4f77a | controllers/paper/paperOrder.controller.js, routes/orders.routes.js |

## What Was Built

### editOrderSchema (Joi)
- Chi cho phep `limit_price` (positive number) va `quantity` (integer >= 100)
- `.min(1)`: it nhat 1 field phai co
- Reject hoac moi field khac (side, symbol, order_type...) theo D-09

### editOrder controller
- `ensurePortfolioOwnership`: check portfolio thuoc user
- Check order ton tai va thuoc portfolio: 404 neu khong
- Check `order.status === 'PENDING'`: 409 (`ORDER_NOT_PENDING`) neu khong
- Check `order.context === 'PAPER'`: 400 neu khong
- `limit_price`: `snapToTickSize()` auto-snap, price band check (warning only)
- `quantity`: lot size check (boi 100), delta balance adjust:
  - Tang quantity (BUY): `getVirtualBalance()` -> check >= deltaCost -> 422 (`INSUFFICIENT_BALANCE`) neu khong du -> `deductForBuy(deltaCost)`
  - Giam quantity (BUY): `refundForCancel(refundAmount)`
- UPDATE voi optimistic locking: `WHERE status = 'PENDING'`
- `ExecutionLog.write('ORDER_MODIFIED')` voi old/new values
- Return 200 voi updated order

### cancelOrder update
- Sau khi cancel thanh cong: tinh `refundAmount = limitPrice * qty + buyFee`
- Chi refund neu `order.side === 'BUY' AND order.simulation_mode === 'REALISTIC'`
  - INSTANT: khong deduct truoc nen khong can refund
  - SELL: khong deduct cash nen khong refund

### PATCH route
- `router.patch('/:id', validate(editOrderSchema), editOrder)` trong orders.routes.js
- Import truc tiep tu `controllers/paper/paperOrder.controller.js`

## Tests
22/22 tests PASS:
- editOrderSchema validation (8 tests): body rong, limit_price, quantity, side/symbol reject
- editOrder controller (7 tests): 200, 422, 409, 404, tick size snap
- cancelOrder refund (3 tests): REALISTIC BUY refund, INSTANT no refund, SELL no refund
- Source code checks (4 tests): editOrder, editOrderSchema, refundForCancel, router.patch

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Import Fix] Correct tickSizeEngine import path**
- **Found during:** Task 1 (GREEN)
- **Issue:** Controller dang import tu `../../services/tickSizeEngine.js` nhung file thuc su nam o `../../services/shared/tickSizeEngine.js`
- **Fix:** Cap nhat import path trong paperOrder.controller.js
- **Files modified:** controllers/paper/paperOrder.controller.js
- **Commit:** ae4f77a

**2. [Rule 2 - Missing Import] Them PaperCapitalService, query, calculateBuyFee imports**
- **Found during:** Task 1 (GREEN)
- **Issue:** editOrder can PaperCapitalService, database query, calculateBuyFee nhung controller chua import
- **Fix:** Them 3 import moi vao paperOrder.controller.js
- **Files modified:** controllers/paper/paperOrder.controller.js
- **Commit:** ae4f77a

## Acceptance Criteria Check

- [x] `grep -q "editOrder" controllers/paper/paperOrder.controller.js`
- [x] `grep -q "editOrderSchema" controllers/paper/paperOrder.controller.js`
- [x] `grep -q "router.patch" routes/orders.routes.js`
- [x] `grep -q "refundForCancel" controllers/paper/paperOrder.controller.js`
- [x] `grep -q "ORDER_MODIFIED" controllers/paper/paperOrder.controller.js`
- [x] `test -f tests/services/paperOrderManagement.test.js`

## Known Stubs

None — tat ca logic duoc wire day du.

## Self-Check: PASSED

- controllers/paper/paperOrder.controller.js: FOUND (modified)
- routes/orders.routes.js: FOUND (modified)
- tests/services/paperOrderManagement.test.js: FOUND (created)
- Commit e0a8b4c: FOUND (RED phase)
- Commit ae4f77a: FOUND (GREEN phase)
- All 22 tests: PASSED
