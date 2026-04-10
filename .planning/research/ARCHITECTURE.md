# Architecture Patterns

**Domain:** AI-enhanced trading risk management platform (Vietnam stock market)
**Researched:** 2026-03-26
**Confidence:** HIGH (based on codebase analysis + established DDD/trading architecture patterns)

## Problem Statement

Hien tai, Portfolio Management va Paper Trading dang bi gop chung:
- Form tao lenh chay `fillEngine` INSTANT -> gia lap khop ngay -> tao position
- User muon nhap lenh that de tracking nhung he thong lai mo phong paper trading
- Order va Position flow lan lon: khong ro rang khi nao la "ghi nhan lenh that" vs "mo phong giao dich"

## Recommended Architecture: Bounded Context Separation

Ap dung **Domain-Driven Design (DDD) Bounded Contexts** de tach 4 module chinh. Khong phai microservices (overkill cho monorepo Express.js), ma la **modular monolith** voi ranh gioi domain ro rang trong cung codebase.

```
+------------------------------------------------------------------+
|                        PRESENTATION LAYER                         |
|  PortfolioView  |  PaperTradingView  |  AiSignalsView  | ...     |
+--------+--------+---------+----------+--------+--------+---------+
         |                  |                   |
+--------v------------------v-------------------v------------------+
|                        API GATEWAY LAYER                          |
|  /api/portfolio/*  |  /api/paper-trading/*  |  /api/ai/*         |
+--------+----------+-----------+-----------+----------+-----------+
         |                      |                      |
+--------v--------+  +----------v----------+  +--------v--------+
|   PORTFOLIO     |  |   PAPER TRADING     |  |   AI SERVICES   |
|   CONTEXT       |  |   CONTEXT           |  |   CONTEXT       |
|                 |  |                     |  |                 |
| - Real orders   |  | - Simulated orders  |  | - SL/TP suggest |
| - Capital mgmt  |  | - Fill engine       |  | - Risk analysis |
| - Cash flow     |  | - Matching engine   |  | - Market regime |
| - P&L tracking  |  | - Virtual balance   |  | - Position review|
+---------+-------+  +---------+-----------+  +--------+--------+
          |                    |                        |
          +--------------------+------------------------+
                               |
                    +----------v-----------+
                    |   SHARED KERNEL      |
                    |                      |
                    | - Market Data Layer  |
                    | - User/Auth          |
                    | - Notifications      |
                    | - WebSocket          |
                    | - Fee/Tick engines   |
                    | - Risk Calculator    |
                    +----------------------+
                               |
                    +----------v-----------+
                    |   DATA LAYER         |
                    |   PostgreSQL          |
                    +----------------------+
```

## Component Boundaries

### 1. Portfolio Context (Real Order Tracking)

**Responsibility:** Quan ly lenh THAT da dat tren san, theo doi von, tinh P&L thuc te.

| Component | File Location | Responsibility |
|-----------|--------------|----------------|
| PortfolioController | `controllers/portfolio.controller.js` | CRUD portfolio, capital flow |
| RealOrderController | `controllers/realOrder.controller.js` (NEW) | Ghi nhan lenh that: BUY/SELL da dat tren san |
| RealPositionController | `controllers/realPosition.controller.js` (NEW) | Position tu lenh that, theo doi P&L thuc te |
| CapitalService | `services/capitalService.js` (NEW) | Phan bo von, available cash, margin |
| Portfolio model | `models/Portfolio.js` | Portfolio data + capital fields |
| RealOrder model | `models/RealOrder.js` (NEW) | Lenh that: entry_price, filled_price, broker_ref |
| RealPosition model | `models/RealPosition.js` (NEW) | Vi the that: current price, unrealized P&L |

**Key rules:**
- KHONG co fill engine, KHONG gia lap khop lenh
- User nhap lenh da dat (manual entry): "Toi da mua 100 VNM tai 85,000 VND"
- He thong GHI NHAN va THEO DOI, khong THUC THI
- Capital allocation: tru tien khi nhap lenh mua, cong tien khi nhap lenh ban
- AI tu van phan bo von dua tren tong portfolio

