---
phase: 03-ai-enhancement
plan: 06
subsystem: frontend
tags: [ai, frontend, probability-tp, dynamic-sl, risk-budget, position-sizing]
dependency-graph:
  requires: [03-02, 03-03, 03-04, 03-05]
  provides: [probability-tp-ui, dynamic-sl-ui, risk-budget-ui, position-sizing-ui]
  affects: [TradingTerminal, AiMonitorPanel, RiskManagerView]
tech-stack:
  added: []
  patterns: [WebSocket event listening, Kelly Criterion display, sector concentration bars]
key-files:
  created: []
  modified:
    - ai-stoploss-engine-fe/services/api.ts
    - ai-stoploss-engine-fe/components/TradingTerminal.tsx
    - ai-stoploss-engine-fe/components/AiMonitorPanel.tsx
    - ai-stoploss-engine-fe/components/RiskManagerView.tsx
decisions:
  - "Su dung wsService truc tiep (socket.on) thay vi wrapper method vi DYNAMIC_SL_UPDATE chua co wrapper trong WebSocketService"
  - "Position sizing goi tren mount theo portfolioId, khong debounce vi endpoint khong phut spam"
  - "Reuse RiskGauge component hien co cho risk budget display thay vi tao component moi"
metrics:
  duration: 25min
  completed: 2026-03-27
  tasks-completed: 3
  files-modified: 4
---

# Phase 03 Plan 06: Wire AI Modules vao Frontend Summary

Wire tat ca 3 AI modules vao frontend: probability TP table trong TradingTerminal, dynamic SL narrative voi regime badge trong AiMonitorPanel, risk budget gauge + sector concentration trong RiskManagerView.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add API service functions cho new AI endpoints | e391f03 | services/api.ts |
| 2 | Upgrade TradingTerminal voi probability TP + position sizing | fd640a7 | components/TradingTerminal.tsx |
| 3 | Upgrade AiMonitorPanel + RiskManagerView | 72d8f10 | components/AiMonitorPanel.tsx, components/RiskManagerView.tsx |

## What Was Built

### Task 1 — api.ts
- 3 export async functions: `getPositionSizing`, `getRiskBudget`, `getRebalancingSuggestions`
- TypeScript interfaces: `TPLevel`, `PositionSizingResult`, `RiskBudgetResult`
- Endpoints: POST `/api/ai/position-sizing`, GET `/api/ai/risk-budget`, GET `/api/ai/rebalancing`

### Task 2 — TradingTerminal
- Hien thi probability TP levels (take_profit_levels array) dang table: Muc gia | Xac suat | Thoi gian
- Badge "Thuc nghiem" (experimental) cho probability TP section
- Fallback: khi take_profit_method === 'atr_rr', hien thi take_profit_warning text mau vang
- data_quality.days_used hien thi phia tren table
- Position sizing suggestion tich hop: goi getPositionSizing khi portfolioId co, hien thi % von + interpretation
- Kelly am: hien thi warning mau do

### Task 3 — AiMonitorPanel + RiskManagerView
**AiMonitorPanel:**
- Them interface DynamicSLUpdate
- useEffect listen WebSocket DYNAMIC_SL_UPDATE va dynamic_sl_update events
- FIFO queue giu max 20 updates
- Card display: symbol + regime badge mau sac (VOLATILE=red, BULLISH=green, BEARISH=orange, SIDEWAYS=gray)
- Hien thi old SL -> new SL, ATR info, narrative text, timestamp

**RiskManagerView:**
- Import getRiskBudget, getRebalancingSuggestions
- useEffect goi ca 2 API cung luc khi portfolioId thay doi
- Section "Ngan Sach Rui Ro": gauge (reuse RiskGauge component), da dung % + VND amounts
- Sector concentration: horizontal bars, mau do khi > 30%
- Rebalancing warnings + suggestions voi narrative cards
- RiskGauge hien co (risk per position) giu nguyen

## Success Criteria Check

- [x] TradingTerminal hien thi probability TP levels voi % va timeframe
- [x] Label "Thuc nghiem" hien thi cho probability TP
- [x] AiMonitorPanel hien thi dynamic SL narrative voi regime badge
- [x] RiskManagerView hien thi risk budget gauge + sector concentration
- [x] Position sizing suggestion hien thi khi dat lenh
- [x] TypeScript compiles (no new errors)
- [x] Build succeeds (npm run build passes)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] WebSocketService khong co named export `getWebSocket`**
- **Found during:** Task 3 (AiMonitorPanel)
- **Issue:** Plan de nghi `import { getWebSocket } from '../services/websocket'` nhung file chi export `default wsService`
- **Fix:** Su dung `import wsService from '../services/websocket'` va `(wsService as any).socket?.on(...)` truc tiep vi event DYNAMIC_SL_UPDATE chua co wrapper method trong WebSocketService
- **Files modified:** components/AiMonitorPanel.tsx
- **Commit:** 72d8f10

## Known Stubs

- `getPositionSizing`, `getRiskBudget`, `getRebalancingSuggestions` goi API endpoints `/api/ai/position-sizing`, `/api/ai/risk-budget`, `/api/ai/rebalancing` — cac endpoints nay can duoc implement o backend (plan 03-04 va 03-05). Neu backend chua co, cac section se hien thi loading va tu dong an di khi request that bai.
- Dynamic SL Updates section chi hien thi khi co WebSocket event `DYNAMIC_SL_UPDATE` tu backend. Neu backend chua emit event nay, section se an.

## Self-Check: PASSED

- FOUND: ai-stoploss-engine-fe/services/api.ts
- FOUND: ai-stoploss-engine-fe/components/TradingTerminal.tsx
- FOUND: ai-stoploss-engine-fe/components/AiMonitorPanel.tsx
- FOUND: ai-stoploss-engine-fe/components/RiskManagerView.tsx
- FOUND commit e391f03 (Task 1)
- FOUND commit fd640a7 (Task 2)
- FOUND commit 72d8f10 (Task 3)
