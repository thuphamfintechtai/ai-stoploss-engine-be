---
phase: 01-foundation-portfolio-management
verified: 2026-03-27T08:30:00Z
status: passed
score: 11/11 must-haves verified
re_verification: true
  previous_status: gaps_found
  previous_score: 9/11
  gaps_closed:
    - "User co the xem tong quan portfolio (tong P&L, % return) — PORT-06 frontend wire da duoc them"
    - "Unit tests pass cho RealOrderService — vi.mock CapitalService da duoc them, 39/39 tests pass"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Verify UI Portfolio That tab hoat dong end-to-end"
    expected: "Tab Real/Paper chuyen doi muot, form nhap lenh, bang vi the, lich su giao dich hien thi dung. CashBalanceCard va PortfolioSummaryCard hien thi du 4 metrics moi. Cash balance cap nhat sau khi nhap lenh."
    why_human: "Can chay ca frontend + backend voi DB thuc de verify toan bo flow. Khong the kiem tra programmatically."
---

# Phase 01: Foundation Portfolio Management — Verification Report

**Phase Goal:** User co the quan ly portfolio that (nhap lenh, theo doi von, dong vi the) trong mot flow tach biet hoan toan khoi paper trading
**Verified:** 2026-03-27T08:30:00Z
**Status:** passed
**Re-verification:** Yes — sau khi dong 2 gaps tu verification lan dau (Plans 01-07, 01-08)

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                      | Status   | Evidence                                                                                       |
|----|----------------------------------------------------------------------------|----------|-----------------------------------------------------------------------------------------------|
| 1  | Migration 007 them context column voi DEFAULT 'PAPER' cho data cu          | VERIFIED | 007_context_separation.sql ton tai, co 2x "context VARCHAR(20)", DEFAULT 'PAPER'             |
| 2  | Orders va positions tables co context column NOT NULL                       | VERIFIED | Migration ALTER TABLE them NOT NULL DEFAULT 'PAPER' cho ca 2 table                           |
| 3  | Portfolios table co available_cash va pending_settlement_cash               | VERIFIED | Migration co ALTER TABLE portfolios ADD COLUMN available_cash, pending_settlement_cash        |
| 4  | settlement_events table duoc tao                                            | VERIFIED | Migration CREATE TABLE financial.settlement_events ton tai                                    |
| 5  | stop_loss cho phep NULL khi context='REAL'                                  | VERIFIED | Migration ALTER COLUMN stop_loss DROP NOT NULL + CHECK constraint moi                         |
| 6  | User co the nhap lenh that qua form don gian                                | VERIFIED | RealOrderForm.tsx ton tai (7 fields + auto-fee), goi realPortfolioApi.createOrder -> POST /real-orders |
| 7  | User co the xem cash balance (available, pending, deployed)                 | VERIFIED | CashBalanceCard.tsx hien 4 metrics, PortfolioView REAL tab fetch va wire du lieu             |
| 8  | User co the dong vi the thu cong voi P&L                                    | VERIFIED | ClosePositionModal.tsx + RealPositionService.closePosition voi calculateFees, CLOSED_MANUAL  |
| 9  | fillEngine KHONG chay cho real orders                                       | VERIFIED | realOrderService.js khong import fillEngine, paper/fillEngine.js co context guard early return |
| 10 | Paper trading tach biet hoan toan khoi real flow                            | VERIFIED | controllers/paper/ va services/paper/ rieng, stopLossMonitor filter PAPER, re-export wrappers |
| 11 | User co the xem tong quan portfolio (tong P&L, % return)                    | VERIFIED | PortfolioSummaryCard.tsx moi hien 4 metrics, getSummary goi GET /real-summary trong fetchRealData |
| 12 | Unit tests pass cho toan bo phase                                           | VERIFIED | 39/39 tests pass: vi.mock capitalService.js them vao realOrderService.test.js (line 34-44)   |

**Score:** 11/11 truths verified

---

### Required Artifacts

