# Project Research Summary

**Project:** TradeGuard AI
**Domain:** AI-enhanced trading risk management platform (Vietnam stock market)
**Researched:** 2026-03-26
**Confidence:** HIGH

## Executive Summary

TradeGuard AI la mot platform quan ly rui ro giao dich chung khoan Viet Nam, ket hop AI (Gemini) voi tinh toan ky thuat (ATR, xac suat thong ke, mo phong danh muc). Dua tren ket qua nghien cuu, van de co ban nhat hien tai khong phai la thieu tinh nang moi, ma la architecture bi tron lan giua hai luong hoan toan khac nhau: **Portfolio Tracking** (ghi nhan lenh that da dat tren san) va **Paper Trading** (mo phong giao dich). Tat ca cai tien tiep theo deu phu thuoc vao viec giai quyet van de nay truoc.

Huong tiep can duoc khuyen nghi la ap dung Bounded Context Separation theo mo hinh Modular Monolith: tach ro Portfolio Context, Paper Trading Context, AI Services Context, va Shared Kernel -- tat ca van trong cung Express.js monorepo, khong can chuyen sang microservices. Ve mat ky thuat, chi can bo sung 3 package moi: `trading-signals` (chi bao ky thuat streaming), `simple-statistics` (phan phoi xac suat), va `mathjs` (phep toan ma tran cho toi uu hoa danh muc). Toan bo logic khop lenh phai xay tuy chinh vi khong co npm package nao ho tro quy tac san Viet Nam (T+2, lo 100 co phieu, bien do HOSE +/-7%).

Rui ro chinh can kiem soat: (1) AI SL/TP dua tren ATR tinh 1 lan luc dat lenh, khong tu dieu chinh theo bien dong thi truong -- can them dynamic recalculation; (2) Paper trading fill instant 100% lam phong phan phap, can mo hinh truot gia va xac suat khop lenh; (3) TP chi dua ATR x RR ratio, khong co xac suat thong ke khien nguoi dung giu vi the qua lau cho muc tieu kho chung; (4) phu thuoc Gemini API cho cac quyet dinh quan trong can co fallback rule-based. Cac rui ro nay deu co phuong an xu ly ro rang va co the trien khai theo tung phase.

## Key Findings

### Recommended Stack

Stack hien tai (React 19 + Express.js + PostgreSQL + Gemini) la co dinh. Chi can bo sung 3 package backend moi. Order matching engine phai tu xay (~300-500 dong) vi khong co library nao phu hop voi quy tac san Viet Nam. Cac dependency hien co (node-cron, uuid, tickSizeEngine.js) duoc tai su dung day du.

**Core technologies (new dependencies only):**
- `trading-signals` ^7.4.3: ATR, RSI, Bollinger Bands streaming -- thay the code ATR tu viet trong aiService.js, TypeScript-native, dang hoat dong tich cuc
- `simple-statistics` ^7.8.9: phan phoi xac suat, percentile, Sharpe ratio -- zero dependencies, 50KB, dap ung toan bo nhu cau thong ke
- `mathjs` ^14.6.0 (selective imports): phep toan ma tran cho toi uu hoa danh muc -- chi dung khi can covariance matrix, co the defer neu scope thu hep
- `PaperMatchingEngine` (custom): khop lenh mo phong tuan theo quy tac HOSE/HNX/UPCOM, bien do gia, lo co phieu, session ATO/ATC

### Expected Features

**Must have (table stakes -- Priority 1: sua nen tang):**
- Tach Portfolio Management vs Paper Trading: data model rieng, UX rieng, logic rieng -- day la fix kien truc quan trong nhat
- Portfolio: nhap lenh bang tay (ghi nhan lenh da dat tren san, khong qua fill engine)
- Portfolio: quan ly cash balance (deployed_capital, available_capital, T+2 settlement)
- Portfolio: dong vi the thu cong (ghi nhan viec ban tren san, tinh P&L thuc te)
- Paper Trading: virtual cash balance rieng voi simulated matching

**Should have (differentiators -- Priority 2: nang cap AI):**
- Probability-based Take Profit: thay the ATR x RR bang phan phoi log-normal tu du lieu lich su, hien thi "70% xac suat dat 25,500 VND trong 5 ngay"
- Dynamic Stop Loss: SL tu dong dieu chinh moi 5 phut theo ATR hien tai + che do bien dong (Bollinger Band percentile), khong con tinh 1 lan luc vao lenh
- AI position sizing: Kelly Criterion phan so dua tren win rate theo doi + ky vong R:R

**Should have (differentiators -- Priority 3: mo phong rui ro):**
- Value at Risk (VaR): cong thuc thong ke co biet, gia tri cam nhan cao
- Monte Carlo simulation: mo phong 1000 kich ban danh muc, hien thi phan phoi ket qua
- Stress test scenarios: "Neu VNINDEX giam 15%, danh muc mat X VND"

