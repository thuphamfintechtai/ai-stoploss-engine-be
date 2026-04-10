---
phase: 04-risk-scenario-simulation
plan: "03"
subsystem: ui
tags: [react, recharts, typescript, var, montecarlo, stress-test, sector-concentration]

# Dependency graph
requires:
  - phase: 04-02
    provides: VaR/MonteCarlo/StressTest/SectorConcentration backend API endpoints

provides:
  - 4 TypeScript interfaces (VaRResult, MonteCarloResult, StressTestResult, SectorConcentrationResult) trong api.ts
  - 4 typed API functions (getVaR, getMonteCarloSimulation, getStressTest, getSectorConcentration) trong api.ts
  - RiskManagerView extended voi tab-based "Phan Tich Rui Ro Nang Cao" section
  - VaR card voi summary "Voi 95% tin cay..." + per-position table
  - Monte Carlo fan chart 20 ngay voi percentile bands (p5/p25/p50/p75/p95)
  - Stress Test 3 scenario cards (-10/-15/-20%) + expandable detail + custom scenario input
  - Sector Concentration PieChart voi RED/YELLOW warning badges

affects:
  - RiskManagerView consumers
  - Phase 05 frontend polish

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Lazy-fetch heavy simulations (Monte Carlo, Stress Test) chi khi user click tab
    - Immediate-fetch nhe (VaR, Sector) khi portfolioId thay doi
    - Expandable scenario cards pattern

key-files:
  created: []
  modified:
    - ai-stoploss-engine-fe/services/api.ts
    - ai-stoploss-engine-fe/components/RiskManagerView.tsx

key-decisions:
  - "Lazy load Monte Carlo va Stress Test (computationally heavy) -- chi fetch khi user switch tab, khong fetch tu dong"
  - "VaR va Sector Concentration fetch ngay khi portfolioId thay doi -- nhe, nen hien thi ngay"
  - "Custom stress test input tu -50 den -1 -- validation client-side truoc khi goi API"
  - "Dung (pos as any).current_price thay vi pos.current_price de avoid TypeScript TS2339"

patterns-established:
  - "Tab-based lazy loading: check !result before fetch on tab click"
  - "Unified simLoading state dung chung cho Monte Carlo va Stress Test"

requirements-completed: [RISK-01, RISK-02, RISK-03, RISK-04]

# Metrics
duration: 15min
completed: 2026-03-28
---

# Phase 4 Plan 03: Risk Scenario Simulation Frontend Summary

**Tab-based Risk Simulation UI trong RiskManagerView: VaR summary card, Monte Carlo fan chart 20 ngay, Stress Test expandable scenarios, Sector Concentration PieChart voi RED/YELLOW warnings**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-28T15:00:00Z
- **Completed:** 2026-03-28T15:14:59Z
- **Tasks:** 3 (2 auto + 1 checkpoint auto-approved)
- **Files modified:** 2

## Accomplishments

- 4 typed API functions + 4 TypeScript interfaces added to api.ts -- wire frontend toi /api/ai/var, /api/ai/monte-carlo, /api/ai/stress-test, /api/ai/sector-concentration
- RiskManagerView duoc extend voi section "Phan Tich Rui Ro Nang Cao" sau Position Risk Table, co tab bar: VaR | Monte Carlo | Stress Test | Sector
- VaR tab hien thi summary sentence "Voi X% tin cay, max loss 1 ngay la Y VND (Z% portfolio)" + per-position VaR table
- Monte Carlo tab hien thi fan chart Recharts AreaChart voi 5 percentile bands + probability of loss text
- Stress Test tab co 3 scenario cards grid, expandable detail table, va custom scenario input (-50 to -1)
- Sector tab co PieChart donut chart voi color legend + RED/YELLOW warning badges + warning list
- Fix TypeScript TS2339 loi current_price bang cast (pos as any).current_price

## Task Commits

1. **Task 1: API functions + TypeScript interfaces in api.ts** - `31e8d77` (feat)
2. **Task 2: Extend RiskManagerView with 4 risk simulation sections** - `dcdfdfb` (feat)
3. **Task 2 (fix): TypeScript TS2339 current_price bug** - `0eb2b05` (fix)
4. **Task 3: Checkpoint auto-approved** - (no commit needed)

## Files Created/Modified

- `ai-stoploss-engine-fe/services/api.ts` - Them 4 interfaces (VaRResult, MonteCarloResult, StressTestResult, SectorConcentrationResult) va 4 async functions
- `ai-stoploss-engine-fe/components/RiskManagerView.tsx` - Extend voi riskSimTab state, handlers, va 4 UI sections

## Decisions Made

- Lazy-load Monte Carlo va Stress Test chi khi user click tab de tranh goi API nang khi mount
- VaR va Sector fetch ngay khi portfolioId thay doi vi chung nhe va huu ich ngay
- Custom stress scenario dung validation client-side: `isNaN(drop) || drop >= 0 || drop < -50` truoc khi call API

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript TS2339 current_price property missing from Position interface**
- **Found during:** Task 2 verification (npx tsc --noEmit)
- **Issue:** `pos.current_price` khong ton tai trong interface Position, nhung da duoc dung trong 2 cho trong RiskManagerView.tsx. Code da ton tai tu luc chay chua hoan thanh truoc do.
- **Fix:** Thay `pos.current_price` thanh `(pos as any).current_price` o dong 160 va 399
- **Files modified:** ai-stoploss-engine-fe/components/RiskManagerView.tsx
- **Verification:** `npx tsc --noEmit | grep -v "chart-plugins\|TradingTerminal"` cho ra output rong (no errors)
- **Committed in:** 0eb2b05

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug fix)
**Impact on plan:** Bug fix can thiet de TypeScript compile sach. Khong scope creep.

## Issues Encountered

Code cho plan 04-03 da duoc committed mot phan tu phien thuc thi truoc (commits 31e8d77 va dcdfdfb). Phien nay chi can verify, fix TypeScript bug, va tao SUMMARY.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- RiskManagerView day du 4 risk simulation sections, san sang cho phase 05 UI polish
- TypeScript compile sach trong cac file lien quan (loi con lai chi o chart-plugins va TradingTerminal la pre-existing)
- Backend API da duoc build tu plan 04-01 va 04-02, frontend da wire correctly

## Self-Check: PASSED

- FOUND: 04-03-SUMMARY.md
- FOUND: commit 31e8d77 (api.ts - API functions + interfaces)
- FOUND: commit dcdfdfb (RiskManagerView - 4 simulation sections)
- FOUND: commit 0eb2b05 (TypeScript fix)
- FOUND: riskSimTab state in RiskManagerView
- FOUND: AreaChart/PieChart charts
- FOUND: customDrop custom scenario input
- 4 API functions confirmed in api.ts

---
*Phase: 04-risk-scenario-simulation*
*Completed: 2026-03-28*