**Communicates with:**
- Shared Kernel: Market Data (lay gia hien tai de tinh unrealized P&L)
- Shared Kernel: Risk Calculator (tinh risk cua portfolio thuc te)
- AI Services: Nhan tu van SL/TP, phan bo von
- Shared Kernel: Notifications (canh bao SL/TP cho lenh that)

### 2. Paper Trading Context (Simulation)

**Responsibility:** Mo phong dat lenh, khop lenh, de user tap choi chung khoan.

| Component | File Location | Responsibility |
|-----------|--------------|----------------|
| PaperOrderController | `controllers/paperOrder.controller.js` (RENAME from order.controller.js) | Dat lenh mo phong |
| PaperPositionController | `controllers/paperPosition.controller.js` (RENAME from position.controller.js) | Position mo phong |
| FillEngine | `services/fillEngine.js` (KEEP, move to paper context) | Khop lenh gia lap |
| MatchingEngine | `services/matchingEngine.js` (NEW, future) | Orderbook matching realistic |
| PaperPortfolio model | `models/PaperPortfolio.js` (NEW) | Virtual balance, virtual positions |
| PaperOrder model | `models/PaperOrder.js` (RENAME from Order.js) | Lenh mo phong voi simulation_mode |
| PaperPosition model | `models/PaperPosition.js` (RENAME from Position.js) | Vi the mo phong |

**Key rules:**
- CO fill engine: INSTANT mode (hien tai) + REALISTIC mode (future)
- Virtual balance: tien gia, khong anh huong von that
- Orderbook gia (future): delay khop lenh, partial fill
- Worker stopLossMonitor chi theo doi paper positions
- Tach rieng paper_portfolios table (virtual balance rieng)

**Communicates with:**
- Shared Kernel: Market Data (lay gia de fill engine chay)
- Shared Kernel: Fee/Tick engines (tinh phi mo phong)
- Shared Kernel: Risk Calculator (tinh risk cua paper portfolio)
- AI Services: Nhan tu van SL/TP cho paper positions
- Shared Kernel: WebSocket (broadcast paper position updates)

### 3. AI Services Context

**Responsibility:** Moi logic AI: suggest SL/TP, risk analysis, market regime, position review.

| Component | File Location | Responsibility |
|-----------|--------------|----------------|
| AiController | `controllers/ai.controller.js` (KEEP) | API endpoints cho AI features |
| AiService | `services/aiService.js` (KEEP) | Gemini integration + rule-based |
| StopLossAdvisor | `services/ai/stopLossAdvisor.js` (NEW, extract) | Dynamic SL adjustment |
| TakeProfitAdvisor | `services/ai/takeProfitAdvisor.js` (NEW, extract) | Probability-based TP |
| ScenarioSimulator | `services/ai/scenarioSimulator.js` (NEW, extract) | Monte Carlo simulation |
| CapitalAdvisor | `services/ai/capitalAdvisor.js` (NEW) | AI tu van phan bo von |
| AiRecommendation model | `models/AiRecommendation.js` (KEEP) | Luu tru AI suggestions |

**Key rules:**
- AI services la STATELESS: nhan input (symbol, candles, portfolio data), tra output (suggestions)
- KHONG biet context goi la Portfolio hay Paper Trading -- consumer tu quyet dinh
- Rule-based cho calculations (deterministic), Gemini cho text analysis (non-deterministic)
- Rate limiting Gemini calls (da co model_inference_logs de track)

**Communicates with:**
- Shared Kernel: Market Data (lay OHLCV candles, current price)
- Portfolio Context: Nhan request tu van, tra lai suggestions
- Paper Trading Context: Nhan request tu van, tra lai suggestions
- Shared Kernel: Notifications (gui AI alerts)

### 4. Shared Kernel