| Artifact                                                                         | Expected                              | Status   | Details                                                             |
|----------------------------------------------------------------------------------|---------------------------------------|----------|---------------------------------------------------------------------|
| `ai-stoploss-engine-be/migrations/007_context_separation.sql`                    | Context + cash balance + settlement   | VERIFIED | Co du tat ca ALTER TABLE, CREATE TABLE, 5 indexes                   |
| `ai-stoploss-engine-be/vitest.config.js`                                         | Vitest config                         | VERIFIED | Chua defineConfig, environment: 'node'                              |
| `ai-stoploss-engine-be/tests/helpers/db.js`                                      | Mock DB helper                        | VERIFIED | mockQuery, mockTransaction, setupDbMock, resetDbMocks               |
| `ai-stoploss-engine-be/services/shared/feeEngine.js`                             | Fee calculation shared                | VERIFIED | calculateFees, calculateBuyFee exported                             |
| `ai-stoploss-engine-be/services/portfolio/realOrderService.js`                   | Real order business logic             | VERIFIED | context: 'REAL', MANUAL_RECORD, CapitalService.deductForBuy         |
| `ai-stoploss-engine-be/services/portfolio/realPositionService.js`                | Real position close + P&L             | VERIFIED | CLOSED_MANUAL, calculateFees, addPendingSettlement                  |
| `ai-stoploss-engine-be/controllers/portfolio/realOrder.controller.js`            | HTTP handler real order entry         | VERIFIED | createRealOrder, createRealOrderSchema, getTransactionHistory       |
| `ai-stoploss-engine-be/controllers/portfolio/realPosition.controller.js`         | HTTP handler position close           | VERIFIED | closePosition, closePositionSchema                                  |
| `ai-stoploss-engine-be/services/portfolio/capitalService.js`                     | Cash balance T+2 settlement           | VERIFIED | FOR UPDATE, VN_HOLIDAYS, statusCode 422, addBusinessDays            |
| `ai-stoploss-engine-be/workers/settlementWorker.js`                              | Cron job T+2 settlement               | VERIFIED | cron '0 9 * * 1-5', startSettlementWorker                           |
| `ai-stoploss-engine-be/services/paper/fillEngine.js`                             | fillEngine trong paper subfolder      | VERIFIED | context guard `order.context !== 'PAPER'`                           |
| `ai-stoploss-engine-be/controllers/portfolio/portfolioSummary.controller.js`     | Portfolio summary endpoint            | VERIFIED | total_pnl, context='REAL', CLOSED_MANUAL queries                    |
| `ai-stoploss-engine-be/tests/services/realOrderService.test.js`                  | Test suite voi mock CapitalService    | VERIFIED | vi.mock('../../services/portfolio/capitalService.js') line 34, 39/39 pass |
| `ai-stoploss-engine-fe/components/portfolio/RealOrderForm.tsx`                   | Form nhap lenh that                   | VERIFIED | 6 fields + auto-fee, goi realPortfolioApi.createOrder               |
| `ai-stoploss-engine-fe/components/portfolio/CashBalanceCard.tsx`                 | Card cash balance                     | VERIFIED | available_cash, 4 metrics hien thi                                  |
| `ai-stoploss-engine-fe/components/portfolio/RealPositionsTable.tsx`              | Bang vi the REAL                      | VERIFIED | RealPositionsTable, nut "Dong vi the"                               |
| `ai-stoploss-engine-fe/components/portfolio/ClosePositionModal.tsx`              | Modal dong vi the                     | VERIFIED | sell_price input, POST close endpoint                               |
| `ai-stoploss-engine-fe/components/portfolio/TransactionHistory.tsx`              | Lich su giao dich                     | VERIFIED | fetch /real-orders, pagination                                      |
| `ai-stoploss-engine-fe/components/portfolio/PortfolioSummaryCard.tsx`            | Component hien thi portfolio summary  | VERIFIED | Export PortfolioSummaryCard, 4 metrics: totalValue/totalPnl/percentReturn/positionCount |
| `ai-stoploss-engine-fe/components/PortfolioView.tsx`                             | View voi Real/Paper tab               | VERIFIED | mainTab state, tab buttons, REAL/PAPER conditional render, realSummary state, getSummary wire |
| `ai-stoploss-engine-fe/services/api.ts` (realPortfolioApi)                       | API methods cho real orders + summary | VERIFIED | createOrder, getTransactionHistory, getOpenPositions, closePosition, getSummary (line 693-694) |

