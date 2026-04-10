---
phase: 01-foundation-portfolio-management
plan: 01
subsystem: database
tags: [postgresql, migration, vitest, shared-kernel, context-separation]

# Dependency graph
requires: []
provides:
  - Migration 007 SQL voi context column (REAL/PAPER) cho orders va positions
  - available_cash va pending_settlement_cash columns tren portfolios table
  - settlement_events table cho T+2 cash settlement tracking
  - Relaxed stop_loss constraint: NULL cho REAL context
  - RECORDED/MANUAL_RECORD status/order_type support
  - Vitest test framework + mock DB helpers
  - 7 shared kernel services trong services/shared/ voi backward-compat re-exports
affects: [02-02, 02-03, 02-04, 02-05, 02-06]

# Tech tracking
tech-stack:
  added: [vitest@4.1.2]
  patterns:
    - shared kernel services trong services/shared/ voi backward-compat re-export wrappers
    - context column (REAL/PAPER) phan biet real orders vs paper simulation
    - Mock db helpers (mockQuery, mockTransaction) cho unit testing

key-files:
  created:
    - ai-stoploss-engine-be/migrations/007_context_separation.sql
    - ai-stoploss-engine-be/vitest.config.js
    - ai-stoploss-engine-be/tests/helpers/db.js
    - ai-stoploss-engine-be/services/shared/riskCalculator.js
    - ai-stoploss-engine-be/services/shared/feeEngine.js
    - ai-stoploss-engine-be/services/shared/tickSizeEngine.js
    - ai-stoploss-engine-be/services/shared/slippageCalculator.js
    - ai-stoploss-engine-be/services/shared/marketPriceService.js
    - ai-stoploss-engine-be/services/shared/notificationService.js
    - ai-stoploss-engine-be/services/shared/websocket.js
  modified:
    - ai-stoploss-engine-be/package.json
    - ai-stoploss-engine-be/services/riskCalculator.js
    - ai-stoploss-engine-be/services/feeEngine.js
    - ai-stoploss-engine-be/services/tickSizeEngine.js
    - ai-stoploss-engine-be/services/slippageCalculator.js
    - ai-stoploss-engine-be/services/marketPriceService.js
    - ai-stoploss-engine-be/services/notificationService.js
    - ai-stoploss-engine-be/services/websocket.js

key-decisions:
  - "Context column DEFAULT 'PAPER' de data cu khong bi break -- moi data mac dinh la PAPER"
  - "Copy (khong move) services vao shared/ + re-export wrapper de khong break existing imports"
  - "stop_loss DROP NOT NULL + CHECK constraint moi cho phep NULL chi khi context='REAL'"
  - "Them actual_filled_at va manual_entry columns cho real order tracking"

patterns-established:
  - "shared kernel: import tu services/shared/X.js hoac tu services/X.js (backward compat)"
  - "import paths trong shared/ phai dung ../../config/ va ../../models/ (2 cap len)"
  - "Mock test: dung mockQuery/mockTransaction tu tests/helpers/db.js"

requirements-completed: [FOUND-01, FOUND-02, FOUND-05]

# Metrics
duration: 5min
completed: 2026-03-27
---

# Phase 01 Plan 01: Foundation — DB Migration + Vitest + Shared Kernel Summary

**PostgreSQL migration 007 tach context REAL/PAPER, cash balance columns, settlement_events table, vitest setup, va 7 shared kernel services voi backward-compat re-exports**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-27T04:42:51Z
- **Completed:** 2026-03-27T04:47:51Z
- **Tasks:** 3
- **Files modified:** 18

## Accomplishments

- Migration 007 SQL hoan chinh: context column, available_cash, settlement_events table, relaxed constraints, 5 indexes
- Vitest 4.1.2 cai dat, config tao, mock DB helpers san sang cho unit tests cac plans sau
- 7 shared kernel services di chuyen vao services/shared/ voi backward-compat re-export wrappers

## Task Commits

Moi task duoc commit rieng biet:

1. **Task 1: DB Migration 007** - `06e96a3` (feat)
2. **Task 2: Setup Vitest + Test Helpers** - `291a1cd` (chore)
3. **Task 3: Reorganize Shared Kernel Services** - `09a0662` (refactor)

## Files Created/Modified

- `ai-stoploss-engine-be/migrations/007_context_separation.sql` - Migration them context column (REAL/PAPER), cash balance, settlement_events table
- `ai-stoploss-engine-be/vitest.config.js` - Vitest config voi node environment
- `ai-stoploss-engine-be/tests/helpers/db.js` - Mock helpers: mockQuery, mockTransaction, setupDbMock, resetDbMocks
- `ai-stoploss-engine-be/package.json` - Them vitest devDependency + test scripts
- `ai-stoploss-engine-be/services/shared/` - 7 shared kernel services (feeEngine, riskCalculator, tickSizeEngine, slippageCalculator, marketPriceService, notificationService, websocket)
- `ai-stoploss-engine-be/services/feeEngine.js` (va 6 file khac) - Re-export wrappers tu ./shared/

## Decisions Made

- **DEFAULT 'PAPER' cho context column**: Data cu tu` orders va positions se tu dong la PAPER context, khong can data migration phuc tap
- **Copy + re-export pattern**: Thay vi move files, copy vao shared/ va thay file goc bang re-export de dam bao 100% backward compatibility
- **stop_loss constraint moi**: `context = 'REAL' OR stop_loss IS NULL OR (check direction)` cho phep REAL positions khong can SL bat buoc
- **actual_filled_at + manual_entry**: Them 2 columns de track khi nao real order duoc ghi nhan thu cong

## Deviations from Plan

None — plan thuc thi dung theo ke hoach.

## Issues Encountered

- `npx vitest run` tra ve exit code 1 khi khong co test files — day la hanh vi binh thuong (thong bao "No test files found"), khong phai loi. Acceptance criteria da co quy dinh ro dieu nay.

## User Setup Required

None — khong co external service configuration can thiet. Migration SQL can duoc chay thu cong qua `node scripts/migrate.js` khi database san sang.

## Next Phase Readiness

- Migration 007 san sang chay tren PostgreSQL database
- Vitest san sang cho TDD tests trong cac plans 02-04 (portfolio controller), 02-05 (settlement engine)
- Shared kernel importable tu ca `services/shared/X.js` (new) va `services/X.js` (backward compat)
- Plans 02-02 den 02-06 co the bat dau ngay

## Self-Check: PASSED

All files verified to exist. All commits verified in git log.

---
*Phase: 01-foundation-portfolio-management*
*Completed: 2026-03-27*
