# Phase 2: Paper Trading Engine - Context

**Gathered:** 2026-03-27
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous)

<domain>
## Phase Boundary

Nâng cấp Paper Trading module thành hệ thống mô phỏng giao dịch realistic. Bao gồm: matching engine với slippage + xác suất khớp dựa volume, virtual cash balance riêng với T+2 settlement, order lifecycle đầy đủ (pending → filled/cancelled/expired), và paper trading performance report.

</domain>

<decisions>
## Implementation Decisions

### Matching Engine
- **D-01:** Custom PaperMatchingEngine xây riêng (~300-500 dòng) — không dùng npm package vì không có lib nào hỗ trợ quy tắc sàn VN (tick size, biên độ, ATO/ATC session)
- **D-02:** Slippage model: slippage = base_spread × (1 + volume_impact). Base spread = 0.1-0.3% tùy thanh khoản cổ phiếu. Volume impact = order_qty / avg_daily_volume
- **D-03:** Xác suất khớp: LO khớp khi market_price crosses limit_price × fill_probability (dựa trên volume). MP fill ngay với slippage. ATO/ATC fill tại giá mở/đóng cửa
- **D-04:** Delay khớp lệnh: 1-5 giây random cho LO (mô phỏng queue), MP khớp ngay sau slippage calc

### Virtual Cash Balance
- **D-05:** Virtual balance field riêng trên portfolio table (virtual_balance, paper_available_cash, paper_pending_settlement)
- **D-06:** T+2 settlement tái sử dụng logic từ CapitalService Phase 1 (addBusinessDays, VN holidays)
- **D-07:** Mỗi portfolio có virtual_balance default 1,000,000,000 VND (1 tỷ) cho paper trading

### Order Lifecycle
- **D-08:** PENDING → FILLED (match success) | PARTIALLY_FILLED | CANCELLED (user cancel) | EXPIRED (end of session)
- **D-09:** User có thể sửa limit price và quantity cho lệnh PENDING. Không sửa side hay symbol
- **D-10:** Lệnh ATO expire nếu không khớp trong phiên mở cửa. ATC expire nếu không khớp trong phiên đóng cửa

### Performance Report
- **D-11:** Report hiển thị: Total P&L, Win Rate, Average Win/Loss, Profit Factor, Max Drawdown
- **D-12:** So sánh với Buy & Hold: tính return nếu user giữ tất cả cổ phiếu đã mua từ đầu
- **D-13:** Kỳ báo cáo: tổng cộng + filter theo tuần/tháng

### Claude's Discretion
- Cách tổ chức code matching engine (class vs functional)
- Worker pattern cho periodic fill check (cron interval)
- UI layout cho performance report (chart types, table format)
- Error handling cho edge cases (market halt, price band lock)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research
- `.planning/research/ARCHITECTURE.md` — Paper Trading Context bounded context design
- `.planning/research/FEATURES.md` — Paper trading feature requirements, table stakes
- `.planning/research/PITFALLS.md` — Instant fill pitfall, T+2 settlement, slippage model
- `.planning/research/STACK.md` — Custom PaperMatchingEngine recommendation

### Codebase (from Phase 1)
- `.planning/codebase/ARCHITECTURE.md` — Current system architecture
- `.planning/codebase/STRUCTURE.md` — Directory layout
- `.planning/codebase/CONVENTIONS.md` — Code style

### Key Source Files
- `ai-stoploss-engine-be/services/paper/fillEngine.js` — Current paper fill engine (to replace/upgrade)
- `ai-stoploss-engine-be/services/paper/paperOrderService.js` — Current paper order service
- `ai-stoploss-engine-be/controllers/paper/paperOrder.controller.js` — Paper order controller
- `ai-stoploss-engine-be/services/shared/slippageCalculator.js` — Existing slippage calculator (to integrate)
- `ai-stoploss-engine-be/services/portfolio/capitalService.js` — T+2 settlement logic (to reuse pattern)
- `ai-stoploss-engine-be/workers/stopLossMonitor.js` — Existing worker pattern

### Phase 1 Artifacts
- `.planning/phases/01-foundation-portfolio-management/01-CONTEXT.md` — Context separation decisions (REAL/PAPER)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `slippageCalculator.js` (shared kernel) — Already has slippage calculation, needs integration into matching engine
- `capitalService.js` — T+2 settlement pattern with VN holidays, reuse for paper virtual balance
- `fillEngine.js` (paper/) — Current paper fill engine, base for upgrade
- `vnStockRules.ts` / `tickSizeEngine` — Exchange rules validation
- `feeEngine.js` — Fee calculation for paper trades

### Established Patterns
- Context column 'PAPER' on orders/positions (from Phase 1)
- Service → Controller → Routes layered architecture
- Vitest for testing with db mock helpers
- Workers registered in index.js with node-cron

### Integration Points
- Paper order routes already exist (`/api/portfolios/:id/orders`)
- WebSocket for real-time order status updates
- PortfolioView.tsx has Paper Trading tab (from Phase 1)
- stopLossMonitor worker has PAPER context filter

</code_context>

<specifics>
## Specific Ideas

- User muốn paper trading mô phỏng ĐẶT LỆNH TRÊN SÀN thật — không chỉ click buy/sell instant
- Cần có cảm giác "chờ lệnh khớp" — delay realistic, không phải instant 100%
- slippageCalculator.js đã có sẵn nhưng chưa được integrate vào fill flow

</specifics>

<deferred>
## Deferred Ideas

- Full orderbook simulation (bid/ask spread đầy đủ) — quá complex cho v1, basic slippage đủ
- Partial fill simulation — defer, chỉ full fill hoặc no fill cho v1
- Multi-day backtesting — separate feature, not paper trading

</deferred>

---

*Phase: 02-paper-trading-engine*
*Context gathered: 2026-03-27 via smart discuss (autonomous)*
