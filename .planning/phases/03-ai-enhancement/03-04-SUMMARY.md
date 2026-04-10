---
phase: 03-ai-enhancement
plan: 04
subsystem: ai
tags: [capital-allocation, kelly-criterion, position-sizing, risk-budget, sector-concentration]

requires:
  - 03-01 (sectorClassification.js: getSector)
  - database: positions table voi status CLOSED_SL/CLOSED_TP/CLOSED_MANUAL

provides:
  - capitalAllocation: calculateHalfKelly, getTradeStats, calculateRiskBudget
  - API: POST /api/ai/position-sizing, GET /api/ai/risk-budget

affects:
  - ai-enhancement (phase 03 plan 05, 06 nếu có)
  - frontend: AiSignalsView có thể dùng data này

tech-stack:
  added: []
  patterns:
    - Half-Kelly formula với cap 25% và floor 0 (per D-15)
    - SQL GROUP BY context để tách REAL vs PAPER stats (per D-16)
    - Risk per position = (entry - stop_loss) * quantity cho LONG side

key-files:
  created:
    - ai-stoploss-engine-be/services/ai/capitalAllocation.js
    - ai-stoploss-engine-be/tests/services/capitalAllocation.test.js
  modified:
    - ai-stoploss-engine-be/controllers/ai.controller.js
    - ai-stoploss-engine-be/routes/ai.routes.js

decisions:
  - Half-Kelly cap 25% tránh over-leverage — conservative hơn full Kelly
  - combined stats tính bằng average of contexts, không weighted — đơn giản, đủ cho v1
  - getTradeStats dùng profit_loss_vnd > 0 để xác định win — consistent với toàn bộ codebase
  - getRiskBudget lấy maxRiskPercent từ portfolio.max_risk_percent, default 5%

metrics:
  duration: 5 min
  completed: 2026-03-27
  tasks: 2
  files: 4
---

# Phase 03 Plan 04: Capital Allocation Service Summary

**One-liner:** Half-Kelly position sizing + risk budget calculation với sector concentration, query closed positions REAL/PAPER.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create capitalAllocation.js service + tests (TDD) | 0fad82b | services/ai/capitalAllocation.js, tests/services/capitalAllocation.test.js |
| 2 | Add API endpoints position-sizing + risk-budget | 611c757 | controllers/ai.controller.js, routes/ai.routes.js |

## What Was Built

### capitalAllocation.js Service

**`calculateHalfKelly(winRate, avgWinLoss)`** — Tính half-Kelly fraction:
- Formula: `f* = (p*b - q) / b * 0.5`
- Cap at 25%, floor at 0
- Kelly <= 0 → interpretation "Negative expectancy..."
- Kelly > 0 → interpretation "Nen dau tu X% von..."

**`getTradeStats(portfolioId)`** — Query closed positions:
- SQL query GROUP BY context (REAL/PAPER)
- Tính winRate = wins/total, avgWinLoss = avg_win/avg_loss
- Warning khi tổng < 10 trades: "Chua du du lieu..."
- Return `{ byContext, combined, warning? }`

**`calculateRiskBudget(portfolioId, totalBalance, maxRiskPercent=5)`** — Risk budget:
- Query open positions có stop_loss IS NOT NULL
- Risk per position LONG: `(entry - stop_loss) * quantity`
- Group by sector via `getSector()` từ sectorClassification.js
- Return `{ usedRiskVnd, usedRiskPercent, maxRiskVnd, remainingBudget, positions[], sectorConcentration[] }`

### API Endpoints

**`POST /api/ai/position-sizing`**
- Body: `{ portfolio_id, symbol? }`
- Validate portfolio ownership
- Gọi `getTradeStats` + `calculateHalfKelly` với combined stats
- Nếu có symbol: thêm context vào interpretation
- Return `{ success: true, data: { kelly, stats } }`

**`GET /api/ai/risk-budget?portfolio_id=xxx`**
- Validate portfolio ownership
- Lấy `total_balance` + `max_risk_percent` từ portfolio row
- Gọi `calculateRiskBudget`
- Return `{ success: true, data: riskBudgetResult }`

## Tests

14 tests pass (TDD — RED → GREEN):
- 6 tests `calculateHalfKelly`: edge cases winRate=0/1, cap 25%, floor 0, negative expectancy
- 4 tests `getTradeStats`: 20 trades (no warning), 5 trades (warning), empty, REAL+PAPER combined
- 4 tests `calculateRiskBudget`: với positions, empty, default maxRisk, sector grouping

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None.

## Self-Check: PASSED

- `ai-stoploss-engine-be/services/ai/capitalAllocation.js` — FOUND
- `ai-stoploss-engine-be/tests/services/capitalAllocation.test.js` — FOUND
- Commit `0fad82b` — FOUND
- Commit `611c757` — FOUND
- All 209 tests pass (including 14 new)