**Responsibility:** Infrastructure dung chung, KHONG co business logic cua rieng context nao.

| Component | File Location | Responsibility |
|-----------|--------------|----------------|
| MarketDataService | `services/marketPriceService.js` (KEEP) | VPBS API wrapper, cache price |
| MarketController | `controllers/market.controller.js` (KEEP) | Market data endpoints |
| WebSocketService | `services/websocket.js` (KEEP) | Real-time broadcast |
| NotificationService | `services/notificationService.js` (KEEP) | Notification creation |
| RiskCalculator | `services/riskCalculator.js` (KEEP) | Position/portfolio risk tinh toan |
| FeeEngine | `services/feeEngine.js` (KEEP) | Trading fee calculations |
| TickSizeEngine | `services/tickSizeEngine.js` (KEEP) | Price normalization |
| SlippageCalculator | `services/slippageCalculator.js` (KEEP) | Slippage cho ca real va paper |
| Auth middleware | `middleware/auth.js` (KEEP) | JWT verification |
| Database | `config/database.js` (KEEP) | PostgreSQL pool |

**Key rules:**
- Shared Kernel phai NHO: chi infrastructure + utilities
- KHONG co business decisions trong shared kernel
- Moi context import tu shared, KHONG import tu context khac
- Market Data Layer la singleton: 1 source of truth cho gia

## Data Flow

### Flow 1: Portfolio -- Nhap Lenh That

```
User nhap lenh da dat tren san
    |
    v
[PortfolioView] --POST /api/portfolio/:id/real-orders-->
    |
    v
[RealOrderController]
    |-- validate input (symbol, price, qty, side, broker info)
    |-- CapitalService.deductCapital(portfolioId, amount)
    |-- RealOrder.create({...status: 'RECORDED'})
    |-- RealPosition.create({entryPrice, qty, ...})
    |-- NotificationService.notify('POSITION_OPENED')
    |-- WebSocket.broadcastPortfolioUpdate()
    v
[Response: position created, capital updated]
```

### Flow 2: Paper Trading -- Dat Lenh Mo Phong

```
User dat lenh paper trading
    |
    v
[PaperTradingView] --POST /api/paper-trading/:id/orders-->
    |
    v
[PaperOrderController]
    |-- validate input
    |-- PaperOrder.create({...status: 'PENDING'})
    |
    |-- if simulation_mode == 'INSTANT':
    |     FillEngine.fillInstant(order)
    |     PaperPosition.create({...from filled order})
    |     PaperPortfolio.deductVirtualBalance()
    |
    |-- if simulation_mode == 'REALISTIC':
    |     (order stays PENDING, worker picks up later)
    |
    |-- NotificationService.notify()
    |-- WebSocket.broadcast()
    v
[Response: order placed/filled]
```

### Flow 3: AI Suggest SL/TP (Shared -- ca 2 context deu dung)

```
User request AI suggestion (tu Portfolio hoac Paper Trading)
    |
    v
[Any View] --POST /api/ai/suggest-sltp-->
    |
    v
[AiController.suggestSlTp()]
    |-- MarketDataService.getOHLCV(symbol, 60 days)
    |-- StopLossAdvisor.calculate(candles, entryPrice, side)
    |-- TakeProfitAdvisor.calculate(candles, entryPrice, side)
    |-- AiService.callGemini(context) -- text explanation
    |-- AiRecommendation.create({...suggestions})
    v
[Response: {suggestions: [aggressive, moderate, conservative], analysis_text}]
    |
    v
User chon level -> apply vao Real Order HOAC Paper Order
```

### Flow 4: Background Worker -- Stop Loss Monitor

