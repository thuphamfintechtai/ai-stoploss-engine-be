# Roadmap: TradeGuard AI

## Overview

TradeGuard AI refactor va nang cap tu mot codebase da co (brownfield) thanh he thong quan ly rui ro giao dich chuyen nghiep. Hanh trinh bat dau bang viec sua kien truc co ban nhat -- tach Portfolio Management khoi Paper Trading -- roi xay dung tung module doc lap (paper trading, AI services, risk simulation), va ket thuc bang viec tich hop tat ca thanh trai nghiem nguoi dung nhat quan.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation & Portfolio Management** - Tach context Portfolio/Paper Trading va xay dung flow nhap lenh that
- [x] **Phase 2: Paper Trading Engine** - Mo phong giao dich realistic voi matching engine va virtual balance (completed 2026-03-27)
- [ ] **Phase 3: AI Enhancement** - Dynamic Stop Loss, Probability-based Take Profit, AI Capital Allocation
- [ ] **Phase 4: Risk Scenario Simulation** - VaR, Monte Carlo, stress testing portfolio
- [ ] **Phase 5: Integration & Polish** - UX nhat quan, error handling, performance optimization

## Phase Details

### Phase 1: Foundation & Portfolio Management
**Goal**: User co the quan ly portfolio that (nhap lenh, theo doi von, dong vi the) trong mot flow tach biet hoan toan khoi paper trading
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04, FOUND-05, PORT-01, PORT-02, PORT-03, PORT-04, PORT-05, PORT-06
**Success Criteria** (what must be TRUE):
  1. User co the nhap lenh da dat tren san (ma CK, side, so luong, gia khop, ngay) va lenh duoc luu voi context='REAL' -- khong chay fill engine
  2. User co the xem cash balance chinh xac (tong von, von deployed, von available) voi T+2 settlement
  3. User co the dong vi the thu cong va he thong tinh dung realized P&L (bao gom phi + thue VN)
  4. User co the xem lich su giao dich va tong quan portfolio (tong gia tri, tong P&L, % return)
  5. Paper Trading mode van hoat dong (su dung fillEngine rieng voi virtual balance), khong bi anh huong boi thay doi kien truc
**Plans**: 8 plans (bao gom 2 gap closure plans)

Plans:
- [x] 01-01-PLAN.md — DB Migration + Vitest Setup + Shared Kernel Reorganization
- [x] 01-02-PLAN.md — Real Order Backend (services, controllers, routes)
- [x] 01-03-PLAN.md — Cash Balance + T+2 Settlement (CapitalService + Worker)
- [x] 01-04-PLAN.md — Paper Trading Guard (context filter + subfolder migration)
- [x] 01-05-PLAN.md — Frontend Portfolio Management UI (form, balance, positions, history)
- [x] 01-06-PLAN.md — Wire Cash Flow + Portfolio Summary Endpoint
- [x] 01-07-PLAN.md — [GAP] Fix test regression: mock CapitalService trong realOrderService.test.js
- [x] 01-08-PLAN.md — [GAP] Wire frontend REAL tab voi real-summary endpoint (PORT-06)

**UI hint**: yes

### Phase 2: Paper Trading Engine
**Goal**: User co the mo phong giao dich voi do tin cay cao -- matching engine realistic, virtual balance rieng, order lifecycle day du
**Depends on**: Phase 1
**Requirements**: PAPER-01, PAPER-02, PAPER-03, PAPER-04, PAPER-05, PAPER-06
**Success Criteria** (what must be TRUE):
  1. User co the dat lenh mo phong (MP, LO, ATO, ATC) va lenh duoc khop voi slippage + xac suat khop dua tren volume (khong instant 100%)
  2. User co the quan ly lenh pending (sua/huy) va xem trang thai lenh realtime
  3. Virtual cash balance rieng cho paper trading, co T+2 settlement, khong anh huong portfolio that
  4. User co the xem paper trading performance report (P&L, win rate, so sanh voi buy-and-hold)
**Plans**: 5 plans

Plans:
- [x] 02-01-PLAN.md — DB Migration + PaperMatchingEngine + PaperCapitalService (foundation)
- [x] 02-02-PLAN.md — Upgrade fillEngine REALISTIC mode + PaperFillWorker
- [x] 02-03-PLAN.md — Order Edit/Cancel endpoint + virtual balance refund
- [x] 02-04-PLAN.md — Performance Report service + API endpoint
- [x] 02-05-PLAN.md — Frontend wiring: components + PortfolioView integration + E2E verify

**UI hint**: yes

