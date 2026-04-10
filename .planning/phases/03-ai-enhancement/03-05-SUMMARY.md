---
phase: 03-ai-enhancement
plan: "05"
subsystem: backend-ai
tags: [rebalancing, sector-concentration, gemini, tdd, api]
dependency_graph:
  requires: [03-02, 03-03]
  provides: [rebalancing-suggestion-service, rebalancing-api-endpoint]
  affects: [ai-controller, ai-routes]
tech_stack:
  added: []
  patterns: [tdd-red-green, promise-race-timeout, rule-based-fallback]
key_files:
  created:
    - ai-stoploss-engine-be/services/ai/rebalancingSuggestion.js
    - ai-stoploss-engine-be/tests/services/rebalancing.test.js
  modified:
    - ai-stoploss-engine-be/controllers/ai.controller.js
    - ai-stoploss-engine-be/routes/ai.routes.js
decisions:
  - "Dung Promise.race voi 5s timeout cho Gemini call, fallback sang rule-based narrative bang tieng Viet"
  - "Threshold canh bao 30% per D-18; goi y rule-based list tung sector vi pham"
  - "Skip positions khong co market_value va entry_price thay vi throw error"
metrics:
  duration: "8 phut"
  completed: "2026-03-27"
  tasks: 2
  files: 4
---

# Phase 03 Plan 05: Rebalancing Suggestion Service Summary

Rebalancing suggestion service voi sector concentration warning, rule-based goi y, Gemini narrative + 5s fallback, va GET /api/ai/rebalancing endpoint.

## Tasks Completed

### Task 1: Create rebalancingSuggestion.js service + tests (TDD)

**Status:** DONE

**TDD RED** — `tests/services/rebalancing.test.js` (commit `1b1d9e8`):
- 12 tests: sectorBreakdown grouping, warnings > 30%, suggestions text, Gemini narrative, fallback timeout, empty positions, skip invalid positions
- Tests failed nhu mong doi vi service chua ton tai

**TDD GREEN** — `services/ai/rebalancingSuggestion.js` (commit `96960fd`):
- `generateRebalancingSuggestions(positions, totalPortfolioValue)` export
- Group positions by sector via `getSector()` tu sectorClassification.js
- Tinh percent per sector, sort by percent DESC
- Warnings: sectors > 30% (per D-18)
- Suggestions: rule-based text "Nganh X chiem Y% — giam xuong duoi 30%"
- Narrative: Gemini JSON call voi 5s `Promise.race` timeout (per D-07), fallback list warnings bang tieng Viet
- Skip positions khong co `market_value` hoac `entry_price * quantity`
- 12/12 tests pass

### Task 2: Add rebalancing API endpoint + wire to routes

**Status:** DONE — commit `611c757` (bundled voi 03-04)

- `getRebalancingSuggestions` handler trong `ai.controller.js`
- Import `generateRebalancingSuggestions` service
- Query `positions WHERE portfolio_id AND status = 'OPEN'`
- Tinh `totalPortfolioValue` tu open positions (uu tien `market_value`)
- Return `{ success: true, data: { sectorBreakdown, warnings, suggestions, narrative } }`
- Route `GET /api/ai/rebalancing` trong `ai.routes.js`
- Authentication: inherits `router.use(authenticateToken)`

## Verification Results

```
Tests: 16 passed (16 files), 209/209 tests passed
Rebalancing tests: 12/12 passed
Duration: 5.35s
```

Acceptance criteria:
- grep "export async function generateRebalancingSuggestions" — PASS
- grep "getSector" — PASS
- grep "SECTOR_LABELS" — PASS
- grep "30" — PASS
- grep "sectorBreakdown" in tests — PASS
- grep "warnings" in tests — PASS
- grep "rebalancing" in routes — PASS
- grep "getRebalancingSuggestions" in controller — PASS
- grep "generateRebalancingSuggestions" in controller — PASS

## Commits

| Hash | Message |
|------|---------|
| `1b1d9e8` | test(03-05): add failing tests for rebalancingSuggestion service (TDD RED) |
| `96960fd` | feat(03-05): implement rebalancingSuggestion service (TDD GREEN) |
| `611c757` | feat(03-04): add position-sizing and risk-budget API endpoints (includes route/controller wiring) |

## Deviations from Plan

**1. [Rule 2 - Missing] DB_SCHEMA prefix trong SQL query cua getRebalancingSuggestions**
- **Found during:** Task 2
- **Issue:** Plan ghi query `FROM positions` nhung codebase dung `${DB_SCHEMA}.positions` cho tat ca queries
- **Fix:** Them `${DB_SCHEMA}.` prefix vao query trong getRebalancingSuggestions de nhat quan voi pattern hien tai
- **Files modified:** `controllers/ai.controller.js`

**2. Controller/routes commit bundled voi 03-04**
- Task 2 commit (`611c757`) ghi nhan la `feat(03-04)` do file da duoc staged va commit truoc khi execute 03-05 append vao controller
- No functional impact — code hien dien day du trong HEAD

## Known Stubs

None — service tra ve du lieu thuc, khong co hardcoded values hay placeholders.

## Self-Check: PASSED
