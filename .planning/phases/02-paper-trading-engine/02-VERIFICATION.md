---
phase: 02-paper-trading-engine
verified: 2026-03-27T04:30:00Z
status: gaps_found
score: 19/20 must-haves verified
re_verification: false
gaps:
  - truth: "User co the xem virtual balance rieng cho paper trading (frontend)"
    status: failed
    reason: "Frontend PaperVirtualBalance.tsx goi GET /portfolios/:portfolioId/virtual-balance nhung route nay KHONG TON TAI trong backend. PaperCapitalService.getVirtualBalance() ton tai nhung chua duoc expose qua API route."
    artifacts:
      - path: "ai-stoploss-engine-fe/services/api.ts"
        issue: "getPaperVirtualBalance goi /portfolios/:portfolioId/virtual-balance — route khong co trong portfolio.routes.js"
      - path: "ai-stoploss-engine-be/routes/portfolio.routes.js"
        issue: "Khong co route GET /:portfolioId/virtual-balance"
    missing:
      - "Them route GET /:portfolioId/virtual-balance vao portfolio.routes.js"
      - "Tao controller function getVirtualBalance trong paperPerformance.controller.js hoac portfolio.controller.js, goi PaperCapitalService.getVirtualBalance(portfolioId)"
human_verification:
  - test: "E2E Paper Trading full flow"
    expected: "Dat lenh REALISTIC MP -> order fill voi slippage > 0, virtual balance giam; dat lenh REALISTIC LO -> order PENDING, sau 30s worker fill; huy lenh -> balance refund; xem performance report"
    why_human: "Can app chay (BE + FE + DB migration) de verify end-to-end, bao gom WebSocket auto-refresh va market hours behavior"
---

# Phase 02: Paper Trading Engine — Verification Report

**Phase Goal:** User co the mo phong giao dich voi do tin cay cao — matching engine realistic, virtual balance rieng, order lifecycle day du
**Verified:** 2026-03-27T04:30:00Z
**Status:** gaps_found (1 gap)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | PaperMatchingEngine tinh slippage dung formula D-02 (base_spread * (1 + volume_impact)) | VERIFIED | paperMatchingEngine.js line 31-53: `slippagePct = baseSpread * (1 + quantity/avgDailyVolume)`, 3 liquidity tiers (HIGH/MEDIUM/LOW) |
| 2 | PaperMatchingEngine tinh fill probability cho LO orders dua tren volume ratio | VERIFIED | paperMatchingEngine.js line 54-73: 5 ratio ranges → 0.95/0.80/0.50/0.25/0.10 |
| 3 | MP fill ngay voi slippage, LO fill khi price crosses limit voi probability check | VERIFIED | fillEngine.js lines 335-338: MP → `PaperMatchingEngine.fillMarketOrder()`, LO → `tryFillLimitOrder()`; paperOrder.controller.js lines 247-260: REALISTIC MP fill ngay, LO/ATO/ATC tao PENDING |
| 4 | ATO fill tai open price, ATC fill tai close price | VERIFIED | paperMatchingEngine.js lines 156-182: `fillATOOrder` returns openPrice, `fillATCOrder` returns closePrice, slippage=0 |
| 5 | Virtual balance duoc deduct khi buy, add back khi sell, co SELECT FOR UPDATE | VERIFIED | paperCapitalService.js line 27: `SELECT paper_available_cash FROM financial.portfolios WHERE id = $1 FOR UPDATE`; fillEngine.js line 226: `deductForBuy` truoc khi tao position |
| 6 | T+2 settlement reuse addBusinessDays tu capitalService | VERIFIED | paperCapitalService.js line 12: `import { addBusinessDays } from '../portfolio/capitalService.js'`; line 54: `addBusinessDays(new Date(), 2)` |
| 7 | paper_settlement_events table rieng, khong mix voi REAL data | VERIFIED | Migration 008 line 17-29: `CREATE TABLE financial.paper_settlement_events` rieng biet; paperCapitalService.js chi dung `paper_settlement_events`, khong dung `settlement_events` |
| 8 | REALISTIC mode fill qua PaperMatchingEngine, INSTANT mode backward compatible | VERIFIED | fillEngine.js: `fillOrderRealistic` dung PaperMatchingEngine; `fillOrderInstant` giu nguyen; controller route theo `simulation_mode` |
| 9 | PaperFillWorker chay moi 30s, check PENDING PAPER orders va fill qua PaperMatchingEngine | VERIFIED | paperFillWorker.js line 19: `FILL_CRON = '*/30 * * * * *'`; lines 50-98: `checkPendingOrders()` query PAPER PENDING REALISTIC + `fillOrderRealistic` |
| 10 | Delay 1-5s cho LO fill (D-04) duoc mo phong trong worker | VERIFIED | paperFillWorker.js lines 43-45: `randomDelay(1000, 5000)`, line 89: duoc goi giua moi fill |
| 11 | Market hours guard trong worker (chi fill trong gio giao dich VN) | VERIFIED | paperFillWorker.js lines 25-38: `isWithinTradingHours()` check 9:00-11:30 va 13:00-15:00 GMT+7; line 133: guard truoc `checkPendingOrders` |
| 12 | Worker registered trong index.js voi node-cron | VERIFIED | index.js line 12: `import { startPaperFillWorker }`; line 82: `startPaperFillWorker()` |
| 13 | User co the sua limit_price va quantity cho lenh PENDING (D-09) | VERIFIED | paperOrder.controller.js line 372: `editOrder`; line 73: `editOrderSchema` chi cho phep limit_price + quantity; line 430: lot size check `quantity % 100 !== 0` |
| 14 | Khi cancel REALISTIC BUY order: refund virtual balance | VERIFIED | paperOrder.controller.js lines 348-356: `if (order.side === 'BUY' && order.simulation_mode === 'REALISTIC')` → `PaperCapitalService.refundForCancel()` |
| 15 | PATCH route cho edit PENDING orders | VERIFIED | orders.routes.js line 25: `router.patch('/:id', validate(editOrderSchema), editOrder)` |
| 16 | Performance report tinh PAPER positions (context = 'PAPER') | VERIFIED | paperPerformanceService.js lines 59, 113, 173: `AND context = 'PAPER'` trong tat ca queries |
| 17 | Report hien thi Total P&L, Win Rate, Avg Win/Loss, Profit Factor, Max Drawdown | VERIFIED | paperPerformanceService.js lines 80-95: tinh profit_factor, win_rate, avg_win, avg_loss, max_drawdown |
| 18 | Buy & Hold comparison tinh net holdings (Pitfall 7) | VERIFIED | paperPerformanceService.js lines 162-195: `SUM(CASE WHEN side='LONG' THEN quantity ELSE -quantity END) AS net_qty` ... `HAVING net_qty > 0` |
| 19 | Performance report API co filter theo tuan/thang/all | VERIFIED | paperPerformanceService.js lines 44-65: period filter 'week' (7 ngay), 'month' (30 ngay), 'all' (no filter); GET /paper-performance?period= |
| 20 | User co the xem virtual balance rieng cho paper trading | FAILED | PaperVirtualBalance.tsx goi `getPaperVirtualBalance` → `/portfolios/:portfolioId/virtual-balance` nhung route nay KHONG TON TAI trong portfolio.routes.js |