---

### Key Link Verification

| From                                        | To                                                              | Via                                        | Status   | Details                                                                  |
|---------------------------------------------|-----------------------------------------------------------------|--------------------------------------------|----------|--------------------------------------------------------------------------|
| `realOrder.controller.js`                   | `services/portfolio/realOrderService.js`                        | import RealOrderService                    | WIRED    | import RealOrderService from '../../services/portfolio/realOrderService.js' |
| `realOrderService.js`                       | `services/shared/feeEngine.js`                                  | import calculateBuyFee                     | WIRED    | import { calculateBuyFee } from '../shared/feeEngine.js'                 |
| `routes/portfolio.routes.js`                | `controllers/portfolio/realOrder.controller.js`                 | POST real-orders                           | WIRED    | 4 routes: POST/GET real-orders, GET real-positions, POST close           |
| `services/fillEngine.js`                    | `services/paper/fillEngine.js`                                  | re-export                                  | WIRED    | export { checkAndFillOrders } from './paper/fillEngine.js'               |
| `workers/stopLossMonitor.js`                | positions filter context='PAPER'                                | AND context = 'PAPER' in query             | WIRED    | 7 matches grep PAPER trong stopLossMonitor                               |
| `workers/settlementWorker.js`               | `services/portfolio/capitalService.js`                          | import CapitalService                      | WIRED    | import CapitalService from '../services/portfolio/capitalService.js'     |
| `index.js`                                  | `workers/settlementWorker.js`                                   | import and start worker                    | WIRED    | line 11 import, line 78 startSettlementWorker()                          |
| `realOrder.controller.js`                   | `services/portfolio/capitalService.js`                          | CapitalService.deductForBuy                | WIRED    | deductForBuy called in realOrderService (service layer)                  |
| `realPosition.controller.js`                | `services/portfolio/capitalService.js`                          | CapitalService.addPendingSettlement        | WIRED    | addPendingSettlement called in realPositionService                       |
| `routes/portfolio.routes.js`                | `controllers/portfolio/portfolioSummary.controller.js`          | GET real-summary                           | WIRED    | router.get('/:portfolioId/real-summary', ...) line 48                   |
| `PortfolioView.tsx` (REAL tab)              | `GET /portfolios/:id/real-summary`                              | realPortfolioApi.getSummary(portfolioId)   | WIRED    | fetchRealData line 162: getSummary trong Promise.all, setRealSummary line 177 |
| `PortfolioSummaryCard`                      | realSummary state                                               | props totalValue/totalPnl/percentReturn    | WIRED    | JSX lines 352-361, conditional render khi realSummary !== null           |
| `realOrderService.test.js`                  | `services/portfolio/capitalService.js`                          | vi.mock (test isolation)                   | WIRED    | vi.mock('../../services/portfolio/capitalService.js') line 34            |

---

### Data-Flow Trace (Level 4)

| Artifact                          | Data Variable                      | Source                                                                                       | Produces Real Data | Status              |
|-----------------------------------|------------------------------------|----------------------------------------------------------------------------------------------|--------------------|---------------------|
| `RealOrderForm.tsx`               | form submit                        | realPortfolioApi.createOrder -> POST /real-orders -> realOrderService.recordBuyOrder (DB insert) | Yes               | FLOWING             |
| `CashBalanceCard.tsx`             | totalBalance, availableCash        | PortfolioView fetchRealData -> portfolioApi.getById -> SELECT * portfolios                   | Yes                | FLOWING             |
| `RealPositionsTable.tsx`          | positions[]                        | realPortfolioApi.getOpenPositions -> GET /real-positions -> realPositionService.getOpenPositions | Yes               | FLOWING             |
| `TransactionHistory.tsx`          | orders[]                           | realPortfolioApi.getTransactionHistory -> GET /real-orders -> realOrderService.getTransactionHistory | Yes           | FLOWING             |
| `ClosePositionModal.tsx`          | sell_price, sell_date              | POST -> realPositionService.closePosition (DB transaction)                                   | Yes                | FLOWING             |
| `PortfolioSummaryCard.tsx`        | totalValue, totalPnl, percentReturn | fetchRealData -> realPortfolioApi.getSummary -> GET /real-summary -> portfolioSummary.controller (DB aggregates) | Yes | FLOWING |
| `portfolioSummary.controller.js`  | total_unrealized_pnl               | Hardcoded = 0 (TODO Phase 5)                                                                | No (intentional)   | STATIC — documented |