**Defer to v2+:**
- Correlation matrix analysis: can du lieu lich su lon, tinh toan nang
- Partial take profit automation: them do phuc tap UX
- Full orderbook simulation (bid/ask spread day du): niceto-have, basic slippage la du cho v1
- Full backtesting engine: massive effort, ngoai scope

### Architecture Approach

Ap dung Modular Monolith voi Bounded Context Separation theo DDD. Khong tach microservices (overkill). 4 context chinh: **Portfolio Context** (lenh that, von thuc), **Paper Trading Context** (mo phong, von ao), **AI Services Context** (stateless advisors), **Shared Kernel** (MarketData, WebSocket, Fee/Tick engines, RiskCalculator). Tiep can database: them cot `context VARCHAR(20) CHECK (IN 'REAL', 'PAPER')` vao cac bang hien tai thay vi tao bang moi -- migration nhe, it breaking change, chuyen doi dan.

**Major components:**
1. **Portfolio Context** (moi): RealOrderController, RealPositionController, CapitalService -- ghi nhan lenh that, quan ly von thuc
2. **Paper Trading Context** (rename/refactor): PaperOrderController, PaperPositionController, FillEngine, MatchingEngine (future) -- mo phong giao dich, virtual balance
3. **AI Services Context** (extract + new): StopLossAdvisor, TakeProfitAdvisor, ScenarioSimulator, CapitalAdvisor -- stateless, phuc vu ca 2 context tren
4. **Shared Kernel** (keep + cleanup): MarketDataService (singleton, cache 30s), RiskCalculator, FeeEngine, TickSizeEngine, WebSocket, NotificationService
5. **Workers** (refactor): stopLossMonitor tach ro logic real (chi canh bao) vs paper (tu dong close); paperFillWorker moi cho REALISTIC mode

### Critical Pitfalls

1. **Order/Position Identity Crisis** -- Portfolio va Paper Trading dung chung fill engine, entry price bi sai lech so voi gia khop that tren san. Phong tranh: tao 2 flow rieng biet, Portfolio mode khong bao gio chay fill engine, user nhap gia khop thuc te.

2. **AI SL Overfitting to Historical Volatility** -- ATR tinh 1 lan luc dat lenh, khong dieu chinh khi thi truong thay doi. Phong tranh: recalculate ATR theo lich tren node-cron, dung Bollinger Band percentile de phat hien che do bien dong, hien thi khoang tin cay thay vi diem gia cu the.

3. **Take Profit Without Probability Creates False Expectations** -- ATR x RR chi la co hoc, khong phan anh xac suat. Phong tranh: tinh phan phoi log-normal tu du lieu 60-200 ngay, hien thi "70% xac suat" cho moi muc TP.

4. **Paper Trading Instant Fill Creates Unrealistic Confidence** -- fill instant 100%, khong truot gia, khong partial fill. Phong tranh: them model truot gia, xac suat khop lenh dua tren volume, delay 1-5 giay, disclaimer ro rang.

5. **Vietnam T+2 Settlement Not Modeled** -- cash balance tinh sai, cho phep giao dich khong the thuc hien tren san that. Phong tranh: them settlement_date vao positions, tach "available cash" vs "pending settlement cash".

6. **Price Band Violations** -- AI co the suggest SL duoi floor price HOSE -7%, tao cam giac bao ve gia. Phong tranh: clamp SL vao trong bien do, canh bao khi SL gan floor, lien ket vnStockRules.ts vao AI calculation.

7. **Gemini API Single Point of Failure** -- API down hoac rate-limit trong gio giao dich. Phong tranh: rule-based fallback luon co san, cache regime 30-60 phut, timeout 5 giay, schema validation voi zod.

## Implications for Roadmap

Based on combined research, suggested phase structure (5 phases):

### Phase 1: Foundation Cleanup + Context Separation

**Rationale:** Moi tinh nang con lai deu phu thuoc vao viec tach Portfolio vs Paper Trading. Day la kien truc debt lon nhat. Lam truoc de tranh phat sinh them no ky thuat.
**Delivers:** 2 luong rieng biet co ranh gioi ro rang, database schema voi context column, Shared Kernel duoc to chuc sach, type safety cho VND/Points
**Addresses:** Portfolio manual order entry, cash balance tracking, position close manual (FEATURES.md Priority 1)
**Avoids:** Pitfall 1 (Order/Position Identity Crisis), Pitfall 8 (Tick size errors), Pitfall 10 (VND currency confusion), Pitfall 11 (WebSocket silent failure)
**Stack:** Khong can package moi. Re-organize code hien co, add context column migration, ket noi vnStockRules.ts voi validation flow.

