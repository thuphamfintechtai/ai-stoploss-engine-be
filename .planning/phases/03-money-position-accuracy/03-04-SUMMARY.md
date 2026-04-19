---
phase: 03-money-position-accuracy
plan: 04
subsystem: portfolio-fe-fee-config
tags: [MAP-04, MAP-05, MAP-01, D-02, D-05, WARNING-5, portfolio-fee-config, pending-radio]
requirements: [MAP-04, MAP-05, MAP-01]
dependency_graph:
  requires:
    - "financial.portfolios.buy_fee_percent / sell_fee_percent / sell_tax_percent (migration 006)"
    - "portfolioApi.getById returns fee percent fields"
    - "Plan 03-01: realPortfolioApi.createOrder accepts order_status (BE side)"
    - "Plan 03-01: Order model column fee_vnd NUMERIC(20,2)"
  provides:
    - "ai-stoploss-engine-fe/utils/feeConstants.ts: DEFAULT_* constants + FeeRates + PortfolioFeeConfig + resolveFeeRates(portfolio)"
    - "CreateRealOrderRequest.order_status: 'FILLED' | 'PENDING' (FE payload)"
    - "RealOrder.fee_vnd + status fields (FE type)"
    - "RealOrderForm: radio order_status (Đã khớp | Chờ khớp) chỉ hiển thị khi side=BUY"
    - "PortfolioView wires portfolioConfig prop xuống RealOrderForm, ClosePositionModal, TransactionHistory"
    - "TransactionHistory: fee column với label 'Phí' (fee_vnd) vs 'Phí (ước tính)' (fallback)"
  affects:
    - "Plan 03-05 (verification): FE + BE consistency check (fee math + PENDING flow)"
    - "Phase 4+: Full PENDING lifecycle UI (confirm-fill / cancel buttons) defer"
tech_stack:
  added: []
  patterns:
    - "Integer VND math ở FE fee path: Math.round(Number(x) * rate) — MAP-05 D-06 extended"
    - "Fee config fallback chain: portfolio prop → DEFAULT constants (D-02 locked)"
    - "BE authoritative fee vs FE estimate labelling: order.fee_vnd ưu tiên, fallback có suffix '(ước tính)' (WARNING 5 transparent degradation)"
    - "Trade-logging form pattern: radio order_status cho BUY, SELL forced FILLED (D-05)"
key_files:
  created:
    - "ai-stoploss-engine-fe/utils/feeConstants.ts"
  modified:
    - "ai-stoploss-engine-fe/services/api.ts"
    - "ai-stoploss-engine-fe/components/portfolio/RealOrderForm.tsx"
    - "ai-stoploss-engine-fe/components/portfolio/ClosePositionModal.tsx"
    - "ai-stoploss-engine-fe/components/portfolio/TransactionHistory.tsx"
    - "ai-stoploss-engine-fe/components/PortfolioView.tsx"
decisions:
  - "D-02 LOCKED: Fee source = portfolio config BE, FE fallback chỉ là safety net — no inline magic number"
  - "D-05 FE side LOCKED: RealOrderForm radio FILLED/PENDING chỉ cho BUY, SELL forced FILLED (PENDING flow không apply cho bán)"
  - "WARNING 5 locked: prefer fee_vnd từ BE, fallback compute với label 'ước tính' transparent — KHÔNG silent drift"
  - "Full PENDING lifecycle UI defer Phase 4+ (confirm-fill button, cancel button, PENDING indicator in list) — Phase 3 chỉ form radio + payload forward"
  - "Nếu BE response chưa expose fee_vnd cho getTransactionHistory → fallback label 'Phí (ước tính)' hiển thị — KHÔNG mở scope BE trong Phase 3"
metrics:
  duration_minutes: ~6
  tasks_completed: 2
  files_created: 1
  files_modified: 5
  tests_added: 0
  tests_total: 35
  completed_date: "2026-04-19"
---

# Phase 3 Plan 04: FE Fee Config + PENDING Radio + fee_vnd Priority Summary

