---
phase: 03-ai-enhancement
plan: 03
subsystem: ai-probability-tp
tags: [probability, log-normal, take-profit, statistics, tdd]
dependency_graph:
  requires: [03-01]
  provides: [probabilityTP-service, upgraded-suggestSLTP-endpoint]
  affects: [ai.controller.js, suggestSLTP-response]
tech_stack:
  added: [simple-statistics (mean, standardDeviation, probit)]
  patterns: [log-normal distribution, TDD red-green, probability-based TP]
key_files:
  created:
    - ai-stoploss-engine-be/services/ai/probabilityTP.js
    - ai-stoploss-engine-be/tests/services/probabilityTP.test.js
  modified:
    - ai-stoploss-engine-be/controllers/ai.controller.js
decisions:
  - "sigma guard: chi return null khi sigma < 1e-10 (khong chia cho 0), khong null khi sigma rat nho"
  - "Mock data voi noise pattern co dinh de dam bao sigma > 0 trong tests (reproducible)"
  - "Fetch OHLCV 200 ngay rieng biet (ohlcvDataForTP) de khong lam anh huong SL OHLCV 50 ngay"
metrics:
  duration: 25m
  completed: 2026-03-27
  tasks_completed: 2
  tests_added: 15
  files_created: 2
  files_modified: 1
---

# Phase 3 Plan 03: Probability-based Take Profit Summary

**One-liner:** Log-normal probability TP service tra ve 3-5 muc TP voi xac suat % va label tieng Viet, tich hop vao suggestSLTP endpoint lam default thay the ATR x RR co hoc.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create probabilityTP.js service + tests (TDD) | 3173f1d | services/ai/probabilityTP.js, tests/services/probabilityTP.test.js |
| 2 | Upgrade suggestSLTP endpoint voi probability TP lam default | 22ea519 | controllers/ai.controller.js |

## What Was Built

### probabilityTP.js Service

Service tinh xac suat dat cac muc Take Profit dua tren **log-normal distribution**:

- Import `mean`, `standardDeviation`, `probit` tu `simple-statistics`
- Guard: tra ve `null` khi `ohlcvData.length < 60` (D-14 fallback signal)
- Tinh log returns: `ln(close_i / close_{i-1})`
- N-day scaling: `mu_N = mu * N`, `sigma_N = sigma * sqrt(N)`
- Target price: `P = P_now * exp(mu_N + sigma_N * probit(1 - p))`
- Chi giu levels co `targetPrice > currentPrice` (take PROFIT)
- Percentiles: 25%, 50%, 75%, 90%
- Sort by probability DESC, slice(0, 5) — tra ve 3-5 levels
- Label tieng Viet: `"75% dat 26,500 trong 5 ngay"`
- `experimental: true` (D-13)
- `data_quality: { days_used, mu_daily, sigma_daily }`

### Upgraded suggestSLTP Endpoint

- Fetch OHLCV 200 ngay rieng (`ohlcvDataForTP`) cho probability calculation (D-10)
- Existing OHLCV 50 ngay van giu cho SL calculation — khong bi anh huong
- **Khi du data (>= 60 ngay):**
  - `take_profit_levels`: array 3-5 muc TP voi probability, timeframe, label
  - `take_profit_method`: `'probability'`
  - `take_profit_experimental`: `true`
  - `take_profit_data_quality`: `{ days_used, mu_daily, sigma_daily }`
  - `take_profit_vnd` (ATR x RR) van con - backward-compatible
- **Khi thieu data (< 60 ngay):**
  - `take_profit_method`: `'atr_rr'`
  - `take_profit_warning`: message tieng Viet giai thich fallback

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Mock data sigma = 0 gây probabilityTP service return null**

- **Found during:** Task 1 - TDD GREEN
- **Issue:** Mock OHLCV data tang deu hoan toan (`price * 1.001` moi ngay, khong co noise) -> log returns la hang so -> `standardDeviation = 0` -> service return `null` -> tests fail
- **Fix 1:** Them noise pattern co dinh (`[0.015, -0.008, ...]`) vao mock data trong test de `sigma > 0`
- **Fix 2:** Sua guard trong service tu `if (sigma === 0)` sang `if (sigma < 1e-10)` de xu ly chinh xac hon edge case floating point
- **Files modified:** `tests/services/probabilityTP.test.js`, `services/ai/probabilityTP.js`
- **Commit:** 3173f1d

## Success Criteria Verification

- probabilityTP.js tinh probability dung tu log-normal distribution: **PASS**
- 3-5 TP levels voi probability %, timeframe, Vietnamese label: **PASS** (15/15 tests)
- suggestSLTP endpoint tra ve probability TP lam default: **PASS**
- Fallback ATR x RR voi warning khi < 60 ngay data: **PASS**
- experimental=true luon set: **PASS**
- Backward compatible (take_profit_vnd van co): **PASS**
- All 183 tests pass (no regression): **PASS**

## Self-Check: PASSED

Files verified:
- `ai-stoploss-engine-be/services/ai/probabilityTP.js` — EXISTS
- `ai-stoploss-engine-be/tests/services/probabilityTP.test.js` — EXISTS
- `ai-stoploss-engine-be/controllers/ai.controller.js` — MODIFIED

Commits verified:
- `3173f1d` feat(03-03): add probabilityTP service — EXISTS
- `22ea519` feat(03-03): upgrade suggestSLTP endpoint — EXISTS