### Phase 2: Paper Trading Enhancement

**Rationale:** Sau khi tach context, Paper Trading module can duoc xay dung lai voi do tin cay cao hon. Phase nay doc lap voi Portfolio (co the chay song song).
**Delivers:** Virtual balance, realistic fill simulation (slippage + partial fill probability), settlement date tracking, order lifecycle day du
**Addresses:** Simulated order placement, realistic matching, virtual cash, pending order management (FEATURES.md)
**Avoids:** Pitfall 4 (Instant Fill Unrealistic Confidence), Pitfall 6 (T+2 Settlement)
**Stack:** Custom PaperMatchingEngine, tap hop slippageCalculator.js (da co), add `settlement_date` column

### Phase 3: AI Services Enhancement -- Dynamic SL + Probabilistic TP

**Rationale:** Day la cam ket gia tri chinh cua san pham. Sau khi Phase 1+2 on dinh, nang cap AI de tao khac biet that su so voi cac tool thong thuong.
**Delivers:** Dynamic SL tu dong dieu chinh theo ATR + Bollinger regime, Probabilistic TP voi xac suat log-normal, AI position sizing (Kelly Criterion)
**Addresses:** Dynamic SL adjustment, Volatility-adaptive trailing, Probability-based TP, multiple TP tiers with probability (FEATURES.md Priority 2)
**Avoids:** Pitfall 2 (SL Overfitting), Pitfall 3 (TP Without Probability), Pitfall 7 (Price Band Violations), Pitfall 9 (Gemini Dependency -- build fallback)
**Stack:** `trading-signals` (ATR streaming), `simple-statistics` (log-normal distribution, Sharpe), node-cron (recalculation schedule)

### Phase 4: Risk Scenario Simulation

**Rationale:** Nang cao gia tri perceived cua san pham. Monte Carlo va VaR la cac metric "institutional-grade" ma user cam thay duoc gia tri. Phu thuoc Phase 3 (can SL/TP data chinh xac lam input).
**Delivers:** VaR calculation, Monte Carlo portfolio simulation (1000 paths), stress test scenarios (VNINDEX -10/15/20%), sector concentration warnings
**Addresses:** Monte Carlo, VaR, Stress Testing, portfolio heat visualization (FEATURES.md Priority 3)
**Avoids:** Pitfall 5 (Correlation Ignored), Pitfall 12 (Scenario Without Monte Carlo)
**Stack:** `simple-statistics` (mean, stddev for GBM), `mathjs` (covariance matrix), Custom ScenarioSimulator

### Phase 5: Integration, Polish, and Performance

**Rationale:** Sau khi tat ca context san sang, ket noi lai, polishing UX, dam bao tat ca luong hoat dong nhat quan tu frontend den backend.
**Delivers:** Frontend updates cho tat ca context moi, performance optimization (cache, pagination), end-to-end testing, paper trading performance report
**Addresses:** Paper trading performance report, portfolio summary chuan, win rate tracking (FEATURES.md)
**Avoids:** Silent failure modes (comprehensive error handling), real/paper UI confusion (visual differentiation)
**Stack:** Khong can dependency moi. Focus vao UI differentiation va test coverage.

### Phase Ordering Rationale

- **Phase 1 truoc tien** vi khong context nao co the hoat dong dung neu Portfolio va Paper Trading van bi tron lan -- day la architectural debt phai tra truoc
- **Phase 2 va 3 co the chay song song** vi Paper Trading Context va AI Services Context doc lap nhau; team co the chia nhu cau parallel
- **Phase 4 sau Phase 3** vi Monte Carlo simulation can SL/TP chinh xac lam input; VaR co the bat dau som hon
- **Phase 5 cuoi** vi integration chi co nghia khi tat ca component san sang
- Thu tu nay trung voi khuyen nghi trong ARCHITECTURE.md (Suggested Build Order) va FEATURES.md (MVP Priority 1-2-3)

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Paper Trading):** Realistic fill probability model can cac con so cu the ve volume va spread cho co phieu VN -- nen research them so lieu market microstructure
- **Phase 3 (Probabilistic TP):** Log-normal distribution fit cho co phieu VN co the khac voi stock Tay (fat tails, price bands distort distribution) -- can backtest voi du lieu thuc te HOSE truoc khi ship
- **Phase 4 (Monte Carlo):** Vietnam market price limit rules (+/-7%) anh huong den phan phoi trong simulation -- Geometric Brownian Motion chuan can dieu chinh; nen xac nhan algorithm truoc khi implementation
- **Phase 3 (Gemini Fallback):** Rule-based regime detection algorithm (ATR + MA crossover) chua duoc dinh nghia cu the -- can research va test de dam bao fallback dang tin cay