---

### Behavioral Spot-Checks

| Behavior                                              | Command                                                                                          | Result                      | Status |
|-------------------------------------------------------|--------------------------------------------------------------------------------------------------|-----------------------------|--------|
| Vitest full suite pass                                | `npx vitest run` (ai-stoploss-engine-be)                                                        | Test Files 6 passed (6), Tests 39 passed (39), 0 failures | PASS |
| vi.mock CapitalService ton tai va substantive          | grep deductForBuy + mockResolvedValue trong realOrderService.test.js                            | Line 36: deductForBuy: vi.fn().mockResolvedValue(undefined) | PASS |
| getSummary URL dung format                            | grep getSummary api.ts lines 693-694                                                             | `/portfolios/${portfolioId}/real-summary` | PASS |
| PortfolioSummaryCard renders 4 metrics                | Read PortfolioSummaryCard.tsx — 4 div blocks: totalValue/totalPnl/percentReturn/positionCount   | PASS (substantive, no stubs) | PASS |
| fetchRealData goi getSummary trong Promise.all        | grep lines 159-163 PortfolioView.tsx                                                             | getSummary(portfolioId) la phan tu thu 3 trong Promise.all | PASS |
| PortfolioSummaryCard render sau CashBalanceCard       | Read PortfolioView.tsx lines 347-361                                                             | CashBalanceCard line 347, PortfolioSummaryCard line 352-361 | PASS |
| Migration 007 co tat ca required patterns             | grep context VARCHAR(20), settlement_events, available_cash, MANUAL_RECORD                      | All patterns found          | PASS   |
| fillEngine re-export chain hoat dong                  | grep "from.*paper/" services/fillEngine.js                                                      | PASS                        | PASS   |

---

### Requirements Coverage

| Requirement | Source Plan        | Description                                                               | Status    | Evidence                                                                        |
|-------------|---------------------|---------------------------------------------------------------------------|-----------|---------------------------------------------------------------------------------|
| FOUND-01    | 01-01              | Tach Portfolio Management va Paper Trading thanh 2 flow rieng biet         | SATISFIED | controllers/paper/, services/paper/, controllers/portfolio/, mainTab REAL/PAPER |
| FOUND-02    | 01-01              | Them cot context ('REAL'/'PAPER') vao bang orders va positions             | SATISFIED | Migration 007 ALTER TABLE orders + positions ADD context VARCHAR(20)            |
| FOUND-03    | 01-02, 01-07       | Portfolio mode khong chay fillEngine                                       | SATISFIED | realOrderService.js KHONG import fillEngine; 39/39 tests pass xac nhan         |
| FOUND-04    | 01-04              | Paper Trading mode su dung fillEngine rieng voi virtual balance            | SATISFIED | services/paper/fillEngine.js co context guard, stopLossMonitor chi PAPER        |
| FOUND-05    | 01-01              | To chuc lai Shared Kernel thanh module dung chung                          | SATISFIED | 7 services trong services/shared/ voi backward-compat re-exports               |
| PORT-01     | 01-02, 01-05       | User co the nhap lenh that da dat tren san                                 | SATISFIED | RealOrderForm.tsx 6 fields, POST /real-orders, RealOrderService.recordBuyOrder  |
| PORT-02     | 01-03, 01-05       | User co the xem cash balance                                               | SATISFIED | CashBalanceCard.tsx 4 metrics, CapitalService.getBalance, GET /portfolios/:id   |
| PORT-03     | 01-03, 01-06, 01-07 | Cash balance tu dong cap nhat T+2 settlement                              | SATISFIED | CapitalService.deductForBuy, addPendingSettlement, settlementWorker cron 9AM; tests pass |
| PORT-04     | 01-02, 01-05       | User co the dong vi the thu cong voi realized P&L                          | SATISFIED | ClosePositionModal, RealPositionService.closePosition, CLOSED_MANUAL            |
| PORT-05     | 01-02, 01-05       | User co the xem lich su giao dich voi phi va thue VN                       | SATISFIED | TransactionHistory.tsx, GET /real-orders, feeEngine tinh phi                    |
| PORT-06     | 01-06, 01-08       | User co the xem tong quan portfolio (tong gia tri, tong P&L, % return)     | SATISFIED | PortfolioSummaryCard.tsx moi + getSummary trong api.ts + fetchRealData wire     |

