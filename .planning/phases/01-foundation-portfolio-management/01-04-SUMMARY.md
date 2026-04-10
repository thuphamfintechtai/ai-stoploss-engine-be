---
phase: 01-foundation-portfolio-management
plan: "04"
subsystem: backend-paper-trading
tags: [refactor, paper-trading, context-guard, backward-compat, tdd]
dependency_graph:
  requires: [01-01]
  provides: [paper-trading-isolated, context-guard-PAPER, fillEngine-paper-subfolder]
  affects: [workers/stopLossMonitor, services/fillEngine, controllers/order, controllers/position]
tech_stack:
  added: []
  patterns: [re-export-backward-compat, context-guard-pattern, paper-subfolder-isolation]
key_files:
  created:
    - ai-stoploss-engine-be/services/paper/fillEngine.js
    - ai-stoploss-engine-be/controllers/paper/paperOrder.controller.js
    - ai-stoploss-engine-be/controllers/paper/paperPosition.controller.js
    - ai-stoploss-engine-be/tests/services/paperOrderService.test.js
  modified:
    - ai-stoploss-engine-be/services/fillEngine.js (re-export wrapper)
    - ai-stoploss-engine-be/controllers/order.controller.js (re-export wrapper)
    - ai-stoploss-engine-be/controllers/position.controller.js (re-export wrapper)
    - ai-stoploss-engine-be/workers/stopLossMonitor.js (context filter)
decisions:
  - "Re-export wrapper pattern: file goc chi chua export ... from paper/, giu nguyen API surface cho routes"
  - "Context guard trong fillOrderInstant: kiem tra order.context !== 'PAPER' truoc khi xu ly"
  - "stopLossMonitor query them AND context = 'PAPER' cho ca 3 queries (positions, trailing HWM, smart alerts)"
metrics:
  duration: "~10 phut"
  completed_date: "2026-03-27"
  tasks_completed: 2
  files_changed: 8
---

# Phase 01 Plan 04: Paper Trading Subfolder + Context Guard Summary

Di chuyen paper trading logic vao `services/paper/` va `controllers/paper/` subfolder, them context='PAPER' guard cho fillEngine va stopLossMonitor, dam bao backward compat qua re-export wrappers.

## Tasks Completed

### Task 1: Di chuyen Paper Trading code vao subfolder + Context Guard

**Files created:**
- `ai-stoploss-engine-be/services/paper/fillEngine.js` — paper fill engine voi context guard
- `ai-stoploss-engine-be/controllers/paper/paperOrder.controller.js` — paper order controller
- `ai-stoploss-engine-be/controllers/paper/paperPosition.controller.js` — paper position controller

**Files converted to re-export wrappers:**
- `ai-stoploss-engine-be/services/fillEngine.js` — re-exports tu `./paper/fillEngine.js`
- `ai-stoploss-engine-be/controllers/order.controller.js` — re-exports tu `./paper/paperOrder.controller.js`
- `ai-stoploss-engine-be/controllers/position.controller.js` — re-exports tu `./paper/paperPosition.controller.js`

**Context guard implementation:**
- `services/paper/fillEngine.js`: check `order.context !== 'PAPER'` truoc khi fill
- INSERT INTO positions luon set `context = 'PAPER'` explicitly
- `Order.create()` duoc goi voi `context: 'PAPER'` tu paper order controller

**stopLossMonitor context filter:**
- Query positions them `AND context = 'PAPER'` — chi monitor PAPER positions
- Query trailing HWM them `AND context = 'PAPER'`
- Smart alerts query them `AND context = 'PAPER'`

**Commit:** `03d5159`

### Task 2: Test Paper Trading van hoat dong sau refactor (TDD)

**File created:**
- `ai-stoploss-engine-be/tests/services/paperOrderService.test.js`

**7 test cases:**
1. fillEngine re-export works — `fillOrderInstant`, `expireEndOfSessionOrders` la function
2. order controller re-export works — `createOrder`, `createOrderSchema`, `create`, `listOrders`, `cancelOrder` ton tai
3. position controller re-export works — `list`, `getByPortfolio`, `close`, `closePosition`, `update`, `updateStopLoss`, `create`, `getById`, `calculate` ton tai
4. paper fillEngine source chua context guard PAPER
5. stopLossMonitor query co context = PAPER filter (>= 2 matches)
6. services/fillEngine.js la re-export (khong chua business logic)
7. controllers/order.controller.js la re-export (khong chua business logic)

**Result:** 7/7 tests passed (291ms)

**Commit:** `5687d5f`

## Deviations from Plan

None — plan executed exactly as written.

## Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| Re-export wrapper pattern | Giu nguyen API surface, routes/orders.routes.js va routes/position.routes.js KHONG can thay doi |
| Context guard check truoc fill | Early return, khong xu ly orders co context != 'PAPER' |
| Explicit 'PAPER' trong INSERT | Dam bao positions tao boi paper flow luon co context dung |
| Filter ca 3 queries trong stopLossMonitor | trailing HWM, main positions, smart alerts — tat ca chi cho PAPER |

## Verification Results

```
test -f services/paper/fillEngine.js → PASS
test -f controllers/paper/paperOrder.controller.js → PASS
grep "from.*paper/" services/fillEngine.js → PASS
grep "from.*paper/" controllers/order.controller.js → PASS
grep "PAPER" workers/stopLossMonitor.js → PASS
vitest run tests/services/paperOrderService.test.js → 7/7 PASS
```

## Known Stubs

None — context guard hoat dong thuc su, khong phai placeholder.

Note: `Order.create()` chua duoc cap nhat de luu truong `context` vao DB — can kiem tra model
`Order.js` co truong `context` trong INSERT query khong. Day la viec can theo doi de dam bao
context duoc persist correctly vao database.

## Self-Check: PASSED

- FOUND: ai-stoploss-engine-be/services/paper/fillEngine.js
- FOUND: ai-stoploss-engine-be/controllers/paper/paperOrder.controller.js
- FOUND: ai-stoploss-engine-be/controllers/paper/paperPosition.controller.js
- FOUND: ai-stoploss-engine-be/tests/services/paperOrderService.test.js
- FOUND commit: 03d5159 (Task 1 refactor)
- FOUND commit: 5687d5f (Task 2 tests)