```
[stopLossMonitor] runs every 2 minutes
    |
    |-- PaperPosition.findAllOpen() -- CHI paper positions
    |-- for each position:
    |     MarketDataService.getLatestCandle(symbol)
    |     StopLossResolver.check(position, candle)
    |     if triggered:
    |       SlippageCalculator.calculate()
    |       PaperPosition.close(closedPrice, pnl)
    |       NotificationService.notify('SL_TRIGGERED')
    |       WebSocket.broadcast()
    |
    |-- RealPosition.findAllOpen() -- real positions
    |-- for each position:
    |     MarketDataService.getLatestCandle(symbol)
    |     StopLossResolver.check(position, candle) -- CHI CANH BAO, khong tu dong close
    |     if triggered:
    |       NotificationService.notify('SL_ALERT_REAL', {message: 'SL da cham, ban nen xem xet'})
    |       -- KHONG tu dong close, vi day la lenh that tren san
    v
```

### Flow 5: Market Data (Shared Singleton)

```
[Any Context] --request price/candles-->
    |
    v
[MarketDataService] (singleton, cached)
    |-- cache layer (in-memory, TTL 30s cho current price)
    |-- VPBS API call (if cache miss)
    |-- normalize price (VPBS thousands -> VND)
    v
[Return: {price, ohlcv, timestamp}]
    |
    v
[WebSocket] broadcasts to subscribed clients
```

## Database Schema Changes

### Approach: Them `context` column, KHONG tach table ngay

Thay vi tao bang moi ngay (breaking change lon), them discriminator column:

```sql
-- Option A (recommended for Phase 1): Add context column
ALTER TABLE financial.portfolios
  ADD COLUMN IF NOT EXISTS context VARCHAR(20) NOT NULL DEFAULT 'PAPER'
  CHECK (context IN ('REAL', 'PAPER'));

ALTER TABLE financial.orders
  ADD COLUMN IF NOT EXISTS context VARCHAR(20) NOT NULL DEFAULT 'PAPER'
  CHECK (context IN ('REAL', 'PAPER'));

ALTER TABLE financial.positions
  ADD COLUMN IF NOT EXISTS context VARCHAR(20) NOT NULL DEFAULT 'PAPER'
  CHECK (context IN ('REAL', 'PAPER'));
```

**Tai sao `context` column thay vi tach table:**
1. Migration nhe: 1 ALTER TABLE thay vi tao 3 table moi + migrate data
2. Shared queries van hoat dong (vi du: risk calculator query positions by portfolio_id)
3. Reporting de hon: query across contexts khi can
4. Chuyen doi tu tu: code cu van chay, code moi filter theo context

**Phase 2 (optional):** Neu performance can, tach table sau. Nhung voi quy mo hien tai (personal tool, khong phai SaaS), context column la du.

### Real Order -- Bo sung columns

```sql
-- Real orders can them:
ALTER TABLE financial.orders
  ADD COLUMN IF NOT EXISTS broker_ref VARCHAR(100),     -- Ma lenh tren san
  ADD COLUMN IF NOT EXISTS broker_name VARCHAR(50),     -- Ten cong ty CK
  ADD COLUMN IF NOT EXISTS actual_filled_at TIMESTAMPTZ, -- Thoi gian khop that
  ADD COLUMN IF NOT EXISTS manual_entry BOOLEAN DEFAULT FALSE;
```

### Paper Trading -- Bo sung columns

```sql
-- Paper portfolios can them:
ALTER TABLE financial.portfolios
  ADD COLUMN IF NOT EXISTS virtual_balance NUMERIC(20,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS initial_virtual_balance NUMERIC(20,2) DEFAULT 0;
```

## Directory Structure (Target)

