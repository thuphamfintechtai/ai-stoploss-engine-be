---
phase: 01-foundation-portfolio-management
plan: 08
subsystem: frontend-portfolio
tags: [portfolio, real-tab, summary, api-wire, gap-closure]
dependency_graph:
  requires: []
  provides: [PORT-06-frontend]
  affects: [PortfolioView, realPortfolioApi]
tech_stack:
  added: []
  patterns: [Promise.all parallel fetch, conditional render on null state]
key_files:
  created:
    - ai-stoploss-engine-fe/components/portfolio/PortfolioSummaryCard.tsx
  modified:
    - ai-stoploss-engine-fe/services/api.ts
    - ai-stoploss-engine-fe/components/PortfolioView.tsx
decisions:
  - "Render PortfolioSummaryCard chi khi realSummary !== null (tranh flash empty data lan dau load)"
  - "summaryLoading kem theo realSummary de skeleton chi hien khi da co data lan dau"
  - "getSummary goi trong Promise.all cung posRes va portRes de minimize latency"
metrics:
  duration: "15 minutes"
  completed: "2026-03-27"
  tasks: 2
  files: 3
---

# Phase 01 Plan 08: Wire Portfolio Summary Endpoint to REAL Tab Summary

Wire frontend REAL tab voi backend GET /portfolios/:id/real-summary endpoint, tao PortfolioSummaryCard hien thi 4 metrics: tong dau tu, realized P&L, % return, so vi the.

## What Was Done

### Task 1: realPortfolioApi.getSummary (api.ts)

Them method `getSummary` vao cuoi object `realPortfolioApi` trong `ai-stoploss-engine-fe/services/api.ts`:

```typescript
getSummary: (portfolioId: string) =>
  apiClient.get(`/portfolios/${portfolioId}/real-summary`),
```

URL match chinh xac voi backend route: `GET /portfolios/:portfolioId/real-summary`

**Commit:** `c5925ab` — feat(01-08): them realPortfolioApi.getSummary goi GET /portfolios/:id/real-summary

### Task 2: PortfolioSummaryCard + PortfolioView wire

**File moi tao:** `ai-stoploss-engine-fe/components/portfolio/PortfolioSummaryCard.tsx`

Component hien thi 4 metrics trong grid layout:
- Tong da dau tu (total_value)
- Lai/Lo thuc hien (total_pnl) — mau green/red theo gia tri
- % Loi nhuan (percent_return) — mau green/red, hien thi 2 decimal
- Vi the mo / dong (position_count / closed_count)

Skeleton "Dang tai..." hien khi `loading=true`. Component khong render khi `realSummary === null` (tranh flash truoc khi co data).

**Cap nhat PortfolioView.tsx:**
1. Import `PortfolioSummaryCard` tu `./portfolio/PortfolioSummaryCard`
2. Them state `realSummary` va `summaryLoading`
3. Cap nhat `fetchRealData`: them `realPortfolioApi.getSummary(portfolioId)` vao `Promise.all`
4. Xu ly response: `setRealSummary({ total_value, total_pnl, percent_return, position_count, closed_count })`
5. Render `<PortfolioSummaryCard>` sau `<CashBalanceCard>` trong REAL tab JSX

**Re-fetch tu dong:** `fetchRealData` da duoc goi boi:
- `RealOrderForm.onSuccess={fetchRealData}` — sau khi nhap lenh mua thanh cong
- `ClosePositionModal.onSuccess={fetchRealData}` — sau khi dong vi the thanh cong

**Commit:** `7ae3beb` — feat(01-08): tao PortfolioSummaryCard va wire vao PortfolioView REAL tab

## Gap Closed

**PORT-06** "User co the xem tong quan portfolio" da duoc dong tu phia frontend:
- Backend endpoint `GET /portfolios/:id/real-summary` da ton tai tu Phase 01 Plan 06
- Frontend REAL tab gio goi endpoint va hien thi ket qua

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None - PortfolioSummaryCard nhan data thuc tu API, khong co stub hay hardcoded value.

## Self-Check: PASSED

- ai-stoploss-engine-fe/services/api.ts: getSummary method ton tai (line 693)
- ai-stoploss-engine-fe/components/portfolio/PortfolioSummaryCard.tsx: file ton tai, export PortfolioSummaryCard
- ai-stoploss-engine-fe/components/PortfolioView.tsx: import, state, getSummary call, JSX render — tat ca dung
- Commits: c5925ab, 7ae3beb (trong ai-stoploss-engine-fe repo)
- TypeScript: Khong co loi moi do cac thay doi cua task nay (loi pre-existing trong chart-plugins va AppErrorBoundary)