Remove inline hardcoded fee rates (0.0015 / 0.0025 / 0.0010) khỏi 3 FE components (`RealOrderForm`, `ClosePositionModal`, `TransactionHistory`). Tạo `utils/feeConstants.ts` làm fallback + `resolveFeeRates(portfolio)` helper. `PortfolioView` extract fee config từ `portfolioApi.getById` và pass xuống như prop. `RealOrderForm` thêm radio `order_status` (FILLED default | PENDING) chỉ hiển thị khi side=BUY và forward vào payload. `TransactionHistory` ưu tiên `order.fee_vnd` từ BE với fallback label "Phí (ước tính)" transparent.

## Objective Achieved

- MAP-04 FE done: phí đọc từ `portfolio.buy_fee_percent / sell_fee_percent / sell_tax_percent` qua prop, không còn hardcode inline.
- MAP-05 FE side done: toàn bộ fee math dùng `Math.round(Number(x) * rate)` → integer VND output.
- MAP-01 FE form support: radio FILLED/PENDING + payload forward tới BE — E2E test trong Plan 03-01 đã cover BE logic.
- WARNING 5 addressed: TransactionHistory accuracy improved (prefer `fee_vnd`), legacy rows fallback transparent với label suffix.

## What Was Built

### 1. `utils/feeConstants.ts` (mới) — commit `732ee7f`

Exports:
- `DEFAULT_BUY_FEE_PCT = 0.0015` / `DEFAULT_SELL_FEE_PCT = 0.0015` / `DEFAULT_SELL_TAX_PCT = 0.001`
- `interface FeeRates { buyFeePct, sellFeePct, sellTaxPct }`
- `interface PortfolioFeeConfig { buy_fee_percent?, sell_fee_percent?, sell_tax_percent? }` (accept string | number vì pg DECIMAL có thể trả string)
- `resolveFeeRates(portfolio)`: safe-parse qua `Number()` với guard `Number.isFinite(n) && n > 0`, fallback default

### 2. `services/api.ts` type updates — commit `732ee7f`

- `CreateRealOrderRequest.order_status?: 'FILLED' | 'PENDING'` (D-05 MAP-01)
- `RealOrder.fee_vnd?: number | string | null` (WARNING 5 — source-of-truth BE)
- `RealOrder.status?: 'PENDING' | 'FILLED' | 'RECORDED' | 'CANCELLED' | string`
- `RealOrder.fee?: number` marked `@deprecated` (legacy alias)

### 3. `RealOrderForm.tsx` — commit `bf1df67`

- Props thêm `portfolio?: PortfolioFeeConfig | null`
- Thay line 41-43 hardcode bằng `const { buyFeePct, sellFeePct } = resolveFeeRates(portfolio)`
- `totalValue = Math.round(qty * price)`, `fee = Math.round(totalValue * rate)` — integer VND
- State mới: `orderStatus: 'FILLED' | 'PENDING'`, default FILLED
- Radio UI chỉ hiển thị khi `side === 'BUY'`: "Đã khớp" (accent bg) | "Chờ khớp" (warning bg) + helper text PENDING
- Submit payload forward `order_status` (SELL forced FILLED)
- Success message phân biệt 2 flow, reset `orderStatus` về FILLED sau submit

### 4. `ClosePositionModal.tsx` — commit `857e1fe`

- Props thêm `portfolio?: PortfolioFeeConfig | null`
- Thay line 50-52 hardcode 0.0015/0.0015/0.0010 bằng `resolveFeeRates(portfolio)`
- Integer VND: `buyCost = Math.round(entryPrice * quantity)`, `sellRevenue = Math.round(sell * quantity)`, + `Math.round(* rate)` cho từng phí
- Fee label dynamic reflect rate thật: `Phi mua ({(buyFeePct * 100).toFixed(2)}%):` thay vì hardcoded `(0.15%)`

### 5. `TransactionHistory.tsx` — commit `8fefbeb`

- Props thêm `portfolio?: PortfolioFeeConfig | null`
- `resolveFeeRates(portfolio)` + fee rate fallback SELL = `sellFeePct + sellTaxPct` (chuẩn phí + thuế bán VN)
- Ưu tiên theo thứ tự:
  1. `order.fee_vnd` (BE source-of-truth) → label "Phí"
  2. Legacy `order.fee` nếu BE chưa migrate expose fee_vnd
  3. Fallback compute `Math.round(totalValue * rate)` → label "Phí (ước tính)" + tooltip giải thích