### Phase 3: AI Enhancement
**Goal**: AI tu van stop loss, take profit, va phan bo von dua tren du lieu thuc te va xac suat thong ke -- thay vi tinh co hoc 1 lan
**Depends on**: Phase 1
**Requirements**: AISL-01, AISL-02, AISL-03, AISL-04, AISL-05, AISL-06, AITP-01, AITP-02, AITP-03, AITP-04, AICAP-01, AICAP-02, AICAP-03
**Success Criteria** (what must be TRUE):
  1. Stop Loss tu dong dieu chinh theo ATR hien tai va regime thi truong (trending/ranging) -- khong con tinh 1 lan luc dat lenh
  2. Trailing stop thong minh: khoang cach mo rong khi volatility cao, thu hep khi thap; SL luon nam trong bien do gia san (HOSE +/-7%, HNX +/-10%)
  3. Take Profit hien thi 3-5 muc voi xac suat tuong ung (vi du: "70% dat 25,500 VND trong 5 ngay") thay vi chi ATR x RR ratio
  4. AI suggest position sizing (Kelly Criterion) va hien thi risk budget toan portfolio ("Da dung 60% ngan sach rui ro")
  5. Moi thay doi AI co narrative giai thich TAI SAO (qua Gemini voi fallback rule-based khi API timeout)
**Plans**: 6 plans

Plans:
- [x] 03-01-PLAN.md — Install deps + Shared foundation (indicatorCache, regimeDetector, sectorClassification, priceBandValidator)
- [x] 03-02-PLAN.md — Dynamic Stop Loss service + Worker upgrade (AISL-01..06)
- [x] 03-03-PLAN.md — Probability-based Take Profit service + API upgrade (AITP-01..04)
- [x] 03-04-PLAN.md — Capital Allocation service: half-Kelly + risk budget (AICAP-01..02)
- [x] 03-05-PLAN.md — Rebalancing suggestions + sector concentration (AICAP-03)
- [x] 03-06-PLAN.md — Frontend wiring: TradingTerminal + AiMonitorPanel + RiskManagerView

**UI hint**: yes

### Phase 4: Risk Scenario Simulation
**Goal**: User co the danh gia rui ro portfolio bang cong cu "institutional-grade" -- VaR, Monte Carlo, stress test
**Depends on**: Phase 3
**Requirements**: RISK-01, RISK-02, RISK-03, RISK-04
**Success Criteria** (what must be TRUE):
  1. User co the xem VaR: "Voi 95% tin cay, max loss 1 ngay la X VND"
  2. User co the xem Monte Carlo simulation (1000+ duong di portfolio) voi phan phoi ket qua truc quan
  3. User co the chay stress test: "Neu VNINDEX giam 10/15/20%?" va thay impact len tung vi the + toan portfolio
  4. He thong canh bao khi sector concentration qua cao (vi du: >40% von vao 1 nganh)
**Plans**: 3 plans

Plans:
- [x] 04-01-PLAN.md — Backend services: VaR, Monte Carlo, Stress Test, Sector Concentration (pure functions + tests)
- [x] 04-02-PLAN.md — API endpoints: controller + routes wiring (RISK-01..04)
- [ ] 04-03-PLAN.md — Frontend: RiskManagerView extension with 4 simulation tabs + charts

**UI hint**: yes

### Phase 5: Integration & Polish
**Goal**: Trai nghiem nguoi dung nhat quan, khong co loi tham lang, hieu suat tot cho du lieu lon
**Depends on**: Phase 2, Phase 3, Phase 4
**Requirements**: INTG-01, INTG-02, INTG-03, INTG-04
**Success Criteria** (what must be TRUE):
  1. Frontend phan biet ro rang Portfolio vs Paper Trading bang mau sac va label -- user khong the nham lan 2 mode
  2. Moi loi deu duoc hien thi ro rang cho user (khong co silent failure) -- bao gom API errors, validation errors, WebSocket disconnect
  3. Tat ca AI features co Gemini fallback rule-based hoat dong dung (timeout 5s, cache regime 30-60 phut)
  4. Position lists phan trang, market data duoc cache -- khong co hien tuong lag khi portfolio lon
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 > 2 > 3 > 4 > 5
Note: Phase 2 va Phase 3 co the chay song song (khac dependency tree nhung khong block nhau).

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation & Portfolio Management | 8/8 | Complete |  |
| 2. Paper Trading Engine | 5/5 | Complete   | 2026-03-27 |
| 3. AI Enhancement | 5/6 | In Progress|  |
| 4. Risk Scenario Simulation | 1/3 | In Progress|  |
| 5. Integration & Polish | 0/? | Not started | - |