**Score: 19/20 truths verified**

---

## Required Artifacts

| Artifact | Min Lines | Actual | Status | Details |
|----------|-----------|--------|--------|---------|
| `ai-stoploss-engine-be/migrations/008_paper_virtual_balance.sql` | — | 37 lines | VERIFIED | virtual_balance, paper_available_cash, paper_pending_settlement, paper_settlement_events, 2 indexes |
| `ai-stoploss-engine-be/services/paper/paperMatchingEngine.js` | 150 | 179 lines | VERIFIED | 6 static methods: calculateSlippage, calculateFillProbability, tryFillLimitOrder, fillMarketOrder, fillATOOrder, fillATCOrder |
| `ai-stoploss-engine-be/services/paper/paperCapitalService.js` | 80 | 152 lines | VERIFIED | 5 static methods: deductForBuy (FOR UPDATE), addPendingSettlement, processSettlements, getVirtualBalance, refundForCancel |
| `ai-stoploss-engine-be/services/paper/fillEngine.js` | — | 479 lines | VERIFIED | fillOrderInstant, fillOrderRealistic, expireEndOfSessionOrders, getAvgDailyVolume |
| `ai-stoploss-engine-be/workers/paperFillWorker.js` | 60 | 153 lines | VERIFIED | startPaperFillWorker, 3 cron jobs, market hours guard, randomDelay 1-5s |
| `ai-stoploss-engine-be/controllers/paper/paperOrder.controller.js` | — | ~530 lines | VERIFIED | editOrder, editOrderSchema, refundForCancel trong cancelOrder, REALISTIC routing |
| `ai-stoploss-engine-be/routes/orders.routes.js` | — | — | VERIFIED | router.patch('/:id', validate(editOrderSchema), editOrder) |
| `ai-stoploss-engine-be/services/paper/paperPerformanceService.js` | 100 | 263 lines | VERIFIED | getPerformanceReport, getMaxDrawdown, getBuyAndHoldReturn, getFullReport |
| `ai-stoploss-engine-be/controllers/paper/paperPerformance.controller.js` | — | — | VERIFIED | getPerformanceReport, performanceQuerySchema, goi PaperPerformanceService.getFullReport |
| `ai-stoploss-engine-fe/services/api.ts` | — | — | PARTIAL | editPaperOrder, getPaperPerformance co va wired dung; getPaperVirtualBalance goi endpoint khong ton tai |
| `ai-stoploss-engine-fe/components/PaperPerformanceReport.tsx` | 80 | 266 lines | VERIFIED | win_rate, profit_factor, buy_hold display, period selector, BarChart recharts |
| `ai-stoploss-engine-fe/components/PaperOrderManager.tsx` | 60 | 301 lines | VERIFIED | PENDING order list, edit modal, confirm cancel, editPaperOrder wired |
| `ai-stoploss-engine-fe/components/PaperVirtualBalance.tsx` | 40 | 144 lines | HOLLOW — wired but data disconnected | Component exists, goi getPaperVirtualBalance, nhung BE endpoint `/virtual-balance` khong ton tai |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| paperMatchingEngine.js | tickSizeEngine.js | snapToTickSize | WIRED | Line 20: `import { snapToTickSize, validatePriceInBand }` |
| paperCapitalService.js | capitalService.js | addBusinessDays | WIRED | Line 12: `import { addBusinessDays }` |
| fillEngine.js | paperMatchingEngine.js | PaperMatchingEngine | WIRED | Line 27: `import PaperMatchingEngine` |
| fillEngine.js | paperCapitalService.js | deductForBuy | WIRED | Line 28: `import PaperCapitalService`; line 226: `deductForBuy()` |
| paperFillWorker.js | fillEngine.js | fillOrderRealistic | WIRED | Line 16: `import { fillOrderRealistic, expireEndOfSessionOrders }` |
| index.js | paperFillWorker.js | startPaperFillWorker | WIRED | Line 12 import, line 82 call |
| orders.routes.js | paperOrder.controller.js | PATCH /:id | WIRED | Line 25: `router.patch('/:id', validate(editOrderSchema), editOrder)` |
| paperOrder.controller.js | paperCapitalService.js | refundForCancel | WIRED | Lines 348-356: refund khi cancel REALISTIC BUY |
| paperPerformance.controller.js | paperPerformanceService.js | PaperPerformanceService | WIRED | Line 14: import; line 48: `getFullReport()` |
| portfolio.routes.js | paperPerformance.controller.js | GET /paper-performance | WIRED | Lines 54-56: `router.get('/:portfolioId/paper-performance', ...)` |
| PortfolioView.tsx | PaperPerformanceReport.tsx | render in Paper tab | WIRED | Line 793: `<PaperPerformanceReport portfolioId={portfolioId} />` |
| PortfolioView.tsx | PaperVirtualBalance.tsx | render in Paper tab | WIRED (component render) | Line 402: `<PaperVirtualBalance portfolioId={portfolioId} />` |
| api.ts | backend `/virtual-balance` | getPaperVirtualBalance | NOT WIRED | Frontend goi `/portfolios/:portfolioId/virtual-balance` nhung route khong ton tai trong portfolio.routes.js |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| PaperPerformanceReport.tsx | `data` (PaperPerformanceData) | `orderApi.getPaperPerformance()` → GET /paper-performance → `PaperPerformanceService.getFullReport()` → real DB query `FROM financial.positions WHERE context = 'PAPER'` | Yes | FLOWING |
| PaperOrderManager.tsx | `orders` prop | Filtered tu parent PortfolioView, fetch tu existing order API | Yes | FLOWING |
| PaperVirtualBalance.tsx | `balance` (VirtualBalance) | `orderApi.getPaperVirtualBalance()` → `/virtual-balance` → route KHONG TON TAI | No | DISCONNECTED |
| paperPerformanceService.js | positions data | `query(sql, [portfolioId])` → real DB queries | Yes | FLOWING |
| paperCapitalService.js | paper balance | `query(SELECT FOR UPDATE ...)` → real DB | Yes | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Check | Status |
|----------|-------|--------|
| paperMatchingEngine.js exports key functions | `grep -q "calculateSlippage\|fillMarketOrder" paperMatchingEngine.js` | PASS |
| paperCapitalService.js has SELECT FOR UPDATE | `grep -q "FOR UPDATE" paperCapitalService.js` | PASS |
| paperFillWorker.js registered in index.js | `grep -q "startPaperFillWorker" index.js` | PASS |
| PATCH /orders/:id route exists | `grep -q "router.patch" orders.routes.js` | PASS |
| Performance route registered | `grep -q "paper-performance" portfolio.routes.js` | PASS |
| Virtual-balance route missing | `grep -q "virtual-balance" portfolio.routes.js` | FAIL — route khong ton tai |
| Unit tests exist (paper) | 6 test files: paperMatchingEngine, paperCapitalService, paperFillEngine, paperOrderManagement, paperPerformance, paperOrderService | PASS |
| TypeScript compile check | `npx tsc --noEmit` mentioned as PASS in 02-05-SUMMARY | PASS (per summary) |