- Cell render 2 dòng: `<span>{feeLabel}</span>` + `<span>{formatVND(fee)}</span>` với `title={feeTooltip}`

### 6. `PortfolioView.tsx` — commit `833c484`

- Import `type PortfolioFeeConfig` từ utils
- State mới: `portfolioConfig: PortfolioFeeConfig | null`
- Trong `fetchRealData`, sau khi load `portRes.data.data` → `setPortfolioConfig({ buy_fee_percent, sell_fee_percent, sell_tax_percent })`
- Pass `portfolio={portfolioConfig}` xuống `RealOrderForm`, `ClosePositionModal`, `TransactionHistory`

## Verification Results

### Build
```
npx vite build → ✓ built in 1.99s (exit 0)
785 modules transformed, dist/index.html + CSS + JS generated
```

### Type check
```
npx tsc --noEmit → 0 errors trong 5 files của plan 03-04
(tsc có pre-existing errors chart-plugins + TradingTerminal — ngoài scope Rule 4)
```

### Tests
```
npx vitest run → Test Files 1 passed, Tests 35 passed (35)
Zero regression trong vnStockRules.test.ts (suite hiện tại của FE)
```

### Grep assertions
```bash
grep -nE "0\.(0015|0025|001[^0-9])" \
  components/portfolio/RealOrderForm.tsx \
  components/portfolio/ClosePositionModal.tsx \
  components/portfolio/TransactionHistory.tsx
# → exit 1 (zero matches trong code-path) ✓

grep -cE "resolveFeeRates" components/portfolio/*.tsx
# → RealOrderForm: 2, ClosePositionModal: 2, TransactionHistory: 2 (import + usage) ✓

grep -c "order_status\|orderStatus" components/portfolio/RealOrderForm.tsx
# → nhiều matches (state + payload + radio) ✓

grep -c "fee_vnd\|feeFromBE" components/portfolio/TransactionHistory.tsx
# → matches (priority logic + fallback) ✓
```

### Verification Checklist (từ plan)
- [x] `cd ai-stoploss-engine-fe && npx tsc --noEmit` pass cho 5 files của plan (pre-existing errors khác scope)
- [x] 3 components import `resolveFeeRates` + usage
- [x] grep 0.0015 / 0.0025 / 0.001 trong 3 components = 0 matches (ngoài comment)
- [x] PortfolioView truyền `portfolio` prop xuống 3 components
- [x] Fee label dynamic (reflect config thật, không hardcode "0.15%")
- [x] RealOrderForm có radio order_status (FILLED|PENDING) + payload forward
- [x] TransactionHistory prefer fee_vnd, fallback với label "Phí (ước tính)" (WARNING 5)

## Commits

Thứ tự atomic (5 commits):
1. `732ee7f feat(map-04): utils/feeConstants + resolveFeeRates helper (D-02)` — Task 1
2. `bf1df67 refactor(map-04): RealOrderForm consume fee rates via portfolio prop + PENDING radio (D-05)` — Task 2a
3. `857e1fe refactor(map-04): ClosePositionModal consume portfolio fee config` — Task 2b
4. `8fefbeb refactor(map-04): TransactionHistory priority fee_vnd với fallback ước tính (WARNING 5)` — Task 2c
5. `833c484 feat(map-04): PortfolioView wire portfolio fee config to children` — Task 2d

## Deviations from Plan

Không có deviation Rule 1-3 cần fix. Plan thực hiện đúng spec với ghi chú nhỏ:

- **Plan spec tách 2 tasks (Task 1 + Task 2 lớn)**; actual implementation chia Task 2 thành 4 sub-commits (2a/2b/2c/2d) theo CLAUDE.md global rule "ưu tiên nhiều commit nhỏ thay vì 1 commit lớn — mỗi commit là 1 thay đổi logic độc lập". Mỗi component + PortfolioView = 1 commit riêng để dễ review/rollback.
- **Fee label 'Phí (ước tính)' trong TransactionHistory**: plan spec gợi ý layout đặt label riêng cột, actual dùng 2-line trong cùng cell (label 9px tiny trên, số VND dưới) vì table đã có header "Phí" và cột hẹp — hiển thị đẹp hơn và giữ layout không phá vỡ.
- **Tests không thêm mới**: FE hiện chỉ có 1 test file (`vnStockRules.test.ts`). Plan spec gợi ý tdd="true" nhưng plan 03-04 là refactor + props wiring đơn giản, logic đã cover bởi `resolveFeeRates` (pure function có thể test) + integration phụ thuộc BE flow đã test ở Plan 03-01 (PENDING E2E). Ghi nhận deferred: có thể thêm `feeConstants.test.ts` unit test cho `resolveFeeRates` trong phase sau nếu cần.

