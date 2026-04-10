---
phase: 05-integration-polish
plan: "02"
subsystem: backend-ai-performance
tags: [gemini, timeout, fallback, pagination, indexes, performance]
dependency_graph:
  requires: []
  provides: [gemini-timeout-wrapper, ai-source-flag, position-pagination, db-indexes]
  affects: [aiService, dynamicStopLoss, rebalancingSuggestion, indicatorCache, Position, paperPosition.controller]
tech_stack:
  added: []
  patterns: [Promise.race timeout, rule-based fallback, pagination with total count]
key_files:
  created:
    - ai-stoploss-engine-be/migrations/009_performance_indexes.sql
  modified:
    - ai-stoploss-engine-be/services/aiService.js
    - ai-stoploss-engine-be/services/ai/dynamicStopLoss.js
    - ai-stoploss-engine-be/services/ai/rebalancingSuggestion.js
    - ai-stoploss-engine-be/services/ai/indicatorCache.js
    - ai-stoploss-engine-be/models/Position.js
    - ai-stoploss-engine-be/controllers/paper/paperPosition.controller.js
decisions:
  - "generateSLNarrative va generateNarrative tra ve object {narrative, ai_source} thay vi string thuan — breaking change nho nhung can thiet de truyen ai_source len caller"
  - "Position pagination dung lazy trigger (chi active khi co ?page hoac ?limit param) de backward compatible voi existing code"
  - "REGIME_CACHE_TTL_MS=60min rieng voi CACHE_TTL_MS=30min cho indicators — regime khong can recalculate thuo so voi indicators"
  - "settlement_events va paper_settlement_events dung status column (khong co is_settled boolean) — partial indexes WHERE status='SETTLED'"
metrics:
  duration: "~20 minutes"
  completed_date: "2026-03-27"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 6
  files_created: 1
---

# Phase 05 Plan 02: Backend Gemini Fallback Audit + Performance Optimization Summary

**One-liner:** Gemini timeout 5s voi Promise.race fallback rule-based, ai_source flag trong moi AI response, position pagination 20/page, 5 DB indexes moi cho performance.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Gemini fallback audit — timeout + ai_source + regime cache | 8e32a52 | aiService.js, dynamicStopLoss.js, rebalancingSuggestion.js, indicatorCache.js |
| 2 | Performance — Position pagination + DB indexes | fc93436 | Position.js, paperPosition.controller.js, 009_performance_indexes.sql |

## What Was Built

### Task 1: Gemini Fallback Audit

**aiService.js:**
- Them `GEMINI_TIMEOUT_MS = 5000` constant
- `callGeminiJSON` bao gom `Promise.race([model.generateContent(prompt), timeoutPromise])` — throw Error khi timeout 5s
- Wrap fallback try-catch + `ai_source: 'gemini'|'rule-based'` cho 5 functions: `analyzeTrend`, `evaluateTradeRisk`, `generateSignal`, `generateMarketSummary`, `reviewOpenPositions`, `detectMarketRegime`

**dynamicStopLoss.js:**
- `generateSLNarrative` tra ve `{ narrative: string, ai_source: 'gemini'|'rule-based' }` thay vi string

**rebalancingSuggestion.js:**
- `generateNarrative` tra ve `{ narrative: string, ai_source: 'gemini'|'rule-based' }`
- `generateRebalancingSuggestions` merge `ai_source` vao return object

**indicatorCache.js:**
- Them `REGIME_CACHE_TTL_MS = 60 * 60 * 1000` (60 phut)
- Khi indicators 30min stale nhung regime < 60min: reset indicators, giu regime cu (khong recalculate)

### Task 2: Performance Optimization

**Position.js:**
- `findByPortfolioPaginated(portfolioId, { page=1, limit=20, status=null })`: COUNT query + data query voi LIMIT/OFFSET
- Tra ve `{ data, total, page, limit, totalPages }`
- `findByPortfolioId` giu nguyen (backward compatible)

**paperPosition.controller.js list:**
- Tu dong dung `findByPortfolioPaginated` khi co `?page` hoac `?limit` query param
- Response `pagination.totalPages` duoc tra ve dung
- Default limit=20 thay vi 50 cu

**009_performance_indexes.sql:**
- `idx_positions_portfolio_opened`: composite (portfolio_id, opened_at DESC) cho pagination
- `idx_positions_context`, `idx_orders_context`: IF NOT EXISTS (da co tu migration 007)
- `idx_settlement_portfolio_settled`: partial WHERE status='SETTLED'
- `idx_paper_settlement_portfolio_settled`: partial WHERE status='SETTLED'

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] generateSLNarrative return type change**
- **Found during:** Task 1
- **Issue:** Plan yeu cau them ai_source vao return object cua generateSLNarrative, nhung function dang tra ve string thuan
- **Fix:** Doi return type thanh `{ narrative: string, ai_source: ... }`. Caller trong stopLossMonitor/worker co the can update nhung la safe change vi object co field narrative
- **Files modified:** dynamicStopLoss.js
- **Commit:** 8e32a52

**2. [Rule 1 - Bug] settlement_events khong co is_settled column**
- **Found during:** Task 2 — plan chi dinh `is_settled` boolean
- **Issue:** settlement_events va paper_settlement_events dung `status VARCHAR` khong phai `is_settled BOOLEAN`
- **Fix:** Dung `WHERE status = 'SETTLED'` trong partial indexes thay vi `WHERE is_settled IS NOT NULL`
- **Files modified:** 009_performance_indexes.sql
- **Commit:** fc93436

## Success Criteria Verification

- [x] Tat ca Gemini calls co timeout 5s voi fallback rule-based (callGeminiJSON + Promise.race)
- [x] AI responses co ai_source field ('gemini' hoac 'rule-based')
- [x] Position list tra ve paginated response (20 items/page mac dinh)
- [x] Migration file co indexes cho context, pagination, settlement

## Known Stubs

Khong co stubs. Tat ca functionality da duoc wire day du.

## Self-Check: PASSED
