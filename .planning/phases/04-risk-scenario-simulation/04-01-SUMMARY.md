---
phase: 04-risk-scenario-simulation
plan: 01
subsystem: api
tags: [risk, var, monte-carlo, stress-test, sector-concentration, simple-statistics, gbm]

requires:
  - phase: 03-ai-enhancement
    provides: sectorClassification.js with getSector() and SECTOR_LABELS

provides:
  - varService.js: Historical Simulation VaR calculation (calculateHistoricalVaR)
  - monteCarloService.js: GBM Monte Carlo 1000 paths with price band clamping (runMonteCarloSimulation)
  - stressTestService.js: Stress test with beta-based impact estimation (calculateStressTest)
  - sectorConcentration.js: Sector concentration analysis with RED/YELLOW/GREEN warnings (calculateSectorConcentration)

affects:
  - 04-02 (controller sẽ wire database + gọi các service này)

tech-stack:
  added: []
  patterns:
    - Pure function services - nhận input params, không import database, controller fetch DB rồi pass vào
    - TDD flow: test RED trước, implement GREEN sau
    - simple-statistics quantile() thay cho percentile() (API thực tế của thư viện)
    - Box-Muller transform cho standard normal random trong GBM

key-files:
  created:
    - ai-stoploss-engine-be/services/ai/varService.js
    - ai-stoploss-engine-be/services/ai/monteCarloService.js
    - ai-stoploss-engine-be/services/ai/stressTestService.js
    - ai-stoploss-engine-be/services/ai/sectorConcentration.js
    - ai-stoploss-engine-be/tests/varService.test.js
    - ai-stoploss-engine-be/tests/monteCarloService.test.js
    - ai-stoploss-engine-be/tests/stressTestService.test.js
    - ai-stoploss-engine-be/tests/sectorConcentration.test.js
  modified: []

key-decisions:
  - "simple-statistics export quantile() không phải percentile() - cần dùng quantile() trong cả varService và monteCarloService"
  - "Value-based concentration (entry_price * qty) trong sectorConcentration, phân biệt với risk-based (entry - sl) * qty trong capitalAllocation.calculateRiskBudget"
  - "GBM price clamp sau khi tính exp() drift+diffusion: clamp dailyChange rồi update price, đảm bảo mỗi ngày không vượt limit"

patterns-established:
  - "Pure function pattern: services không import database, nhận params từ controller"
  - "SECTOR_BETAS constant trong stressTestService: BANKING:1.2, REAL_ESTATE:1.5, TECHNOLOGY:0.8, STEEL:1.3, SECURITIES:1.4, ENERGY:0.9, CONSUMER:0.7, RETAIL:0.8, OTHER:1.0"
  - "Box-Muller: boxMullerRandom() function tạo N(0,1) từ Math.random()"
  - "Price band clamping: HOSE 7%, HNX 10% trong GBM dailyChange"

requirements-completed: [RISK-01, RISK-02, RISK-03, RISK-04]

duration: 15min
completed: 2026-03-27
---

# Phase 4 Plan 01: Risk Simulation Services Summary

**4 pure-function backend services cho VaR (Historical Simulation), Monte Carlo GBM (1000 paths + price band clamp), Stress Test (sector beta mapping), và Sector Concentration (RED/YELLOW/GREEN) - tổng cộng 45 tests pass**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-27T12:51:00Z
- **Completed:** 2026-03-27T12:56:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- varService.js: Historical Simulation VaR với simple-statistics quantile, summary sentence tiếng Việt, per-position VaR, warning khi < 20 ngày data
- monteCarloService.js: GBM 1000 paths x 20 ngày, Box-Muller transform, price band clamp HOSE 7%/HNX 10%, percentile bands (p5/p25/p50/p75/p95), probabilityOfLoss
- stressTestService.js: 3 kịch bản mặc định (-10/-15/-20%), SECTOR_BETAS mapping 9 sectors, custom scenario support, beta-based impact calculation
- sectorConcentration.js: Value-based sector grouping, RED (>40%) / YELLOW (>30%) / GREEN thresholds, warnings tiếng Việt, sort theo percent giảm dần

## Task Commits

1. **Task 1: VaR + Monte Carlo + Stress Test services** - `685a3dd` (feat)
2. **Task 2: Sector Concentration service** - `3c1d5ab` (feat)

## Files Created/Modified

- `ai-stoploss-engine-be/services/ai/varService.js` - Historical VaR, uses simple-statistics quantile
- `ai-stoploss-engine-be/services/ai/monteCarloService.js` - GBM Monte Carlo, Box-Muller, price band clamp
- `ai-stoploss-engine-be/services/ai/stressTestService.js` - Stress test với SECTOR_BETAS + custom scenario
- `ai-stoploss-engine-be/services/ai/sectorConcentration.js` - Sector concentration với RED/YELLOW/GREEN
- `ai-stoploss-engine-be/tests/varService.test.js` - 9 tests VaR
- `ai-stoploss-engine-be/tests/monteCarloService.test.js` - 10 tests Monte Carlo
- `ai-stoploss-engine-be/tests/stressTestService.test.js` - 12 tests Stress Test
- `ai-stoploss-engine-be/tests/sectorConcentration.test.js` - 14 tests Sector Concentration

## Decisions Made

- **simple-statistics API:** Thư viện export `quantile()` chứ không phải `percentile()`. Đã dùng `quantile()` trong varService và monteCarloService. Plan nói "import percentile" nhưng thực tế API của simple-statistics là `quantile`. Đây là deviation Rule 1 (auto-fix).
- **Value vs Risk concentration:** sectorConcentration tính theo value = entry_price × qty, phân biệt rõ với capitalAllocation.calculateRiskBudget tính risk-based concentration = (entry - sl) × qty.
- **GBM clamping approach:** Clamp `dailyChange` (không phải absolute price) sau khi tính exp() để đảm bảo giới hạn đúng mỗi ngày.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] simple-statistics không export `percentile`, phải dùng `quantile`**
- **Found during:** Task 1 (VaR + Monte Carlo implementation)
- **Issue:** Plan chỉ định `import { percentile, mean, standardDeviation } from 'simple-statistics'` nhưng thư viện thực tế export `quantile()` thay vì `percentile()`. Gây `percentile is not a function` runtime error.
- **Fix:** Thay `percentile` bằng `quantile` trong cả varService.js và monteCarloService.js
- **Files modified:** services/ai/varService.js, services/ai/monteCarloService.js
- **Verification:** 45 tests pass sau fix
- **Committed in:** 685a3dd (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact on plan:** Fix bắt buộc để code chạy đúng. Không ảnh hưởng logic nghiệp vụ - `quantile(arr, 0.05)` tương đương `percentile(arr, 5)` trong simple-statistics.

## Issues Encountered

None beyond the simple-statistics API naming difference documented above.

## Known Stubs

None - tất cả 4 services đều implement đầy đủ logic, không có hardcoded mock data hay placeholder.

## Next Phase Readiness

- 4 pure-function services sẵn sàng cho Plan 02 (controller wiring database + API endpoints)
- Controller cần: fetch positions từ DB, fetch OHLCV từ VPBS API, pass vào services, trả về kết quả
- sectorConcentration output đã tương thích với pie chart (sectors array với percent + warningLevel)
- Monte Carlo paths array sẵn sàng cho chart rendering

---
*Phase: 04-risk-scenario-simulation*
*Completed: 2026-03-27*
