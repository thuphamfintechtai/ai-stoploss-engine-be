# Phase 1: Foundation & Portfolio Management - Validation Architecture

**Generated from:** 01-RESEARCH.md "Validation Architecture" section
**Date:** 2026-03-27

## Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (setup trong Plan 01, Task 2) |
| Config file | `ai-stoploss-engine-be/vitest.config.js` |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

## Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | Plan |
|--------|----------|-----------|-------------------|------|
| FOUND-01 | Context separation -- REAL vs PAPER queries return correct data | unit | `npx vitest run tests/services/contextSeparation.test.js` | 01-01 (migration), 01-04 (guard) |
| FOUND-02 | Migration adds context column with default PAPER | manual | Run migration, verify schema | 01-01 |
| FOUND-03 | RealOrderService does NOT call fillEngine | unit | `npx vitest run tests/services/realOrderService.test.js` | 01-02 |
| FOUND-04 | Paper order still uses fillEngine correctly | unit | `npx vitest run tests/services/paperOrderService.test.js` | 01-04 |
| FOUND-05 | Shared kernel services importable from both contexts | unit | `npx vitest run tests/services/sharedKernel.test.js` | 01-01 |
| PORT-01 | Real order creation with valid input | unit | `npx vitest run tests/controllers/realOrder.test.js` | 01-02 |
| PORT-02 | Cash balance correctly calculated | unit | `npx vitest run tests/services/capitalService.test.js` | 01-03 |
| PORT-03 | T+2 settlement moves pending to available | unit | `npx vitest run tests/services/settlement.test.js` | 01-03 |
| PORT-04 | Position close calculates correct P&L with fees | unit | `npx vitest run tests/services/realPositionService.test.js` | 01-02 |
| PORT-05 | Transaction history query returns correct data | unit | `npx vitest run tests/services/transactionHistory.test.js` | 01-02 |
| PORT-06 | Portfolio summary aggregation correct | unit | `npx vitest run tests/services/portfolioSummary.test.js` | 01-06 |

## Sampling Rate

- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

## Wave 0 Gaps (addressed in Plan 01-01, Task 2)

- [x] `ai-stoploss-engine-be/vitest.config.js` -- vitest config for backend
- [x] `ai-stoploss-engine-be/tests/` directory -- test root
- [x] `ai-stoploss-engine-be/tests/helpers/db.js` -- mock database helper (mock pg query)
- [x] Install vitest: `cd ai-stoploss-engine-be && npm install -D vitest`

## Verification Strategy

### Unit Tests (per plan)
- Plan 01-01: vitest setup works (`npx vitest run` exits 0)
- Plan 01-02: realOrderService + realPositionService tests pass
- Plan 01-03: capitalService + settlement tests pass
- Plan 01-04: paper backward compat tests pass
- Plan 01-06: portfolioSummary tests pass

### Integration Checks (per wave)
- Wave 1 (Plan 01): Migration file valid, vitest runs, shared kernel re-exports work
- Wave 2 (Plans 02-04): All backend services tested, context guards in place
- Wave 3 (Plans 05-06): Frontend renders, API endpoints respond correctly

### Phase Gate
- `npx vitest run` -- all tests pass
- Manual: Paper trading flow unchanged
- Manual: Real order form -> position -> close -> P&L verified
- Manual: Cash balance deduct on buy, pending on sell, T+2 settlement
