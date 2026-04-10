# Architecture

**Analysis Date:** 2026-03-26

## Pattern Overview

**Overall:** Distributed Trading System with AI Integration and Real-time Monitoring

**Key Characteristics:**
- Full-stack React + Express monorepo with separated frontend (`ai-stoploss-engine-fe`) and backend (`ai-stoploss-engine-be`)
- Event-driven architecture with WebSocket for real-time updates
- Background workers for autonomous trading operations
- AI-powered analytics via Google Gemini integration
- Multi-layer service-based backend with domain-specific calculators
- Client-side SPA with view-based component organization

## Layers

**Presentation Layer (Frontend):**
- Purpose: User interface for trading terminal, portfolio management, AI signals, and market analysis
- Location: `ai-stoploss-engine-fe/components/`
- Contains: React TSX components organized as views (AuthView, DashboardView, TradingTerminal, PortfolioView, WatchlistView, AiSignalsView, SettingsView, NotificationsView)
- Depends on: Services layer (API, WebSocket)
- Used by: Browser clients

**API Layer (Backend Routes):**
- Purpose: HTTP endpoint routing and request dispatch
- Location: `ai-stoploss-engine-be/routes/`
- Contains: 10+ route modules (auth.routes.js, portfolio.routes.js, position.routes.js, market.routes.js, ai.routes.js, etc.)
- Depends on: Controller layer
- Used by: Frontend clients, external systems

**Controller Layer (Request Handlers):**
- Purpose: Validate incoming requests, orchestrate business logic, format responses
- Location: `ai-stoploss-engine-be/controllers/`
- Contains: 9 controller files (auth.controller.js, position.controller.js, ai.controller.js, market.controller.js, order.controller.js, etc.)
- Depends on: Service layer, Model layer
- Used by: Routes

**Service Layer (Business Logic):**
- Purpose: Core domain logic including AI recommendations, risk calculations, order execution simulation, price monitoring, and notifications
- Location: `ai-stoploss-engine-be/services/`
- Contains:
  - `aiService.js` - Google Gemini integration for signal suggestions, trend analysis, risk evaluation
  - `riskCalculator.js` - Position risk calculation in VND (Vietnamese Dong)
  - `stopLossResolver.js` - Stop-loss trigger detection and resolution
  - `slippageCalculator.js` - Slippage calculation for different scenarios
  - `fillEngine.js` - Pending order fill simulation at market prices
  - `priceAlertMonitor.js` - Continuous price monitoring for alerts
  - `notificationService.js` - Notification persistence and creation
  - `tickSizeEngine.js` - Stock-specific tick size rules for Vietnam exchanges
  - `websocket.js` - Real-time broadcast system for portfolio/price updates
  - `feeEngine.js` - Trading fee calculations
  - `marketPriceService.js` - Market data aggregation
  - `cafefNewsService.js` - Market news scraping
- Depends on: Model layer, Database layer
- Used by: Controllers, Workers

**Model Layer (Data Access):**
- Purpose: Database CRUD operations and queries with business context
- Location: `ai-stoploss-engine-be/models/`
- Contains: 7 model files (User.js, Portfolio.js, Position.js, Order.js, Notification.js, AiRecommendation.js, ExecutionLog.js)
- Depends on: Database layer
- Used by: Controllers, Services

**Worker Layer (Background Processing):**
- Purpose: Autonomous monitoring of positions for stop-loss/take-profit triggers and order fills
- Location: `ai-stoploss-engine-be/workers/`
- Contains: `stopLossMonitor.js` - Runs every 2 minutes to check OHLCV candles, calculate slippage, resolve conflicts between SL/TP
- Depends on: Service layer, Model layer
- Used by: Entry point (index.js) during server startup

**Data Access Layer (Database):**
- Purpose: PostgreSQL connection pooling and query execution
- Location: `ai-stoploss-engine-be/config/database.js`
- Contains: Connection pool management with configurable min/max connections
- Depends on: pg (PostgreSQL client)
- Used by: Model layer, all database operations