Step 7b: Backend is runnable but requires live DB connection — full test execution skipped. Test file existence verified manually.

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| PAPER-01 | 02-01, 02-02, 02-05 | Dat lenh mo phong (MP, LO, ATO, ATC) voi virtual balance rieng | SATISFIED | fillEngine.js: fillOrderInstant + fillOrderRealistic; paperOrder.controller.js: createOrder routing |
| PAPER-02 | 02-01, 02-02, 02-05 | Matching engine realistic: slippage, xac suat khop, delay | SATISFIED | PaperMatchingEngine: calculateSlippage, calculateFillProbability, tryFillLimitOrder; paperFillWorker: randomDelay 1-5s |
| PAPER-03 | 02-01, 02-02, 02-05 | Virtual cash balance rieng, khong anh huong portfolio that | SATISFIED | paper_available_cash, paper_pending_settlement columns rieng trong portfolios; paper_settlement_events table rieng; PARTIAL — frontend component bi disconnected (virtual-balance route missing) |
| PAPER-04 | 02-03, 02-05 | Quan ly lenh pending: sua/huy | SATISFIED | PATCH /:id endpoint, editOrder controller, lot size validation, tick size snap, refundForCancel |
| PAPER-05 | 02-01, 02-02 | T+2 settlement cho paper trading | SATISFIED | addBusinessDays(new Date(), 2), paper_settlement_events, processSettlements cron 09:00 Mon-Fri |
| PAPER-06 | 02-04, 02-05 | Performance report rieng (P&L, win rate, so sanh buy-hold) | SATISFIED | PaperPerformanceService.getFullReport, GET /paper-performance, PaperPerformanceReport.tsx |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `paperOrder.controller.js` | 520-526 | `isExistingLongToSell` helper placeholder — always returns `true` | Info | Khong anh huong core paper trading goal. Check SELL short nay bi bypass nhung `isDerivativeSymbol` guard o line 119 van chay dung de chong short selling co phieu co so. |
| `PaperOrderManager.tsx`, `PortfolioView.tsx` | multiple | `placeholder="..."` in form inputs | Info | Day la HTML input placeholder attribute (UI hint text), KHONG phai code stub. |

