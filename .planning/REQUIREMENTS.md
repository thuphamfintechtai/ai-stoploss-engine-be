# Requirements: TradeGuard AI

**Defined:** 2026-03-26
**Core Value:** Giúp nhà đầu tư quản lý rủi ro thông minh — biết khi nào cắt lỗ, khi nào chốt lời, với AI hỗ trợ phân tích thay vì quyết định cảm tính.

## v1 Requirements

### Foundation — Context Separation

- [x] **FOUND-01**: Tách Portfolio Management (real) và Paper Trading (simulation) thành 2 flow riêng biệt với data model, controller, và UX riêng
- [x] **FOUND-02**: Thêm cột `context` ('REAL'/'PAPER') vào bảng orders và positions để phân biệt
- [x] **FOUND-03**: Portfolio mode không chạy fillEngine — user nhập lệnh đã đặt trên sàn (symbol, side, quantity, price, date) đơn giản ghi nhận
- [x] **FOUND-04**: Paper Trading mode sử dụng fillEngine riêng với virtual balance
- [x] **FOUND-05**: Tổ chức lại Shared Kernel (MarketData, FeeEngine, TickSizeEngine, RiskCalculator) thành module dùng chung cho cả 2 context

### Portfolio Management (Real Order Tracking)

- [x] **PORT-01**: User có thể nhập lệnh thật đã đặt trên sàn (form đơn giản: mã CK, side, số lượng, giá khớp, ngày)
- [x] **PORT-02**: User có thể xem cash balance (tổng vốn, vốn đã deploy, vốn available)
- [x] **PORT-03**: Cash balance tự động cập nhật khi nhập/đóng lệnh, tính đúng T+2 settlement
- [x] **PORT-04**: User có thể đóng vị thế thủ công (ghi nhận bán trên sàn, tính realized P&L)
- [x] **PORT-05**: User có thể xem lịch sử giao dịch (mua/bán) với phí và thuế VN
- [x] **PORT-06**: User có thể xem tổng quan portfolio (tổng giá trị, tổng P&L, % return)

### Paper Trading (Simulation)

- [x] **PAPER-01**: User có thể đặt lệnh mô phỏng (MP, LO, ATO, ATC) với virtual balance riêng
- [x] **PAPER-02**: Matching engine mô phỏng realistic: slippage, xác suất khớp dựa trên volume, delay khớp
- [x] **PAPER-03**: Virtual cash balance riêng cho paper trading, không ảnh hưởng portfolio thật
- [x] **PAPER-04**: User có thể quản lý lệnh pending (sửa/hủy)
- [x] **PAPER-05**: Mô phỏng T+2 settlement cho paper trading
- [x] **PAPER-06**: Paper trading performance report riêng (P&L, win rate, so sánh với mua giữ)

### AI Dynamic Stop Loss

- [x] **AISL-01**: SL tự động điều chỉnh theo ATR hiện tại (không chỉ ATR lúc đặt lệnh)
- [ ] **AISL-02**: SL thích ứng với regime thị trường (trending vs ranging) qua Bollinger Band percentile
- [x] **AISL-03**: Trailing stop thông minh: khoảng cách mở rộng khi volatility cao, thu hẹp khi thấp
- [ ] **AISL-04**: SL phải nằm trong biên độ giá sàn (HOSE +/-7%, HNX +/-10%), cảnh báo khi gần floor
- [x] **AISL-05**: Worker recalculate SL theo lịch (mỗi 5 phút trong giờ giao dịch)
- [x] **AISL-06**: AI narrative giải thích TẠI SAO SL thay đổi (qua Gemini, với fallback rule-based)

### AI Probability-Based Take Profit

- [x] **AITP-01**: TP dựa trên phân phối thống kê (log-normal) từ dữ liệu lịch sử, hiển thị xác suất đạt mỗi mức
- [x] **AITP-02**: Hiển thị 3-5 mức TP với xác suất tương ứng (ví dụ: "70% đạt 25,500 VND trong 5 ngày")
- [x] **AITP-03**: Thay thế TP cơ học (ATR × RR) bằng TP probability-based làm default
- [x] **AITP-04**: Label rõ "experimental" cho probability-based TP, thu thập feedback

### Risk Scenario Simulation