**Middleware Layer (Request/Response Processing):**
- Purpose: Cross-cutting concerns including authentication, validation, error handling
- Location: `ai-stoploss-engine-be/middleware/`
- Contains: 3 middleware files (auth.js - JWT verification, errorHandler.js - error formatting, validation.js - Joi schema validation)
- Depends on: jsonwebtoken, Joi
- Used by: Routes

**Client Service Layer (Frontend):**
- Purpose: HTTP client and WebSocket management for real-time data
- Location: `ai-stoploss-engine-fe/services/`
- Contains:
  - `api.ts` - Axios instance with JWT interceptors and typed endpoints (portfolioApi, positionApi, marketApi, aiApi, authApi)
  - `websocket.ts` - Socket.IO client for real-time portfolio/price updates
  - `geminiService.ts` - Direct Gemini API calls for trader analysis
- Depends on: axios, socket.io-client, @google/genai
- Used by: Frontend components

## Data Flow

**User Authentication Flow:**

1. User submits email/password via `AuthView.tsx`
2. Frontend calls `authApi.register()` or `authApi.login()` (api.ts)
3. `POST /api/auth/register` or `POST /api/auth/login` → `auth.routes.js`
4. `AuthController.register()` or `AuthController.login()` validates and creates/verifies user
5. `User.findByEmail()` queries database via `User.js` model
6. `bcrypt` hashes password; `jsonwebtoken` creates JWT token
7. Token stored in localStorage on frontend, used in subsequent API calls via Axios interceptor
8. Frontend redirects to authenticated view (Dashboard, Portfolio, etc.)

**Portfolio Creation Flow:**

1. User creates portfolio via `PortfolioView.tsx` → calls `portfolioApi.create()`
2. `POST /api/portfolios` → `portfolio.routes.js` → `PortfolioController.createPortfolio()`
3. `Portfolio.create()` inserts record, calculates `total_balance`, `max_risk_percent`
4. Database stores portfolio with user_id, timestamps
5. `RiskCalculator` validates max_risk_percent (typically 2-5% of total_balance)
6. Frontend receives portfolio object, stores in React state
7. WebSocket auto-subscribes to `portfolio:{portfolioId}` room for real-time updates

**Position Entry Flow:**

1. Trader selects symbol and enters position details in `TradingTerminal.tsx` → calls `positionApi.createPosition()`
2. `POST /api/portfolios/:portfolioId/positions` → `position.routes.js` → `PositionController.createPosition()`
3. **Price Normalization:** Market price from VPBS (Vietnam stock exchange) returned in thousands → converted to VND (multiplied by 1000)
4. **Risk Validation:** `RiskCalculator.validatePositionAgainstRisk()` ensures new position risk ≤ portfolio max_risk_percent
5. **Fee Calculation:** `feeEngine.calculateFees()` computes trading fees based on quantity and exchange rules
6. **Position Creation:** `Position.create()` inserts with entry_price (VND), stop_loss, take_profit, quantity, and stop_type (FIXED, TRAILING, ATR, etc.)
7. **Execution Log:** `ExecutionLog` records creation event
8. **Notification:** `notificationService.createNotification()` sends to user via WebSocket
9. Real-time broadcast: `broadcastPortfolioUpdate()` notifies all connected clients subscribing to portfolio

**Stop-Loss Monitor Flow (Background Worker):**

1. Worker starts via `startWorker()` in `index.js` - runs every 2 minutes (configurable)
2. Worker fetches all OPEN positions: `Position.findAllOpen()`
3. For each position, fetches latest OHLCV candle from `marketPriceService`
4. **Trigger Detection:** Checks if candle.high or candle.low touches stop_loss or take_profit
5. **Conflict Resolution:** If both SL and TP trigger in same candle, `resolveConflict()` triggers whichever is closer
6. **Slippage Calculation:** Depending on position.side (LONG/SHORT) and trigger type:
   - `calcLongSLSlippage()` if long position hits SL
   - `calcShortSLSlippage()` if short position hits SL
   - Similarly for take_profit
