---
phase: 02-paper-trading-engine
plan: "05"
subsystem: frontend
tags: [paper-trading, frontend, api-client, components, performance-report]
dependency_graph:
  requires: ["02-01", "02-02", "02-03", "02-04"]
  provides: ["paper-trading-ui-complete"]
  affects: ["PortfolioView", "Paper Trading tab"]
tech_stack:
  added: []
  patterns:
    - "React functional components with hooks"
    - "Axios API client with TypeScript generics"
    - "Recharts BarChart cho buy-hold comparison"
    - "WebSocket event listener cho auto-refresh"
key_files:
  created:
    - ai-stoploss-engine-fe/components/PaperVirtualBalance.tsx
    - ai-stoploss-engine-fe/components/PaperOrderManager.tsx
    - ai-stoploss-engine-fe/components/PaperPerformanceReport.tsx
  modified:
    - ai-stoploss-engine-fe/services/api.ts
    - ai-stoploss-engine-fe/components/PortfolioView.tsx
decisions:
  - "Dung PaperOrderManager thay the inline order table cu de co edit/cancel UI"
  - "Default simulationMode = REALISTIC (theo plan requirement)"
  - "PaperPerformanceReport dung period selector tabs (all/week/month)"
  - "Buy & Hold comparison hien thi voi BarChart recharts"
  - "Auto-refresh PaperVirtualBalance via WebSocket order_filled event"
metrics:
  duration: "~5 minutes"
  completed_date: "2026-03-27"
  tasks_completed: 3
  files_modified: 5
---

# Phase 2 Plan 05: Frontend Paper Trading UI — Summary

## One-liner

Frontend Paper Trading tab duoc wire day du voi virtual balance card, order edit/cancel UI, simulation mode toggle (REALISTIC/INSTANT), va performance report voi buy & hold comparison.

## What Was Built

### Task 1: API client + 3 new components (commit: 198be03)

**api.ts additions:**
- `editPaperOrder(portfolioId, orderId, data)` — PATCH /orders/:id
- `getPaperPerformance(portfolioId, period)` — GET /paper-performance
- `getPaperVirtualBalance(portfolioId)` — GET /virtual-balance
- Types: `PaperPerformanceData`, `VirtualBalance`

**PaperVirtualBalance.tsx:**
- Fetch virtual balance on mount + refreshTrigger
- Grid 2x2 voi 4 metrics: Tong Von Ao, Kha Dung, Cho T+2, Da Deploy
- Color-coded: green/blue/yellow/gray
- Auto-refresh khi nhan WebSocket 'order_filled' event

**PaperOrderManager.tsx:**
- Filter PENDING + PARTIALLY_FILLED orders tu props
- Edit modal voi limit_price + quantity inputs
- Confirm dialog truoc khi huy lenh
- Goi onRefresh() sau moi action thanh cong

**PaperPerformanceReport.tsx:**
- Period selector: All / Tuan Nay / Thang Nay
- 6 metric cards: Total P&L, Win Rate, TB Loi, TB Lo, Profit Factor, Max Drawdown
- Buy & Hold comparison section voi BarChart (recharts)
- "Chua co giao dich" state khi total_trades === 0

### Task 2: Wire vao PortfolioView (commit: 2fb4f61)

- Import 3 components moi
- Them `simulationMode` state (default REALISTIC)
- Them `paperBalanceRefresh` trigger
- PaperVirtualBalance hien thi o dau Paper tab
- REALISTIC/INSTANT toggle bar
- PaperOrderManager thay the inline order table (co them edit + confirm cancel)
- PaperPerformanceReport o cuoi portfolio tab

### Task 3: Human Verification (auto-approved)

Backend tests: 127/127 pass. TypeScript: khong co loi moi trong cac file da tao/sua.

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None — tat ca API calls duoc wire den backend endpoints that. Data flow: UI -> api.ts -> BE endpoints (tu plan 02-01 den 02-04).

## Self-Check: PASSED
