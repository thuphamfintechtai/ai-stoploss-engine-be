---
phase: quick
plan: 260401-x9v
subsystem: market-controller
tags: [bugfix, vpbs-api, error-handling]
key-files:
  modified:
    - controllers/market.controller.js
decisions: []
metrics:
  duration: 2m
  completed: "2026-04-02T00:02:19Z"
  tasks: 1
  files: 1
---

# Quick Task 260401-x9v: Fix vpbankFetch HTML Response Handling

**One-liner:** Migrated 15 raw vpbankFetch+json() call sites to fetchJson helper for unified HTML error handling when VPBS API returns error pages.

## What Was Done

Replaced all 15 direct `vpbankFetch()` + `response.json()` call sites in `market.controller.js` with the existing `fetchJson()` helper (line 39-59). This helper safely detects when VPBS API returns HTML error pages instead of JSON and throws a descriptive error instead of crashing with `SyntaxError: Unexpected token '<'`.

### Call Sites Migrated

| Pattern | Endpoints | Count | Approach |
|---------|-----------|-------|----------|
| A (simple) | getPrice, getMarketOverview, watchlist batch, watchlist individual | 4 | `const { data: json } = await fetchJson(url)` |
| B (response.ok check) | corpBondDetail, corpBondInfo | 2 | `const { response, data } = await fetchJson(url)` |
| C (table + response.ok) | stockCWDetail, stockDetail, fuStockDetail, stockDetailByIndustry, ptStockMatch, ptStockDetail, oddLotStockDetail | 7 | `const { response, data: json } = await fetchJson(url)` |
| D (fallback on parse fail) | ptStockBid, ptStockAsk | 2 | try/catch with `fetchOk` flag preserving empty-object fallback |

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| 1 | c63666d | fix(market): replace all raw vpbankFetch+json() with fetchJson helper |

## Verification

- `grep -n 'await vpbankFetch'` returns only line 40 (inside fetchJson helper itself)
- `grep -n '.json()'` returns no results (all .json() calls eliminated)
- `node -c controllers/market.controller.js` passes with no syntax errors

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Pattern D adjusted for response.ok check**
- **Found during:** Task 1, ptStockBid/ptStockAsk replacement
- **Issue:** Plan suggested simple try/catch with `({ data: json } = await fetchJson(url))` but original code also checked `response.ok` after fetching. Losing the response.ok check would change behavior for non-ok but valid JSON responses.
- **Fix:** Used `fetchOk` boolean flag extracted from `result.response.ok` inside the try block, defaulting to false in catch path. This preserves exact original behavior.
- **Files modified:** controllers/market.controller.js

## Known Stubs

None.

## Self-Check: PASSED