```
ai-stoploss-engine-be/
  services/
    shared/                     # Shared Kernel
      marketDataService.js      # VPBS API wrapper (rename from marketPriceService)
      riskCalculator.js
      feeEngine.js
      tickSizeEngine.js
      slippageCalculator.js
      notificationService.js
      websocket.js
    portfolio/                  # Portfolio Context
      capitalService.js         # NEW: capital allocation
      realOrderService.js       # NEW: real order business logic
      realPositionService.js    # NEW: real position tracking
    paper/                      # Paper Trading Context
      fillEngine.js             # MOVE from services/
      paperOrderService.js      # NEW: paper order business logic
      paperPositionService.js   # NEW: paper position tracking
      matchingEngine.js         # FUTURE: realistic orderbook
    ai/                         # AI Services Context
      aiService.js              # KEEP (rename/move)
      stopLossAdvisor.js        # NEW: extract from aiService
      takeProfitAdvisor.js      # NEW: extract from aiService
      scenarioSimulator.js      # NEW: Monte Carlo
      capitalAdvisor.js         # NEW: AI capital allocation
  controllers/
    shared/
      market.controller.js
      notifications.controller.js
    portfolio/
      portfolio.controller.js
      realOrder.controller.js   # NEW
      realPosition.controller.js # NEW
    paper/
      paperOrder.controller.js  # RENAME from order.controller.js
      paperPosition.controller.js # RENAME from position.controller.js
    ai/
      ai.controller.js
  routes/
    portfolio.routes.js         # Real portfolio routes
    paperTrading.routes.js      # Paper trading routes (NEW)
    ai.routes.js
    market.routes.js
    ...
  workers/
    stopLossMonitor.js          # Refactor: separate real vs paper logic
    paperFillWorker.js          # NEW: fill PENDING paper orders
```

## Patterns to Follow

### Pattern 1: Context-Aware Service Calls

Services nhan `context` parameter de biet flow nao dang goi.

```javascript
// services/shared/riskCalculator.js
class RiskCalculator {
  static async validatePosition(portfolioId, positionData, context = 'PAPER') {
    const positions = await Position.findByPortfolio(portfolioId, { context });
    // ... calculation logic GIONG NHAU cho ca 2 context
    return { isValid, riskUsage, message };
  }
}
```

### Pattern 2: Strategy Pattern cho Order Processing

```javascript
// services/portfolio/realOrderService.js
class RealOrderService {
  static async createOrder(portfolioId, orderData) {
    // KHONG fill engine -- chi ghi nhan
    const order = await Order.create({ ...orderData, context: 'REAL', status: 'RECORDED' });
    const position = await Position.create({
      ...fromOrder(order),
      context: 'REAL',
      status: 'OPEN'
    });
    await CapitalService.deductCapital(portfolioId, order.quantity * order.entryPrice);
    return { order, position };
  }
}

// services/paper/paperOrderService.js
class PaperOrderService {
  static async createOrder(portfolioId, orderData) {
    const order = await Order.create({ ...orderData, context: 'PAPER', status: 'PENDING' });
    if (orderData.simulationMode === 'INSTANT') {
      return await FillEngine.fillInstant(order);
    }
    return { order, status: 'PENDING' };
  }
}
```

### Pattern 3: Shared Market Data Singleton

```javascript
// services/shared/marketDataService.js
class MarketDataService {
  #cache = new Map();
  #TTL = 30_000; // 30 seconds

  async getCurrentPrice(symbol, exchange = 'HOSE') {
    const key = `${symbol}:${exchange}`;
    const cached = this.#cache.get(key);
    if (cached && Date.now() - cached.ts < this.#TTL) return cached.data;

    const data = await this.#fetchFromVPBS(symbol, exchange);
    this.#cache.set(key, { data, ts: Date.now() });
    return data;
  }
}

// Singleton export
export default new MarketDataService();
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Cross-Context Direct Imports

```javascript
// BAD: Paper trading import truc tiep tu portfolio context
import { CapitalService } from '../portfolio/capitalService.js';

// GOOD: Dung shared kernel hoac event
import { RiskCalculator } from '../shared/riskCalculator.js';
```

### Anti-Pattern 2: Context Logic trong Shared Kernel

```javascript
// BAD: Shared kernel biet ve specific context
class RiskCalculator {
  static validate(portfolio) {
    if (portfolio.context === 'REAL') {
      // real-specific logic HERE -> vi pham boundary
    }
  }
}

