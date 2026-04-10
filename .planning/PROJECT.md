# TradeGuard AI — Hệ thống Dừng Lỗ & Chốt Lợi Nhuận Tăng Cường AI

## What This Is

Ứng dụng web hỗ trợ nhà đầu tư chứng khoán Việt Nam quản lý rủi ro giao dịch thông qua AI. Hệ thống gồm 2 module chính: (1) Portfolio Management — quản lý dòng tiền, phân bổ vốn, theo dõi lệnh thật đã đặt trên sàn, và (2) Paper Trading — mô phỏng đặt lệnh trên sàn giao dịch để tập chơi chứng khoán. Tích hợp AI (Google Gemini + rule-based) để tư vấn stop loss, take profit, cảnh báo rủi ro và hỗ trợ ra quyết định.

## Core Value

Giúp nhà đầu tư quản lý rủi ro thông minh — biết khi nào cắt lỗ, khi nào chốt lời, với AI hỗ trợ phân tích thay vì quyết định cảm tính.

## Requirements

### Validated

- ✓ Auth (đăng ký/đăng nhập JWT) — existing
- ✓ Dashboard thị trường (VNINDEX, VN30, tin tức) — existing
- ✓ Watchlist theo dõi mã CK — existing
- ✓ Risk Manager (đo risk portfolio, vị thế) — existing
- ✓ AI suggest SL/TP (ATR-based, 3 levels) — existing
- ✓ Market regime detection (Gemini) — existing
- ✓ Position review AI — existing
- ✓ WebSocket real-time updates — existing
- ✓ VPBS API integration (giá thời gian thực) — existing

### Active

- [ ] Tách rõ Portfolio Management vs Paper Trading — 2 flow riêng biệt
- [ ] Portfolio: Form nhập lệnh thật (ghi nhận, không giả lập khớp)
- [ ] Portfolio: Quản lý dòng tiền, phân bổ vốn
- [ ] Portfolio: AI tư vấn phân bổ vốn
- [ ] Paper Trading: Mô phỏng đặt lệnh với matching engine realistic
- [ ] Paper Trading: Orderbook giả, delay khớp lệnh
- [ ] Fix AI Take Profit — chuyển từ cơ học sang probability-based
- [ ] Fix AI Stop Loss — dynamic adjustment theo thị trường, không chỉ tĩnh
- [ ] Fix Scenario Simulation — mô phỏng kịch bản thực tế (không chỉ P&L đơn giản)
- [ ] Fix logic lẫn lộn giữa Order và Position flow

### Out of Scope

- Kết nối broker thật (đặt lệnh thật qua API sàn) — quá rủi ro cho v1
- Mobile app — web-first
- Real-time chat/social trading — không phải core value
- Fundamental analysis engine — focus technical + AI trước

## Context

### Codebase hiện tại
- **Stack:** React 19 + Express.js + PostgreSQL + Socket.IO + Google Gemini
- **Frontend:** React SPA, Tailwind CSS, view-based components
- **Backend:** Express.js, layered architecture (routes → controllers → services → models)
- **AI:** Google Gemini cho text analysis, rule-based cho calculations (ATR, support/resistance)
- **Data:** VPBS API cho giá real-time thị trường Việt Nam

### Vấn đề logic hiện tại
1. **Order vs Position lẫn lộn:** Form tạo lệnh chạy fillEngine INSTANT → giả lập khớp ngay → tạo position. User muốn nhập lệnh thật để tracking nhưng hệ thống lại mô phỏng paper trading.
2. **AI Take Profit cơ học:** Chỉ dùng ATR × RR ratio, không có xác suất thống kê.
3. **AI Stop Loss tĩnh:** Tính 1 lần lúc đặt, không tự điều chỉnh khi thị trường thay đổi.
4. **Scenario Simulation hạn chế:** Chỉ tính P&L cơ bản (entry/SL/TP), không mô phỏng Monte Carlo hay multiple outcomes.

## Constraints

- **Tech stack:** Giữ nguyên React + Express + PostgreSQL + Gemini — không thay đổi stack
- **AI provider:** Google Gemini (đã tích hợp) — tối ưu usage, không spam API
- **Market data:** VPBS API — phụ thuộc vào giờ giao dịch sàn VN
- **Brownfield:** Code đã có ~1800 lines codebase docs, cần refactor không phải rebuild

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Tách Portfolio Management vs Paper Trading thành 2 module riêng | 2 use case khác nhau: tracking vs simulation, gộp gây nhầm lẫn UX | — Pending |
| Giữ rule-based calculation + Gemini narrative | AI calculation cần deterministic, Gemini tốt cho analysis text | ✓ Good |
| VPBS API cho market data | Sàn VN, miễn phí, đã tích hợp | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-26 after initialization*
