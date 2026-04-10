---
phase: 03-ai-enhancement
plan: 01
subsystem: ai
tags: [trading-signals, simple-statistics, regime-detection, indicator-cache, sector-classification, price-band]

requires: []

provides:
  - indicatorCache: streaming ATR/BB/SMA per symbol, TTL 30min
  - regimeDetector: rule-based VOLATILE/BULLISH/BEARISH/SIDEWAYS + REGIME_MULTIPLIERS
  - sectorClassification: VN_SECTOR_MAP cho 50+ co phieu, SECTOR_LABELS
  - priceBandValidator: getFloorPrice/getCeilingPrice/clampToBand cho HOSE 7% HNX 10%

affects:
  - 03-ai-enhancement (plans 02-04 deu dung shared modules nay)
  - dynamic-stop-loss
  - probability-take-profit
  - capital-allocation

tech-stack:
  added:
    - trading-signals@7.4.3 (ATR, BollingerBands, SMA indicators)
    - simple-statistics@7.8.9 (statistical calculations)
  patterns:
    - Indicator streaming cache per symbol with TTL eviction
    - Rule-based regime classification (BB percentile + SMA crossover)
    - Price band validation with tick size snapping

key-files:
  created:
    - ai-stoploss-engine-be/services/ai/indicatorCache.js
    - ai-stoploss-engine-be/services/ai/regimeDetector.js
    - ai-stoploss-engine-be/services/ai/sectorClassification.js
    - ai-stoploss-engine-be/services/shared/priceBandValidator.js
    - ai-stoploss-engine-be/tests/helpers/indicatorMocks.js
    - ai-stoploss-engine-be/tests/services/regimeDetector.test.js
  modified:
    - ai-stoploss-engine-be/package.json
    - ai-stoploss-engine-be/package-lock.json

key-decisions:
  - "REGIME_MULTIPLIERS: VOLATILE=2.5, BULLISH=1.5, BEARISH=1.5, SIDEWAYS=1.0 (per D-03/D-04)"
  - "BB percentile ngưỡng 70% cho VOLATILE detection -- (upper-lower)/middle*100 > 70"
  - "priceBandValidator import snapToTickSize tu shared/tickSizeEngine.js -- KHONG tao utility moi"
  - "getSector() normalize symbol voi toUpperCase() -- tranh bug case-sensitive"
  - "indicatorCache TTL 30 min -- stale check trong getter, khong dung setInterval"

patterns-established:
  - "Streaming indicator pattern: feedCandle() update all indicators per symbol atomically"
  - "Mock pattern: createMockIndicators(overrides) voi configurable isStable + getResult()"

requirements-completed: [AISL-02, AISL-04, AICAP-03]

duration: 3min
completed: 2026-03-27
---

# Phase 03 Plan 01: AI Enhancement Foundation Summary

**trading-signals streaming cache (ATR/BB/SMA per symbol), rule-based regime detector (VOLATILE/BULLISH/BEARISH/SIDEWAYS), VN stock sector mapping, va HOSE/HNX price band validator -- shared foundation cho 3 AI modules**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-27T12:13:15Z
- **Completed:** 2026-03-27T12:16:15Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Install trading-signals@7.4.3 va simple-statistics@7.8.9 vao backend
- Tao 4 shared AI modules: indicatorCache, regimeDetector, sectorClassification, priceBandValidator
- 24 unit tests pass, cover tat ca regime cases va price band HOSE/HNX

## Task Commits

1. **Task 1: Install npm packages + Create shared AI service modules** - `3c2937d` (feat)
2. **Task 2: Unit tests cho regimeDetector + indicatorCache + priceBandValidator** - `5f1b1e1` (test)

## Files Created/Modified

- `ai-stoploss-engine-be/services/ai/indicatorCache.js` - Streaming ATR/BB/SMA per symbol, TTL 30 min, getOrCreateIndicators/feedCandle/clearCache
- `ai-stoploss-engine-be/services/ai/regimeDetector.js` - detectRegime() tu BB percentile + SMA crossover, REGIME_MULTIPLIERS
- `ai-stoploss-engine-be/services/ai/sectorClassification.js` - VN_SECTOR_MAP 50+ symbols, SECTOR_LABELS tieng Viet, getSector()
- `ai-stoploss-engine-be/services/shared/priceBandValidator.js` - getFloorPrice/getCeilingPrice/clampToBand HOSE 7% HNX 10%
- `ai-stoploss-engine-be/tests/helpers/indicatorMocks.js` - createMockIndicators() voi configurable overrides
- `ai-stoploss-engine-be/tests/services/regimeDetector.test.js` - 24 tests cover tat ca scenarios
- `ai-stoploss-engine-be/package.json` - them trading-signals, simple-statistics
- `ai-stoploss-engine-be/package-lock.json` - lockfile updated

## Decisions Made

- REGIME_MULTIPLIERS: VOLATILE=2.5, BULLISH=1.5, BEARISH=1.5, SIDEWAYS=1.0 theo D-03/D-04
- BB percentile threshold 70%: `(upper-lower)/middle*100 > 70` cho VOLATILE detection
- priceBandValidator dung snapToTickSize tu shared/tickSizeEngine.js, khong duplicate logic
- getSector() normalize voi toUpperCase() tranh case-sensitivity bug
- indicatorCache TTL stale check trong getter (lazy eviction), khong dung setInterval

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - npm install thanh cong, tat ca 4 modules tao xong, 24/24 tests pass.

## Next Phase Readiness

- Plans 02-04 co the import ngay: indicatorCache, detectRegime, getSector, clampToBand
- regimeDetector ready cho Dynamic SL (plan 02)
- sectorClassification ready cho Capital Allocation (plan 04)
- priceBandValidator ready cho bat ky plan nao can clamp gia

---
*Phase: 03-ai-enhancement*
*Completed: 2026-03-27*