---

## Human Verification Required

### 1. E2E Paper Trading Flow

**Test:** Start BE + FE + chay migration 008. Vao Paper Trading tab:
1. Check virtual balance hien thi 1,000,000,000 VND (sau khi fix virtual-balance route)
2. Dat lenh BUY MP (REALISTIC) → xac nhan order filled voi slippage > 0 trong response
3. Dat lenh BUY LO (REALISTIC) → xac nhan order PENDING, doi 30s worker fill
4. Sua limit_price lenh PENDING → confirm updated
5. Huy lenh PENDING (REALISTIC BUY) → confirm cancelled, virtual balance duoc refund
6. Xem Performance Report → confirm metrics hien thi dung (hoac "Chua co giao dich")

**Expected:** Tat ca flows hoat dong; virtual balance card hien thi 4 metrics sau khi fix gap
**Why human:** Can app chay voi live DB, market hours, WebSocket events de test end-to-end

---

## Gaps Summary

**1 gap blocking full goal achievement:**

Gap: Frontend `PaperVirtualBalance.tsx` goi `GET /portfolios/:portfolioId/virtual-balance` nhung route nay khong duoc tao trong backend. File `portfolio.routes.js` chi co `/paper-performance` route duoc them trong phase 02, KHONG co `/virtual-balance`.

Backend co day du logic: `PaperCapitalService.getVirtualBalance()` ton tai va dung, tra ve `{ virtual_balance, paper_available_cash, paper_pending_settlement, paper_deployed }`. Chi thieu 1 controller function va 1 route line de wire.

**Requirement impact:** PAPER-03 (Virtual cash balance rieng) bi PARTIAL — backend logic dung nhung user KHONG THE XEM virtual balance tren frontend vi API call that bai 404.

Tat ca 5 requirements con lai (PAPER-01, PAPER-02, PAPER-04, PAPER-05, PAPER-06) duoc SATISFIED day du o ca backend lan frontend.

---

_Verified: 2026-03-27T04:30:00Z_
_Verifier: Claude (gsd-verifier)_
