# Phase 1: Foundation & Portfolio Management - Context

**Gathered:** 2026-03-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Tách hoàn toàn Portfolio Management (real order tracking) khỏi Paper Trading (simulation) trong cả backend và frontend. Xây dựng flow nhập lệnh thật, quản lý cash balance với T+2 settlement, và đóng vị thế thủ công. Paper Trading vẫn phải hoạt động bình thường sau refactor.

</domain>

<decisions>
## Implementation Decisions

### Context Separation Strategy
- **D-01:** Thêm cột `context VARCHAR(20) CHECK (IN 'REAL', 'PAPER')` vào bảng orders và positions hiện tại — không tạo bảng mới. Migration nhẹ, ít breaking change.
- **D-02:** Tạo controllers riêng: RealOrderController, RealPositionController (portfolio) vs PaperOrderController, PaperPositionController (simulation). Shared logic (fees, tick size, risk) nằm trong Shared Kernel.
- **D-03:** fillEngine KHÔNG ĐƯỢC chạy cho context='REAL'. Lệnh thật chỉ ghi nhận, không giả lập khớp.

### Real Order Entry UX
- **D-04:** Form nhập lệnh thật đơn giản: mã CK, exchange, side (MUA/BÁN), số lượng, giá khớp thực tế, ngày khớp. Không có order type (LO/MP/ATO) vì lệnh đã khớp rồi.
- **D-05:** Phí tự động tính theo exchange rules (0.15% mua, 0.15% bán + 0.1% thuế bán). User không cần nhập phí.
- **D-06:** Khi nhập lệnh MUA → tạo position OPEN ngay. Khi nhập lệnh BÁN → đóng position tương ứng.

### Cash Balance Model
- **D-07:** Thêm fields vào portfolio: `total_balance`, `available_cash`, `pending_settlement_cash`.
- **D-08:** T+2 settlement: khi bán, tiền vào `pending_settlement_cash`. Sau 2 ngày làm việc, tự chuyển sang `available_cash`.
- **D-09:** Khi mua, trừ `available_cash` ngay. Không cho mua nếu `available_cash` không đủ.

### Position Close Flow
- **D-10:** User nhấn "Đóng vị thế" → nhập giá bán thực tế + ngày bán → hệ thống tính realized P&L (bao gồm phí + thuế VN).
- **D-11:** Position status chuyển sang CLOSED_MANUAL. Giữ nguyên các status khác (CLOSED_SL, CLOSED_TP) cho paper trading.

### Claude's Discretion
- Cách tổ chức directory structure cho controllers mới (có thể tạo subfolder hoặc prefix)
- Loading skeleton/states cho form nhập lệnh
- Error message format cho validation errors

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & Codebase
- `.planning/codebase/ARCHITECTURE.md` — Kiến trúc hiện tại, layers, data flow
- `.planning/codebase/STRUCTURE.md` — Directory layout, key locations
- `.planning/codebase/CONVENTIONS.md` — Code patterns, naming conventions
- `.planning/codebase/STACK.md` — Tech stack hiện tại

### Research
- `.planning/research/ARCHITECTURE.md` — Bounded Context separation strategy, DB migration approach
- `.planning/research/FEATURES.md` — Portfolio vs Paper Trading feature breakdown
- `.planning/research/PITFALLS.md` — Order/Position identity crisis, T+2 settlement pitfall
- `.planning/research/SUMMARY.md` — Tổng hợp research findings

### Key Source Files (existing code to refactor)
- `ai-stoploss-engine-be/controllers/order.controller.js` — Current order controller (needs split)
- `ai-stoploss-engine-be/controllers/position.controller.js` — Current position controller (needs split)
- `ai-stoploss-engine-be/services/fillEngine.js` — Fill simulation (must NOT run for REAL context)
- `ai-stoploss-engine-be/services/riskCalculator.js` — Risk calc (shared kernel)
- `ai-stoploss-engine-be/services/feeEngine.js` — Fee calculation (shared kernel, if exists)
- `ai-stoploss-engine-fe/components/TradingTerminal.tsx` — Current order form (needs REAL variant)
- `ai-stoploss-engine-fe/components/PortfolioView.tsx` — Portfolio display (needs context filter)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `feeEngine.js` / fee calculation: Đã tính đúng phí VN (0.15% + 0.1% thuế) — tái sử dụng cho cả REAL và PAPER
- `tickSizeEngine` / `vnStockRules.ts`: Validation giá theo quy tắc sàn — shared kernel
- `riskCalculator.js`: Risk per position — shared kernel
- `PortfolioView.tsx`: UI portfolio hiện tại — cần thêm tab/filter cho REAL vs PAPER
- WebSocket infrastructure: Real-time updates — tái sử dụng

### Established Patterns
- Layered architecture: routes → controllers → services → models
- PostgreSQL with migration files (numbered 001, 002,...)
- JWT auth middleware
- Express error handling middleware

### Integration Points
- Routes: Thêm `/api/portfolios/:id/real-orders` (new) hoặc modify existing `/orders` với context param
- Frontend: Sidebar navigation — thêm entry point riêng cho Portfolio vs Paper Trading
- WebSocket: Position updates cần filter theo context
- Database: Migration thêm `context` column + `settlement_date` + cash balance fields

</code_context>

<specifics>
## Specific Ideas

- User muốn form nhập lệnh thật ĐƠN GIẢN — không phức tạp như terminal đặt lệnh mô phỏng
- Portfolio tracking là ghi nhận dòng tiền, không phải simulator
- Paper Trading phải giữ nguyên hoạt động — không break existing flow

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-foundation-portfolio-management*
*Context gathered: 2026-03-26*
