---
phase: 02-paper-trading-engine
plan: "02"
subsystem: paper-trading
tags: [fill-engine, realistic-mode, matching-engine, worker, cron, capital-management]
dependency_graph:
  requires: ["02-01"]
  provides: ["fillOrderRealistic", "PaperFillWorker", "deductForBuy-integration"]
  affects: ["02-03", "02-04", "paperOrder.controller.js", "index.js"]
tech_stack:
  added: []
  patterns:
    - "URL-based fetch routing in tests (mockImplementation with url check)"
    - "In-memory Map cache với TTL cho avgDailyVolume"
    - "Shared createPositionFromOrder helper để DRY giữa fillOrderInstant và fillOrderRealistic"
    - "PaperMatchingEngine delegation pattern cho slippage + fill probability"
key_files:
  created:
    - ai-stoploss-engine-be/workers/paperFillWorker.js
    - ai-stoploss-engine-be/tests/services/paperFillEngine.test.js
  modified:
    - ai-stoploss-engine-be/services/paper/fillEngine.js
    - ai-stoploss-engine-be/controllers/paper/paperOrder.controller.js
    - ai-stoploss-engine-be/index.js
decisions:
  - "fillOrderInstant được giữ nguyên nhưng thêm deductForBuy và addPendingSettlement (Pitfall 4 fix)"
  - "getAvgDailyVolume dùng in-memory Map cache 1 giờ, fallback 100000 nếu fetch fail"
  - "createPositionFromOrder tách thành helper riêng để tránh code duplication giữa INSTANT và REALISTIC"
  - "PaperFillWorker dùng dynamic import cho database.js để tránh circular deps"
  - "Test suite dùng url-based mockImplementation thay vì mockResolvedValueOnce vì volume cache gây ordering issues"
metrics:
  duration: "~25 phút"
  completed_date: "2026-03-27"
  tasks_completed: 2
  files_changed: 5
---

# Phase 02 Plan 02: Upgrade fillEngine + PaperFillWorker Summary

**One-liner:** REALISTIC fill mode với PaperMatchingEngine slippage integration và 3-cron-job worker (fill/expire/settlement).

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Upgrade fillEngine.js + fillOrderRealistic function | 52cfe8c | fillEngine.js, paperFillEngine.test.js |
| 2 | PaperFillWorker — periodic fill check | 2e7ba94 | paperFillWorker.js, index.js |

## What Was Built

### Task 1: fillEngine.js upgrade

- `fillOrderRealistic(order, portfolio)` — hàm mới routing theo order_type:
  - MP → `PaperMatchingEngine.fillMarketOrder()` → fill ngay với slippage
  - LO → `PaperMatchingEngine.tryFillLimitOrder()` → fill dựa trên fill probability
  - ATO → `PaperMatchingEngine.fillATOOrder()` → fill tại open price
  - ATC → `PaperMatchingEngine.fillATCOrder()` → fill tại close price

- `getAvgDailyVolume(symbol, exchange)` — lấy trung bình 20 candles, cache 1 giờ, fallback 100000

- `createPositionFromOrder(order, portfolio, fillPrice, buyFeeVnd)` — shared helper tách từ fillOrderInstant

- Pitfall 4 fix: `deductForBuy()` được gọi trong cả `fillOrderInstant` và `fillOrderRealistic` trước khi tạo position

- SELL flow: `addPendingSettlement(portfolioId, netAmount, orderId)` được gọi sau fill để track T+2

- Race condition guard: hoàn tiền qua `refundForCancel()` nếu `Order.fill()` trả null

### Task 2: PaperFillWorker

- `workers/paperFillWorker.js` với 3 cron jobs:
  - Fill check `*/30 * * * * *`: chạy `checkPendingOrders()` mỗi 30 giây
  - Expire `0 15 * * 1-5`: gọi `expireEndOfSessionOrders()` lúc 15:00 Mon-Fri
  - Settlement `0 9 * * 1-5`: gọi `PaperCapitalService.processSettlements()` lúc 09:00 Mon-Fri

- Market hours guard: chỉ fill trong 9:00-11:30 và 13:00-15:00 GMT+7, skip cuối tuần

- Delay 1-5s giữa các fills (per D-04 để mô phỏng queue thực tế)

- Query pattern: `WHERE context='PAPER' AND status='PENDING' AND simulation_mode='REALISTIC'`

### paperOrder.controller.js

- REALISTIC mode routing:
  - MP → gọi `fillOrderRealistic()` ngay, trả về slippage amount trong response
  - LO/ATO/ATC → chỉ tạo PENDING, message "Lệnh đã đặt, chờ khớp (REALISTIC)"

- INSTANT mode giữ nguyên backward compatible

## Test Results

- 19 unit tests cho `paperFillEngine.test.js` — tất cả pass
- 127 tổng tests trong project — tất cả pass
- Coverage: context guard, race condition, deductForBuy, addPendingSettlement, fillOrderRealistic flows

## Deviations from Plan

### Auto-added improvements (Rule 2)

**1. [Rule 2 - Missing] SELL settlement trong fillOrderInstant**
- **Found during:** Task 1
- **Issue:** Plan chỉ mention deductForBuy cho fillOrderInstant nhưng fillOrderInstant cũng cần addPendingSettlement khi SELL (T+2 rule)
- **Fix:** Thêm addPendingSettlement trong cả fillOrderInstant lẫn fillOrderRealistic cho SELL side
- **Files modified:** fillEngine.js

**2. [Rule 1 - Bug] createPositionFromOrder refactor**
- **Found during:** Task 1
- **Issue:** Code tạo position bị duplicate hoàn toàn giữa fillOrderInstant và fillOrderRealistic
- **Fix:** Extract shared helper `createPositionFromOrder()` để DRY

**3. [Rule 2 - Missing] Race condition refund**
- **Found during:** Task 1
- **Issue:** Sau khi `deductForBuy()`, nếu `Order.fill()` thất bại (race), tiền bị mất
- **Fix:** Thêm `refundForCancel()` trong cả 2 fill functions khi race condition detected

**4. [Rule 1 - Bug] Test fetch mock ordering issue**
- **Found during:** Test execution
- **Issue:** Tests trong fillOrderRealistic suite dùng `mockResolvedValueOnce` sequence nhưng `volumeCache` (in-memory Map trong module) persist giữa các test → ordering issues khi volume cached
- **Fix:** Dùng `url-based mockImplementation` và reset `global.fetch = vi.fn()` trong beforeEach của fillOrderRealistic suite

## Known Stubs

Không có stubs. Tất cả data được wire thực tế qua DB queries và market API calls.

## Self-Check: PASSED

- `/ai-stoploss-engine-be/services/paper/fillEngine.js` — FOUND
- `/ai-stoploss-engine-be/workers/paperFillWorker.js` — FOUND
- `/ai-stoploss-engine-be/tests/services/paperFillEngine.test.js` — FOUND
- Commit 52cfe8c — FOUND
- Commit 2e7ba94 — FOUND
- 127 tests pass — VERIFIED