Phases with standard patterns (skip research-phase):
- **Phase 1 (Foundation):** DDD Bounded Context pattern va ALTER TABLE migration la well-documented, khong can research them
- **Phase 4 VaR:** Historical simulation VaR la cong thuc well-known, implementation thang
- **Phase 5 (Integration/Polish):** Standard engineering work, khong co domain uncertainty

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | 3 package duoc verify tren npm/GitHub, version moi nhat, actively maintained. Custom matching engine la correct answer voi ly do ro rang. |
| Features | HIGH | Phan tich dua tren codebase thuc te + domain research. Feature status (Exists/Missing/Partial) verified qua PROJECT.md va file analysis. |
| Architecture | HIGH | Dua tren phan tich codebase truc tiep + DDD Bounded Context la established pattern cho trading systems. Database migration approach (context column) la pragmatic va low-risk. |
| Pitfalls | HIGH | 8/12 pitfalls duoc xac nhan truc tiep tu codebase (fillEngine.js, CONCERNS.md, PROJECT.md). 4 pitfalls con lai dua tren domain research voi nhieu nguon dong thuan. |

**Overall confidence:** HIGH

### Gaps to Address

- **Probabilistic TP accuracy for VN market:** Log-normal distribution la starting point tot, nhung VN co phieu bi gia han (+/-7%) lam distort phan phoi. Can backtest algorithm nay voi 6-12 thang du lieu HOSE truoc khi claim do chinh xac. Xu ly: implement va label la "experimental", thu thap feedback tu users, refine model sau 1 thang.

- **Gemini fallback rule-based logic:** PITFALLS.md khuyen nghi "ATR + MA crossover" nhung khong chi dinh tham so cu the (MA period nao? ATR threshold bao nhieu?). Xu ly: research trong Phase 3 planning, co the dung SMA50/SMA200 crossover + ATR percentile >70 lam starting point.

- **mathjs scope:** STACK.md danh gia `mathjs` la MEDIUM confidence vi portfolio optimization scope co the thu hep. Neu Phase 4 chon equal-risk-contribution thay vi mean-variance, mathjs co the khong can. Xu ly: defer quyet dinh nay den Phase 4 planning khi scope ro rang hon.

- **T+2 holiday calendar:** Settlement calculation phu thuoc vao lich nghi le HOSE/HNX. Khong co API chinh thuc; phai maintain thu cong. Xu ly: hardcode lich nghi 2026-2027 trong constants file, dat reminder cap nhat hang nam.

## Sources

### Primary (HIGH confidence -- codebase analysis)
- `fillEngine.js`, `aiService.js`, `vnStockRules.ts` -- xac nhan van de kien truc va implementation gaps hien tai
- `CONCERNS.md`, `PROJECT.md` -- xac nhan cac phat hien trong ARCHITECTURE.md va PITFALLS.md
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md` -- structure hien tai

### Secondary (HIGH confidence -- official sources)
- [npm: trading-signals 7.4.3](https://www.npmjs.com/package/trading-signals) -- verified active, TypeScript-native
- [npm: simple-statistics 7.8.9](https://www.npmjs.com/package/simple-statistics) -- verified active, zero-dep
- [HOSE Trading Regulations 2025](https://static2.vietstock.vn/vietstock/2025/4/29/20250429_20250429___hose___trading_regulations_on_hose.pdf) -- Vietnam market rules
- [Martin Fowler: Bounded Context](https://martinfowler.com/bliki/BoundedContext.html) -- architecture pattern
- [Kelly Criterion - Wikipedia](https://en.wikipedia.org/wiki/Kelly_criterion) -- position sizing formula

### Secondary (MEDIUM confidence -- domain research)
- [QuantInsti - Probability Trading](https://blog.quantinsti.com/probability-trading/) -- probabilistic TP approach
- [LuxAlgo ATR Dynamic Stop Loss](https://www.luxalgo.com/blog/average-true-range-dynamic-stop-loss-levels/) -- dynamic SL patterns
- [Portfolio Visualizer Monte Carlo](https://www.portfoliovisualizer.com/monte-carlo-simulation) -- simulation approach
- [ETNA Paper Trading 2025](https://www.etnasoft.com/best-paper-trading-platform-for-u-s-broker-dealers-why-advanced-simulation-sets-the-2025-standard/) -- paper trading best practices
- [AI Algorithmic Trading Mistakes - Medium](https://alexhonchar.medium.com/ai-for-algorithmic-trading-7-mistakes-that-could-make-me-broke-a41f94048b8c) -- pitfall validation

---
*Research completed: 2026-03-26*
*Ready for roadmap: yes*