**Tat ca 11 requirements (FOUND-01 den FOUND-05, PORT-01 den PORT-06) da SATISFIED.**

---

### Anti-Patterns Found

| File                                                                         | Line | Pattern                                              | Severity | Impact                                                          |
|------------------------------------------------------------------------------|------|------------------------------------------------------|----------|-----------------------------------------------------------------|
| `ai-stoploss-engine-be/controllers/portfolio/portfolioSummary.controller.js` | 52   | `total_unrealized_pnl = 0` hardcoded (TODO comment)  | INFO     | Intentional stub, documented la se tich hop Phase 5. Khong blocking. |
| `ai-stoploss-engine-be/services/portfolio/capitalService.js`                 | 18   | `TODO: Cap nhat lich nghi le truoc 2028`             | INFO     | VN_HOLIDAYS co du 2026-2027, can update cho 2028. Khong blocking. |

Khong co BLOCKER anti-pattern nao sau gap closure.

---

### Human Verification Required

#### 1. Portfolio That Tab — End-to-End Flow (bao gom PortfolioSummaryCard moi)

**Test:** Chay backend + frontend, dang nhap, chon portfolio, click tab "Portfolio That"
**Expected:**
- Tab Real/Paper hien thi voi styling khac biet (blue vs purple)
- CashBalanceCard hien thi tong von, kha dung, cho T+2, da deploy
- PortfolioSummaryCard moi hien thi ngay sau CashBalanceCard: tong da dau tu, lai/lo thuc hien (green/red), % loi nhuan (green/red), so vi the mo/dong
- Form nhap lenh co 6 fields (ma CK, san, loai lenh, so luong, gia khop, ngay khop) + auto-tinh phi
- Bang vi the OPEN hien thi dung, nut "Dong vi the" mo modal
- Modal dong vi the tinh P&L tu dong, submit thanh cong
- Sau khi nhap lenh hoac dong vi the, PortfolioSummaryCard tu dong refresh (fetchRealData duoc goi)
- Lich su giao dich co pagination
- Paper Trading tab van hoat dong binh thuong (khong bi anh huong)

**Why human:** Can chay full stack voi database thuc. Khong the verify UI interaction programmatically.

---

### Gaps Summary

**Khong con gap nao blocking goal achievement.**

Ca 2 gaps tu verification lan dau da duoc dong:

**Gap 1 (PORT-06 — CLOSED by Plan 08):** `realPortfolioApi.getSummary(portfolioId)` da duoc them vao `api.ts` line 693-694. `PortfolioSummaryCard.tsx` moi duoc tao voi 4 metrics. `fetchRealData` trong `PortfolioView.tsx` goi `getSummary` trong `Promise.all` va set `realSummary` state. REAL tab JSX render `PortfolioSummaryCard` sau `CashBalanceCard` khi `realSummary !== null`. Data-flow verified: frontend -> getSummary -> backend DB aggregate -> display.

**Gap 2 (Test Regression — CLOSED by Plan 07):** `vi.mock('../../services/portfolio/capitalService.js')` da duoc them vao `realOrderService.test.js` line 34 voi `deductForBuy: vi.fn().mockResolvedValue(undefined)`. Tat ca 39/39 tests pass (da xac nhan bang lenh `npx vitest run`).

---

*Verified: 2026-03-27T08:30:00Z*
*Verifier: Claude (gsd-verifier)*