// GOOD: Shared kernel chi lam generic calculation
// Context-specific logic o trong context service
```

### Anti-Pattern 3: God Controller

```javascript
// BAD: 1 controller xu ly ca real va paper
class PositionController {
  async create(req, res) {
    if (req.body.context === 'REAL') { ... }
    else { ... }
  }
}

// GOOD: Tach rieng controller, route rieng
// POST /api/portfolio/:id/positions -> RealPositionController
// POST /api/paper-trading/:id/orders -> PaperOrderController
```

## Suggested Build Order

Dependencies giua cac phases -- xay tu duoi len:

```
Phase 1: Shared Kernel Cleanup
  |  (restructure directories, extract shared services)
  |  (add context column to DB)
  |  Dependencies: NONE -- foundation
  v
Phase 2: Portfolio Context (Real Order Tracking)
  |  (new controllers, services, routes for real orders)
  |  (capital management)
  |  Dependencies: Phase 1 (shared kernel ready)
  v
Phase 3: Paper Trading Context Isolation
  |  (rename/move existing order/position code)
  |  (add virtual balance)
  |  Dependencies: Phase 1 (shared kernel ready)
  |  NOTE: Phase 2 va 3 co the chay SONG SONG
  v
Phase 4: AI Services Enhancement
  |  (extract advisors, improve SL/TP/Scenario)
  |  Dependencies: Phase 1 (shared kernel)
  |  NOTE: Co the bat dau song song tu Phase 2
  v
Phase 5: Integration & Polish
     (connect all contexts, UI updates, testing)
     Dependencies: Phase 2 + 3 + 4
```

**Rationale cho thu tu:**
1. **Phase 1 truoc** vi moi context deu phu thuoc vao shared kernel sach
2. **Phase 2 + 3 song song** vi 2 context doc lap, khong phu thuoc nhau
3. **Phase 4 song song** vi AI services la stateless, chi can shared kernel
4. **Phase 5 cuoi** vi can tat ca context san sang de integrate

## Communication Between Components

| From | To | Method | When |
|------|----|--------|------|
| Portfolio Context | Shared: Market Data | Direct import | Lay gia hien tai cho P&L |
| Portfolio Context | AI Services | HTTP API call | Request AI suggestion |
| Paper Trading | Shared: Market Data | Direct import | Fill engine can gia |
| Paper Trading | Shared: Fee Engine | Direct import | Tinh phi mo phong |
| Paper Trading | AI Services | HTTP API call | Request AI suggestion |
| AI Services | Shared: Market Data | Direct import | Lay OHLCV cho analysis |
| Worker | Paper Trading | Direct import | Monitor paper positions |
| Worker | Portfolio Context | Direct import | Monitor real positions (alert only) |
| Any Context | Shared: WebSocket | Direct import | Broadcast updates |
| Any Context | Shared: Notifications | Direct import | Create notifications |

**Communication rules:**
- **Direct import** cho Shared Kernel services (same process, no overhead)
- **HTTP API** khi frontend goi backend (standard REST)
- **WebSocket** cho real-time push tu backend -> frontend
- **KHONG** dung message queue hay event bus (overkill cho monolith)

## Sources

- [DDD with trading example - Medium](https://medium.com/@kbsaravanan/domain-driven-design-explained-with-electronic-trading-example-923253a132c)
- [Clarifying DDD Using Trading Application - InfoQ](https://www.infoq.com/news/2015/03/ddd-trading-example/)
- [Bounded Context - Martin Fowler](https://martinfowler.com/bliki/BoundedContext.html)
- [Quant Trading System Architecture - mbrenndoerfer](https://mbrenndoerfer.com/writing/quant-trading-system-architecture-infrastructure)
- [OMS Architecture - Databento](https://databento.com/microstructure/oms)
- [Trading Platform Development 2025-2026 - ETNA](https://www.etnasoft.com/trading-platform-development-2025-2026-playbook-for-u-s-broker-dealers-rias/)
- Codebase analysis: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`

---

*Architecture research: 2026-03-26*