7. **P&L Calculation:** Slippage + fees = total cost; closed_price - entry_price - slippage - fees = net_pnl_vnd
8. **Position Close:** `Position.updateStatus()` sets status to CLOSED_SL or CLOSED_TP
9. **Notification & Portfolio Update:**
   - Create notification with close details
   - Broadcast to user and portfolio subscribers
   - Update portfolio risk status
10. **Trailing Stop Update:** After close check, update `trailing_current_stop` if position remains open
11. **Circuit Breaker:** On API errors, pause worker briefly; after 3 consecutive failures, pause 5 minutes

**AI Signal Analysis Flow:**

1. User navigates to `AiSignalsView.tsx` → requests signals via `aiApi.getAiSignals()`
2. `GET /api/ai/signals` → `ai.routes.js` → `AiController.getAiSignals()`
3. Fetches recent AI recommendations from database: `AiRecommendation.findRecent()`
4. Controller returns combined signals with current portfolio positions
5. Frontend displays signals with visualizations

**AI Recommendation Generation Flow:**

1. Trader enters position details and symbol in `TradingTerminal.tsx`
2. Frontend calls `aiApi.suggestSltP()` with symbol, entry price, recent candles
3. `POST /api/ai/suggest-sltp` → `AiController.suggestSltP()`
4. **Rule-Based Calculation:** `aiService.suggestSltPv2()` uses ATR (Average True Range) to calculate technical levels
5. **Gemini Text Analysis:** Sends technical analysis request to Google Gemini for human-readable explanation
6. Controller stores recommendation in `AiRecommendation` table with:
   - entry_price, suggested_sl, suggested_tp
   - atr_value, resistance_level, support_level
   - gemini_explanation (text from Gemini)
7. Returns JSON with suggested prices and explanation to frontend
8. Frontend displays with visualization and user confirms or adjusts

**Real-Time Updates via WebSocket:**

1. Frontend connects to `ws://server:port/socket.io` with JWT token (`websocket.ts`)
2. Backend `initializeWebSocket()` verifies token and joins user room: `user:{userId}`
3. Frontend manually subscribes to portfolio and symbol rooms: `socket.emit('subscribe_portfolio', portfolioId)`
4. Backend worker or controller broadcasts updates:
   - `broadcastPortfolioUpdate(portfolioId, data)` → emits to `portfolio:{portfolioId}` room
   - `broadcastPriceUpdate(symbol, priceData)` → emits to `symbol:{symbol}` room
   - `broadcastNotification(userId, notification)` → emits to `user:{userId}` room
5. Frontend components listen to WebSocket events and re-render with latest data

## Key Abstractions

**RiskCalculator:**
- Purpose: Centralized risk calculation across positions and portfolio
- Examples: `ai-stoploss-engine-be/services/riskCalculator.js`
- Pattern: Static methods with VND as universal unit; all calculations in Vietnamese Dong to avoid float precision issues

**StopLossResolver:**
- Purpose: Determine when a position should close based on OHLCV candles
- Examples: `ai-stoploss-engine-be/services/stopLossResolver.js`
- Pattern: Returns decision object with close_type, close_price, and reason

**TickSizeEngine:**
- Purpose: Apply exchange-specific tick size rules (Vietnam stocks have fractional rules per symbol)
- Examples: `ai-stoploss-engine-be/services/tickSizeEngine.js`
- Pattern: Snap price to nearest valid tick; differentiate between stock and derivative

**SlippageCalculator:**
- Purpose: Calculate execution slippage when position closes beyond intended level
- Examples: `ai-stoploss-engine-be/services/slippageCalculator.js`
- Pattern: Direction-aware (LONG vs SHORT) with separate methods for SL and TP slippage

**FillEngine:**
- Purpose: Simulate pending limit orders and expire end-of-session orders
- Examples: `ai-stoploss-engine-be/services/fillEngine.js`
- Pattern: Check order against latest market price and fill if price matches; handle order expiry

**AIService:**
- Purpose: Integrate Google Gemini for natural language analysis and recommendations
- Examples: `ai-stoploss-engine-be/services/aiService.js`
- Pattern: Helper function `callGeminiJSON()` cleans response, extracts JSON from markdown fences, parses safely; domain functions wrap with context

