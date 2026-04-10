---
phase: 02-paper-trading-engine
plan: "01"
subsystem: paper-trading
tags: [paper-trading, matching-engine, virtual-balance, migration, tdd]
dependency_graph:
  requires: []
  provides:
    - PaperMatchingEngine (slippage + fill probability cho MP/LO/ATO/ATC orders)
    - PaperCapitalService (virtual cash management voi T+2 settlement)
    - Migration 008 (virtual_balance fields + paper_settlement_events table)
  affects:
    - Phase 02 plans 02-05 (tat ca deu depend on PaperMatchingEngine va PaperCapitalService)
tech_stack:
  added: []
  patterns:
    - TDD red-green cho pure logic service (khong DB dependency khi test)
    - Static class methods (consistent voi CapitalService, RiskCalculator pattern)
    - SELECT FOR UPDATE de tranh race condition voi paper virtual cash
    - addBusinessDays reuse tu capitalService.js cho T+2 paper settlement
key_files:
  created:
    - ai-stoploss-engine-be/migrations/008_paper_virtual_balance.sql
    - ai-stoploss-engine-be/services/paper/paperMatchingEngine.js
    - ai-stoploss-engine-be/services/paper/paperCapitalService.js
    - ai-stoploss-engine-be/tests/services/paperMatchingEngine.test.js
    - ai-stoploss-engine-be/tests/services/paperCapitalService.test.js
  modified: []
decisions:
  - "PaperMatchingEngine dung static class methods (consistent voi CapitalService pattern)"
  - "Khong import slippageCalculator.js -- do la SL/TP slippage, khac voi order fill slippage"
  - "Chỉ import addBusinessDays helper tu capitalService.js, KHONG import class"
  - "paper_settlement_events tach biet hoan toan khoi settlement_events (REAL) -- khong mix data"
metrics:
  duration: "4 minutes"
  completed_date: "2026-03-27"
  tasks_completed: 2
  files_created: 5
  tests_passing: 34
---

# Phase 02 Plan 01: Paper Trading Foundation (Matching Engine + Capital Service) Summary

**One-liner:** PaperMatchingEngine voi slippage formula D-02 (base_spread + volume impact), fill probability cho LO orders, va PaperCapitalService voi SELECT FOR UPDATE va T+2 settlement qua paper_settlement_events table rieng.

## What Was Built

### Migration 008 (`008_paper_virtual_balance.sql`)
- ALTER TABLE portfolios: them 3 columns: `virtual_balance` (DEFAULT 1B VND), `paper_available_cash` (DEFAULT 1B VND), `paper_pending_settlement` (DEFAULT 0)
- CREATE TABLE `paper_settlement_events`: track T+2 settlement events cho paper trading (rieng biet khoi `settlement_events` REAL)
- 2 indexes: `idx_paper_settlement_portfolio` va `idx_paper_settlement_date` (partial WHERE status='PENDING')
- Backfill: `paper_available_cash = virtual_balance` cho portfolios cu

### PaperMatchingEngine (`services/paper/paperMatchingEngine.js`)
- `calculateSlippage(price, qty, avgDailyVolume, exchange)`: slippage = Math.round(price * baseSpread * (1 + qty/avgDailyVolume)), 3 liquidity tiers (HIGH/MEDIUM/LOW)
- `calculateFillProbability(orderQty, avgDailyVolume)`: 5 ratio ranges → 0.95/0.80/0.50/0.25/0.10
- `tryFillLimitOrder(order, currentPrice, avgDailyVolume)`: BUY fill khi currentPrice <= limitPrice, SELL khi >= limitPrice, voi fill probability check
- `fillMarketOrder(order, currentPrice, avgDailyVolume, exchange)`: BUY price+slippage / SELL price-slippage, snap to tick size + clamp within price band
- `fillATOOrder(order, openPrice)` / `fillATCOrder(order, closePrice)`: fill tai gia chinh xac, slippage=0

### PaperCapitalService (`services/paper/paperCapitalService.js`)
- `deductForBuy(portfolioId, totalCost)`: transaction voi SELECT FOR UPDATE, throw 422 neu paper_available_cash < totalCost
- `addPendingSettlement(portfolioId, netAmount, orderId?)`: tinh T+2 via `addBusinessDays(new Date(), 2)`, update pending + insert paper_settlement_events
- `processSettlements()`: query pending events den han, chuyen amount tu pending sang available (SETTLED)
- `getVirtualBalance(portfolioId)`: return { virtual_balance, paper_available_cash, paper_pending_settlement, paper_deployed }
- `refundForCancel(portfolioId, amount)`: cong lai paper_available_cash khi cancel

## Tests

- `paperMatchingEngine.test.js`: 20 tests, tat ca PASS
- `paperCapitalService.test.js`: 14 tests, tat ca PASS
- Tong: **34 tests PASS**

## Commits

| Task | Commit | Files |
|------|--------|-------|
| TDD RED - MatchingEngine test | ce0f62a | tests/services/paperMatchingEngine.test.js |
| Migration 008 | 3ee4fb7 | migrations/008_paper_virtual_balance.sql |
| PaperMatchingEngine impl | aea576e | services/paper/paperMatchingEngine.js |
| TDD RED - CapitalService test | eccfb31 | tests/services/paperCapitalService.test.js |
| PaperCapitalService impl | 6e06733 | services/paper/paperCapitalService.js |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test mock capture query order sai trong paperCapitalService.test.js**
- **Found during:** Task 2 GREEN phase
- **Issue:** Tests capture SQL query bang bien don, nhung mockClient.query duoc goi nhieu lan (SELECT + UPDATE). Bien chi luu query cuoi cung la UPDATE portfolios status = SETTLED, khong phai UPDATE available_cash
- **Fix:** Doi sang `capturedQueries` array, dung `.some()` / `.find()` de kiem tra bat ky query nao match pattern
- **Files modified:** tests/services/paperCapitalService.test.js
- **Commit:** eccfb31 (included in test file)

## Known Stubs

None — tat ca methods deu co implementation day du.

## Self-Check: PASSED
