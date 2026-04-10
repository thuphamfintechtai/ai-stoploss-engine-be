---
phase: 03-ai-enhancement
plan: 02
subsystem: backend/ai
tags: [dynamic-stop-loss, atr, trailing-stop, regime, worker, cron]
dependency-graph:
  requires: [03-01]
  provides: [dynamic-sl-service, 5min-cron-recalc, sl-narrative]
  affects: [stopLossMonitor, aiService, indicatorCache, regimeDetector]
tech-stack:
  added: []
  patterns: [TDD-red-green, ATR-trailing, regime-adaptive-multiplier, gemini-with-fallback]
key-files:
  created:
    - ai-stoploss-engine-be/services/ai/dynamicStopLoss.js
    - ai-stoploss-engine-be/tests/services/dynamicStopLoss.test.js
  modified:
    - ai-stoploss-engine-be/workers/stopLossMonitor.js
    - ai-stoploss-engine-be/services/aiService.js
decisions:
  - "calculateDynamicSL dung trailing logic: LONG chi tang, SHORT chi giam — dam bao SL khong bao gio di nguoc chieu co loi"
  - "Gemini narrative voi 5s timeout + fallback rule-based dam bao narrative luon co ket qua"
  - "Gioi han 5 symbols concurrent trong recalculateDynamicSLJob de tranh rate limit VPBS API"
  - "Dynamic SL cron chay ca REAL va PAPER positions (khac voi SL monitor chi chay PAPER)"
metrics:
  duration: "~15 phut"
  completed: "2026-03-27"
  tasks: 2
  files: 4
---

# Phase 03 Plan 02: Dynamic Stop Loss Service Summary

**One-liner:** Dynamic SL service tinh SL moi = close - ATR*regime_multiplier voi trailing logic chi cho phep di chuyen co loi, cron 5-phut recalculate + Gemini narrative co fallback rule-based.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create dynamicStopLoss.js service + tests (TDD) | bda05a5 (RED), 5a8e6e1 (GREEN) | services/ai/dynamicStopLoss.js, tests/services/dynamicStopLoss.test.js |
| 2 | Upgrade stopLossMonitor voi dynamic SL cron 5-phut | e32364a | workers/stopLossMonitor.js, services/aiService.js |

## What Was Built

### Task 1: dynamicStopLoss.js service (TDD)

**File:** `ai-stoploss-engine-be/services/ai/dynamicStopLoss.js`

- `calculateDynamicSL(position, candle, indicators)` — tinh SL moi dua tren ATR * regime_multiplier
  - LONG: `newSL = close - ATR * multiplier`, chi tang (trailing)
  - SHORT: `newSL = close + ATR * multiplier`, chi giam (trailing)
  - Clamp trong price band qua `clampToBand`
  - Snap ve tick size hop le
  - Returns `{ newSL, oldSL, regime, atrValue, multiplier, changed, reason }`

- `generateSLNarrative(data)` — goi Gemini JSON voi 5s timeout, fallback sang rule-based

- `generateFallbackNarrative(data)` — template string "Stop Loss dieu chinh {oldSL} → {newSL}. Ly do: ATR={atrValue}, regime={regime} (multiplier {multiplier}x). {extra}"

**Tests:** 17 tests pass, cover trailing logic LONG/SHORT, clamp, changed=false, narrative.

### Task 2: stopLossMonitor.js + aiService.js

**stopLossMonitor.js upgrades:**
- Import `calculateDynamicSL`, `generateSLNarrative` from dynamicStopLoss.js
- Import `getOrCreateIndicators`, `feedCandle` from indicatorCache.js
- Them `recalculateDynamicSLJob()`:
  - Query all OPEN positions co stop_loss (ca REAL + PAPER)
  - Group by symbol, batch 5 concurrent symbols
  - `feedCandle` → `getOrCreateIndicators` → `calculateDynamicSL`
  - `Position.update` khi changed=true
  - `ExecutionLog.write` voi `DYNAMIC_SL_UPDATE`
  - `generateSLNarrative` + `broadcastPortfolioUpdate` qua WebSocket
- Cron `*/5 9-15 * * 1-5` — 9h-15h Mon-Fri (gio giao dich VN)

**aiService.js:** Added `export` keyword truoc `callGeminiJSON` de module khac co the import.

## Verification

- 17 dynamic SL tests pass (TDD GREEN)
- 183 total tests pass (existing tests khong bi break)
- 3 cron.schedule trong stopLossMonitor (CHECK_CRON + ALERT_CRON + DYNAMIC_SL_CRON)
- Worker module loads OK (no import errors)
- callGeminiJSON exported tu aiService.js

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — toan bo logic da duoc implement day du.

## Self-Check: PASSED

- [x] `ai-stoploss-engine-be/services/ai/dynamicStopLoss.js` — exists, 147 lines
- [x] `ai-stoploss-engine-be/tests/services/dynamicStopLoss.test.js` — exists, 375 lines
- [x] Commit bda05a5 (TDD RED) — exists
- [x] Commit 5a8e6e1 (TDD GREEN) — exists
- [x] Commit e32364a (Task 2) — exists
- [x] 183 tests pass