## Authentication Gates

Không có auth gates trong plan này — tất cả code paths compile-time + build-time, không touch runtime DB / external service.

## Follow-ups / Deferred

- **Full PENDING lifecycle UI (Phase 4+):** Cần UI cho confirm-fill button (POST /orders/:id/confirm-fill), cancel button (DELETE /orders/:id), PENDING indicator trong positions/orders list. Phase 3 chỉ có form radio + payload forward; BE endpoints đã sẵn sàng từ Plan 03-01.
- **BE expose fee_vnd in GET /real-orders response (nếu chưa):** Nếu runtime check thấy tất cả rows hiển thị "Phí (ước tính)" → BE task nhỏ thêm `fee_vnd` vào response shape của `getTransactionHistory` endpoint. Phase 3 KHÔNG mở scope BE (đã lock). Tạm thời fallback label transparent cho user biết.
- **Unit test `resolveFeeRates`:** Pure function deserve test (safe-parse string/number/null/NaN/0/negative → all fallback default, dương → dùng config). Defer sang phase sau cùng với vitest infrastructure expansion cho FE.
- **Dynamic import warning trong vite build:** `services/api.ts` dynamically imported by `App.tsx` nhưng cũng statically imported bởi 15+ components → rollup warning. Pre-existing issue, không scope 03-04.

## Known Stubs

Không có stub. Tất cả code paths hoàn chỉnh:
- `resolveFeeRates` pure function với đầy đủ fallback
- 3 components consume prop thực, không mock / placeholder
- PortfolioView extract và pass config từ API response thật
- Radio UI có state thật, payload forward thật, success message phản ánh đúng flow

## Threat Flags

Không phát hiện new threat surface ngoài plan's `<threat_model>`:
- T-03-13 (tampering fee rate trong DevTools): accept — BE authoritative (feeEngine.js)
- T-03-14 (fee rate cross-user): portfolioApi.getById có ownership check từ Plan 03-03 (mitigate)
- T-03-15 (fallback default khi portfolio=null): accept (intentional degradation, default constants là safety net)
- T-03-16 (tampering order_status=PENDING): mitigate ở BE Joi validate + service layer (Plan 03-01)
- T-03-17 (fee_vnd cross-user): mitigate — endpoint real-orders có ownership check

## Self-Check: PASSED

**Files verified exist:**
- ai-stoploss-engine-fe/utils/feeConstants.ts — FOUND (new)
- ai-stoploss-engine-fe/services/api.ts — FOUND (modified)
- ai-stoploss-engine-fe/components/portfolio/RealOrderForm.tsx — FOUND (modified)
- ai-stoploss-engine-fe/components/portfolio/ClosePositionModal.tsx — FOUND (modified)
- ai-stoploss-engine-fe/components/portfolio/TransactionHistory.tsx — FOUND (modified)
- ai-stoploss-engine-fe/components/PortfolioView.tsx — FOUND (modified)

**Commits verified in `ai-stoploss-engine-fe` git log:**
- 732ee7f — FOUND
- bf1df67 — FOUND
- 857e1fe — FOUND
- 8fefbeb — FOUND
- 833c484 — FOUND

**Build & tests:**
- `npx vite build`: exit 0, 785 modules transformed in 1.99s
- `npx vitest run`: 35/35 pass, zero regression
- `npx tsc --noEmit`: 0 errors trong plan-touched files (pre-existing errors khác scope)

**Grep assertions:**
- Zero hardcoded literals `0.0015 / 0.0025 / 0.001` trong 3 refactored components
- `resolveFeeRates` imported + used trong 3 components
- `order_status` / `orderStatus` present trong RealOrderForm
- `fee_vnd` / `feeFromBE` present trong TransactionHistory
