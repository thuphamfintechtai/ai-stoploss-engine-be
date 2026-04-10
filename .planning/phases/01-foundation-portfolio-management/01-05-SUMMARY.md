---
phase: 01-foundation-portfolio-management
plan: 05
subsystem: frontend
tags: [react, portfolio, components, real-orders, cash-balance, positions]
dependency_graph:
  requires: [01-02, 01-03]
  provides: [portfolio-ui, real-order-form, cash-balance-card, positions-table, close-modal, transaction-history]
  affects: [PortfolioView, portfolio-components]
tech_stack:
  added: []
  patterns: [React FC, Tailwind CSS, axios via realPortfolioApi, conditional rendering]
key_files:
  created:
    - ai-stoploss-engine-fe/components/portfolio/RealOrderForm.tsx
    - ai-stoploss-engine-fe/components/portfolio/CashBalanceCard.tsx
    - ai-stoploss-engine-fe/components/portfolio/RealPositionsTable.tsx
    - ai-stoploss-engine-fe/components/portfolio/ClosePositionModal.tsx
    - ai-stoploss-engine-fe/components/portfolio/TransactionHistory.tsx
  modified:
    - ai-stoploss-engine-fe/services/api.ts
    - ai-stoploss-engine-fe/components/PortfolioView.tsx
decisions:
  - "RealPosition type added to api.ts for type-safe real position data"
  - "mainTab state (REAL/PAPER) added separately from existing PortfolioTab to avoid collision with paper trading tabs"
  - "fetchRealData dung Promise.all de fetch positions va cash balance song song"
  - "Portfolio model dung SELECT * nen available_cash va pending_settlement_cash tu dong co trong response sau migration 007"
metrics:
  duration: "15 minutes"
  completed_date: "2026-03-27"
  tasks_completed: 3
  files_created: 5
  files_modified: 2
---

# Phase 01 Plan 05: Portfolio Management UI Components Summary

**One-liner:** 6 React components for real portfolio management (order form, cash balance card, positions table, close modal, transaction history) integrated into PortfolioView with Real/Paper tab switching.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | API Service + Core Components | add9429 (fe) | api.ts, RealOrderForm.tsx, CashBalanceCard.tsx, RealPositionsTable.tsx |
| 2 | ClosePositionModal, TransactionHistory, PortfolioView update | 3f2cf7c (fe) | ClosePositionModal.tsx, TransactionHistory.tsx, PortfolioView.tsx |
| 3 | Checkpoint human-verify | auto-approved | - |

## What Was Built

### API Service Update (api.ts)
- Added `realPortfolioApi` with 4 methods: `createOrder`, `getTransactionHistory`, `getOpenPositions`, `closePosition`
- Added TypeScript types: `CreateRealOrderRequest`, `RealOrder`, `RealPosition`, `CloseRealPositionRequest`

### RealOrderForm.tsx
- 6 form fields: Ma CK (auto-uppercase), San (HOSE/HNX/UPCOM), Loai lenh (MUA/BAN toggle), So luong, Gia khop, Ngay khop
- Auto-calculate: tong gia tri, phi (0.15% mua / 0.25% ban), con lai sau giao dich
- Submit POST /real-orders, call onSuccess() sau khi thanh cong
- Reset form sau khi submit thanh cong

### CashBalanceCard.tsx
- Hien thi 4 metrics: Tong Von, Kha Dung (green), Cho TT T+2 (yellow), Da Deploy (blue)
- deployedCash = totalBalance - availableCash - pendingSettlement

### RealPositionsTable.tsx
- Table voi 8 columns: Ma CK, San, Gia Vao, So Luong, Gia HT, P&L, Ngay Mo, Action
- Button "Dong vi the" goi onClosePosition(position)
- P&L mau xanh > 0, do < 0
- Empty state: "Chua co vi the nao"
- Loading state

### ClosePositionModal.tsx
- Modal overlay (fixed inset-0, z-50)
- Show entry price, quantity info
- Input: Gia ban, Ngay ban
- Auto-calculate: Gross P&L, phi mua (0.15%), phi ban (0.15%), thue ban (0.1%), Net P&L
- Net P&L mau xanh/do
- Submit POST /real-positions/:id/close
- Buttons: "Xac Nhan Dong" va "Huy"

### TransactionHistory.tsx
- Fetch GET /real-orders voi pagination
- Table: Ngay, Loai (badge MUA green / BAN red), Ma CK, San, SL, Gia, Tong GT, Phi
- Pagination: Previous/Next buttons, hien trang X / Y
- Format VND voi toLocaleString

### PortfolioView.tsx Update
- Them `mainTab` state (`'REAL' | 'PAPER'`) rieng biet voi `activeTab` paper trading tabs
- Tab buttons "Portfolio That" (blue) / "Paper Trading" (purple) o top
- REAL tab: render CashBalanceCard + RealOrderForm + RealPositionsTable + TransactionHistory + ClosePositionModal
- PAPER tab: wrap toan bo existing PortfolioView content (khong xoa gi)
- `fetchRealData` hook: fetch open positions + cash balance song song
- useEffect: chi fetch real data khi mainTab === 'REAL'

## Backend Verification
Portfolio model dung `SELECT *` trong `findById` nen sau migration 007, `available_cash` va `pending_settlement_cash` tu dong co trong GET /api/portfolios/:id response. Khong can thay doi backend.

## Deviations from Plan

### Auto-fixed Issues

None.

### Additional Notes
- `mainTab` duoc dat ten khac `activeTab` de tranh conflict voi existing paper trading tab system
- Cash balance fallback ve `totalBalance` prop khi `available_cash` = 0 (chua co data tu migration)

## Known Stubs

None - tat ca components deu co data sources duoc wire chinh xac qua realPortfolioApi.

## Self-Check: PASSED

- FOUND: ai-stoploss-engine-fe/components/portfolio/RealOrderForm.tsx
- FOUND: ai-stoploss-engine-fe/components/portfolio/CashBalanceCard.tsx
- FOUND: ai-stoploss-engine-fe/components/portfolio/RealPositionsTable.tsx
- FOUND: ai-stoploss-engine-fe/components/portfolio/ClosePositionModal.tsx
- FOUND: ai-stoploss-engine-fe/components/portfolio/TransactionHistory.tsx
- FOUND: .planning/phases/01-foundation-portfolio-management/01-05-SUMMARY.md
- Commit add9429 verified in ai-stoploss-engine-fe
- Commit 3f2cf7c verified in ai-stoploss-engine-fe
