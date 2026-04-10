---
phase: 04-risk-scenario-simulation
plan: 02
subsystem: api
tags: [express, joi, var, monte-carlo, stress-test, sector-concentration, risk]

# Dependency graph
requires:
  - phase: 04-01
    provides: varService, monteCarloService, stressTestService, sectorConcentration services

provides:
  - GET /api/ai/var — Historical VaR endpoint (RISK-01)
  - POST /api/ai/monte-carlo — Monte Carlo simulation endpoint (RISK-02)
  - POST /api/ai/stress-test — Stress test scenarios endpoint (RISK-03)
  - GET /api/ai/sector-concentration — Sector concentration endpoint (RISK-04)
affects:
  - 04-03-frontend-risk-views
  - any phase consuming risk simulation API

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "5-concurrent OHLCV batch fetch pattern to avoid rate limits"
    - "Monte Carlo returns percentileBands + summary only, not raw 1000 paths"

key-files:
  created: []
  modified:
    - ai-stoploss-engine-be/controllers/ai.controller.js
    - ai-stoploss-engine-be/routes/ai.routes.js

key-decisions:
  - "Monte Carlo endpoint returns only percentileBands + finalValueDistribution, not raw 1000 paths to avoid payload bloat"
  - "VaR and Sector Concentration as GET (query params); Monte Carlo and Stress Test as POST (body params for heavier payloads)"
  - "Empty portfolio returns zero-VaR response early, no service call needed"

patterns-established:
  - "Risk controllers: validate query/body with Joi, query OPEN positions, batch-fetch OHLCV 5-concurrent, call service, return JSON"

requirements-completed: [RISK-01, RISK-02, RISK-03, RISK-04]

# Metrics
duration: 15min
completed: 2026-03-27
---

# Phase 04 Plan 02: Risk Simulation API Wiring Summary

**4 risk simulation endpoints wired to services via Express controllers: VaR (GET), Monte Carlo (POST, percentile-bands only), Stress Test (POST), Sector Concentration (GET)**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-27T00:00:00Z
- **Completed:** 2026-03-27T00:15:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added 4 service imports and 4 Joi validation schemas to ai.controller.js
- Implemented `getVaR` with 5-concurrent OHLCV batching and early-exit for empty portfolios
- Implemented `getMonteCarloSimulation` returning percentileBands + finalValueDistribution (not raw paths)
- Implemented `getStressTestResult` supporting 3 predefined + optional custom scenario
- Implemented `getSectorConcentrationResult` for sector breakdown with warning levels
- Registered all 4 routes in ai.routes.js behind existing `authenticateToken` middleware

## Task Commits

1. **Task 1: Add 4 controller functions + Joi schemas** - `3237155` (feat)
2. **Task 2: Register 4 new routes** - `ab72e6d` (feat)

## Files Created/Modified
- `ai-stoploss-engine-be/controllers/ai.controller.js` - Added 4 imports, 4 Joi schemas, 4 controller functions (246 lines added)
- `ai-stoploss-engine-be/routes/ai.routes.js` - Added 4 imports and 4 route registrations (30 lines added)

## Decisions Made
- Monte Carlo endpoint intentionally excludes raw paths array to prevent ~MB-size responses; frontend charts from percentile bands instead
- VaR uses `lookbackDays + 10` as OHLCV fetch limit to ensure sufficient buffer data

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 4 risk endpoints accessible via authenticated requests
- Frontend can now call `/api/ai/var`, `/api/ai/monte-carlo`, `/api/ai/stress-test`, `/api/ai/sector-concentration`
- Ready for Phase 04-03 frontend risk views integration

---
*Phase: 04-risk-scenario-simulation*
*Completed: 2026-03-27*