- [x] **RISK-01**: VaR calculation — "Với 95% tin cậy, max loss 1 ngày là X VND"
- [x] **RISK-02**: Monte Carlo simulation — mô phỏng 1000+ đường đi portfolio, hiển thị phân phối kết quả
- [x] **RISK-03**: Stress test scenarios — "Nếu VNINDEX giảm 10/15/20%?" hiển thị impact lên portfolio
- [x] **RISK-04**: Sector concentration warning — cảnh báo khi quá nhiều vốn vào 1 ngành

### AI Capital Allocation

- [x] **AICAP-01**: AI suggest position sizing (Kelly Criterion variant) dựa trên win rate và R:R
- [x] **AICAP-02**: Visualization risk budget toàn portfolio — "Đã dùng 60% ngân sách rủi ro"
- [x] **AICAP-03**: AI rebalancing suggestions — "HPG chiếm 40% portfolio — xem xét giảm"

### Integration & Polish

- [ ] **INTG-01**: Frontend tách rõ UI Portfolio vs Paper Trading (visual differentiation: màu sắc, label)
- [ ] **INTG-02**: Comprehensive error handling — không có silent failure
- [ ] **INTG-03**: Gemini fallback rule-based cho tất cả AI features (timeout 5s, cache regime 30-60 phút)
- [ ] **INTG-04**: Performance optimization (cache, pagination cho position lists)

## v2 Requirements

### Advanced Analytics

- **ADV-01**: Correlation matrix giữa các vị thế (need historical data lớn)
- **ADV-02**: Partial take profit automation (50% tại high-probability target)
- **ADV-03**: Full orderbook simulation (bid/ask spread đầy đủ)
- **ADV-04**: Drawdown analysis & visualization
- **ADV-05**: Full backtesting engine

### UX Improvements

- **UX-01**: Time-decay stop tightening (SL thắt chặt khi position già)
- **UX-02**: Win rate tracking per strategy
- **UX-03**: PWA support cho mobile

## Out of Scope

| Feature | Reason |
|---------|--------|
| Kết nối broker thật (auto-execute trades) | Quá rủi ro cho v1, vấn đề pháp lý VN |
| Social/copy trading | Không phải core value, phức tạp moderation |
| Fundamental analysis engine | Huge scope, nhiều tools khác đã làm tốt (Vietstock, CafeF) |
| Real-time chat/forum | Không phải core value |
| Crypto/forex support | Khác market structure, khác data provider |
| Mobile native app | Web-first, responsive design đủ |
| Automated trading bot | Regulatory risk, liability |
| Options/derivatives | VN derivatives market nhỏ, thêm complexity |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| FOUND-04 | Phase 1 | Complete |
| FOUND-05 | Phase 1 | Complete |
| PORT-01 | Phase 1 | Complete |
| PORT-02 | Phase 1 | Complete |
| PORT-03 | Phase 1 | Complete |
| PORT-04 | Phase 1 | Complete |
| PORT-05 | Phase 1 | Complete |
| PORT-06 | Phase 1 | Complete |
| PAPER-01 | Phase 2 | Complete |
| PAPER-02 | Phase 2 | Complete |
| PAPER-03 | Phase 2 | Complete |
| PAPER-04 | Phase 2 | Complete |
| PAPER-05 | Phase 2 | Complete |
| PAPER-06 | Phase 2 | Complete |
| AISL-01 | Phase 3 | Complete |
| AISL-02 | Phase 3 | Pending |
| AISL-03 | Phase 3 | Complete |
| AISL-04 | Phase 3 | Pending |
| AISL-05 | Phase 3 | Complete |
| AISL-06 | Phase 3 | Complete |
| AITP-01 | Phase 3 | Complete |
| AITP-02 | Phase 3 | Complete |
| AITP-03 | Phase 3 | Complete |
| AITP-04 | Phase 3 | Complete |
| RISK-01 | Phase 4 | Complete |
| RISK-02 | Phase 4 | Complete |
| RISK-03 | Phase 4 | Complete |
| RISK-04 | Phase 4 | Complete |
| AICAP-01 | Phase 3 | Complete |
| AICAP-02 | Phase 3 | Complete |
| AICAP-03 | Phase 3 | Complete |
| INTG-01 | Phase 5 | Pending |
| INTG-02 | Phase 5 | Pending |
| INTG-03 | Phase 5 | Pending |
| INTG-04 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 38 total
- Mapped to phases: 38
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-27 after roadmap creation*