**Portfolio Views (Frontend):**
- Purpose: Aggregate and display different perspectives on trading activity
- Examples: DashboardView, PortfolioView, WatchlistView, AiSignalsView, TradingTerminal
- Pattern: Each view is a large component with internal state (positions, portfolio data) fetched via API on mount; refetch on user actions

## Entry Points

**Backend Server Entry:**
- Location: `ai-stoploss-engine-be/index.js`
- Triggers: `npm run dev` or `npm start` or `node index.js`
- Responsibilities:
  1. Load environment via dotenv
  2. Create Express app with CORS and JSON middleware
  3. Test PostgreSQL database connection
  4. Initialize WebSocket server on HTTP server
  5. Start price alert monitor service
  6. Start stop-loss worker process
  7. Listen on PORT (default 3000)

**Frontend App Entry:**
- Location: `ai-stoploss-engine-fe/index.tsx`
- Triggers: `npm run dev` (Vite dev server)
- Responsibilities:
  1. Load saved theme from localStorage (dark by default)
  2. Render React app into `#root` DOM element
  3. Mount `App.tsx` component tree

**App Component (Frontend Root):**
- Location: `ai-stoploss-engine-fe/App.tsx`
- Triggers: Rendered by index.tsx
- Responsibilities:
  1. Global state management for current view, user auth, portfolio selection
  2. Route logic (conditional rendering of AuthView vs dashboard views)
  3. Initialize WebSocket connection
  4. Fetch user data on mount and keep auth token valid
  5. Error boundary wrapping (AppErrorBoundary)

**HTML Entry:**
- Location: `ai-stoploss-engine-fe/index.html`
- Contains: Root div with id="root", script tag referencing index.tsx

## Error Handling

**Strategy:** Multi-layer error handling with graceful degradation

**Patterns:**

**Backend:**
- Controllers use try-catch blocks; throw errors with explicit statusCode
- Middleware `errorHandler.js` catches all errors, formats JSON responses
- Joi validation errors return 400 with field-level details
- PostgreSQL errors (unique violations, foreign keys) mapped to specific HTTP status (409 for conflicts, 400 for invalid refs)
- Worker circuit breaker: pause on 3 consecutive API failures, reset after 5 minutes
- Database connection pool retries transient errors automatically

**Frontend:**
- `AppErrorBoundary.tsx` wraps entire app, catches React rendering errors
- API calls wrapped in try-catch; display user-friendly error messages
- WebSocket disconnect handled gracefully; reconnect on next server availability
- Missing portfolio/position shows 404 view rather than crash
- localStorage fallback for theme and auth token; clears token on 401 from API

## Cross-Cutting Concerns

**Logging:**
- Backend uses console.log with timestamp prefix `[${new Date().toISOString()}]`
- Frontend logs via browser console for debugging
- LOG_LEVEL env var (debug/info/error) controls verbosity

**Validation:**
- Backend: Joi schema validation in controllers for all input (email, password, amounts, etc.)
- Frontend: Basic browser form validation; API returns 400 with field errors
- Database models: Constraints at SQL level (NOT NULL, UNIQUE, CHECK, FOREIGN KEY)

**Authentication:**
- JWT tokens issued on login; stored in localStorage on frontend
- Bearer token passed in Authorization header for all authenticated requests
- Backend verifies token in `auth.middleware.js` before controller execution
- WebSocket token optional; allows anonymous connections for market data

**Currency Handling:**
- All monetary values stored and calculated in VND (Vietnamese Dong) at backend
- Frontend receives VND values; displays with Vietnamese number formatting (comma separators)
- VPBS market prices arrive in thousands; converted to VND immediately on receipt
- No floating-point arithmetic; use parseInt/parseFloat with explicit precision (toFixed(2))

**Real-Time Updates:**
- WebSocket rooms per user, portfolio, and symbol
- Subscribers automatically receive broadcasts
- Frontend maintains subscription state (which portfolios/symbols to listen to)
- Worker broadcasts after position state changes (close, trailing stop update, fill)

---

*Architecture analysis: 2026-03-26*
