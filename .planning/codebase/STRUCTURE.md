# Codebase Structure

**Analysis Date:** 2026-03-26

## Directory Layout

```
ai-stoploss-engine-web/
├── ai-stoploss-engine-be/           # Backend (Express + Node.js)
│   ├── config/                      # Configuration modules
│   ├── controllers/                 # Request handlers (9 files)
│   ├── middleware/                  # Cross-cutting concerns (auth, errors, validation)
│   ├── models/                      # Data access layer (7 models)
│   ├── routes/                      # HTTP routing (10 route files)
│   ├── services/                    # Business logic (13 service files)
│   ├── workers/                     # Background processes (stop-loss monitor)
│   ├── migrations/                  # Database schema migrations
│   ├── scripts/                     # CLI tools for database management
│   ├── logs/                        # Runtime logs directory
│   ├── index.js                     # Main entry point
│   ├── package.json                 # Dependencies
│   └── README.md                    # Backend documentation
│
├── ai-stoploss-engine-fe/           # Frontend (React + TypeScript + Vite)
│   ├── components/                  # React components organized by view
│   │   ├── *View.tsx               # View components (18+ views)
│   │   ├── charts/                 # Chart components
│   │   └── *.tsx                   # Small UI components
│   ├── services/                    # API client and integrations
│   ├── utils/                       # Helper functions and validators
│   ├── chart-plugins/              # Custom chart plugin helpers
│   ├── public/                      # Static assets
│   ├── image/                       # Image assets
│   ├── App.tsx                      # Root component
│   ├── index.tsx                    # React entry point
│   ├── index.html                   # HTML template
│   ├── index.css                    # Global styles (Tailwind)
│   ├── types.ts                     # TypeScript interface definitions
│   ├── constants.ts                 # Market data and display constants
│   ├── vite.config.ts              # Vite build configuration
│   ├── tsconfig.json               # TypeScript configuration
│   ├── package.json                 # Dependencies
│   └── README.md                    # Frontend documentation
│
└── .planning/                       # GSD planning and documentation
    └── codebase/                    # This documentation
        └── *.md                     # Architecture analysis documents
```

## Directory Purposes

**Backend: config/**
- Purpose: Configuration and service initialization
- Contains: `database.js` (PostgreSQL pool with retry logic)
- Key files: `ai-stoploss-engine-be/config/database.js`

**Backend: controllers/**
- Purpose: HTTP request handlers that validate input and orchestrate business logic
- Contains: 9 controller files
  - `auth.controller.js` - User registration, login, logout
  - `portfolio.controller.js` - Portfolio CRUD and risk status
  - `position.controller.js` - Position management (create, update, close, calculate)
  - `order.controller.js` - Order management (create, fill, expire, cancel)
  - `market.controller.js` - Market data retrieval and stock lookups (largest file ~80KB)
  - `ai.controller.js` - AI recommendation generation and signal retrieval
  - `notifications.controller.js` - User notifications CRUD
  - `watchlist.controller.js` - Watchlist management
  - `priceAlerts.controller.js` - Price alert setup and monitoring

**Backend: middleware/**
- Purpose: Cross-cutting concerns for all requests
- Contains:
  - `auth.js` - JWT token verification and userId extraction
  - `errorHandler.js` - Global error catching and JSON formatting
  - `validation.js` - Joi schema validation utilities

**Backend: models/**
- Purpose: Database CRUD operations and queries
- Contains: 7 model files
  - `User.js` - User accounts and authentication
  - `Portfolio.js` - Portfolio records with risk status view
  - `Position.js` - Trading positions with stop/take-profit types
  - `Order.js` - Pending and executed orders
  - `Notification.js` - User notifications
  - `AiRecommendation.js` - AI-generated suggestions
  - `ExecutionLog.js` - Record of position closes and executions

**Backend: routes/**
- Purpose: HTTP endpoint definitions and middleware application
- Contains: 10 route files mounted at `/api` prefix
  - `index.js` - Router aggregation (mounts all sub-routers)
  - `auth.routes.js` - POST /auth/register, POST /auth/login, GET /auth/me, POST /auth/logout
  - `portfolio.routes.js` - GET/POST /portfolios, GET/PUT/DELETE /portfolios/:id, GET /portfolios/:id/risk, nested position routes
  - `position.routes.js` - Nested under portfolio: GET/POST /positions, GET/PATCH /positions/:id
  - `order.routes.js` - Nested under portfolio: GET/POST /orders, DELETE /orders/:id
  - `market.routes.js` - GET /market/symbols, GET /market/stocks, GET /market/position-form-spec
  - `ai.routes.js` - POST /ai/suggest-sltp, GET /ai/signals, GET /ai/dashboard
  - `notifications.routes.js` - GET /notifications, PATCH /notifications/:id/read
  - `watchlist.routes.js` - GET/POST /watchlist, DELETE /watchlist/:symbol
  - `priceAlerts.routes.js` - GET/POST /price-alerts, DELETE /price-alerts/:id

**Backend: services/**
- Purpose: Reusable business logic and domain-specific calculations
- Contains: 13 service files
  - `aiService.js` (38KB) - Gemini integration, ATR calculation, signal suggestions
  - `riskCalculator.js` - Position risk in VND, portfolio risk validation
  - `stopLossResolver.js` - Determine if position should close based on candles
  - `slippageCalculator.js` - Calculate execution slippage for SL/TP
  - `fillEngine.js` - Simulate pending order fills and expiry
  - `feeEngine.js` - Calculate trading fees per exchange
  - `tickSizeEngine.js` - Snap prices to valid ticks per symbol
  - `priceAlertMonitor.js` - Monitor prices and trigger alerts
  - `notificationService.js` - Create and persist notifications
  - `websocket.js` - Socket.IO initialization and broadcast methods
  - `marketPriceService.js` - Fetch current market data
  - `marketNewsService.js` - News aggregation
  - `cafefNewsService.js` - CafeF news scraping

**Backend: workers/**
- Purpose: Background processes running independently of request/response cycle
- Contains: `stopLossMonitor.js` (21KB)
  - Runs every 2 minutes (cron: `*/2 * * * *`)
  - Checks all OPEN positions against OHLCV candles
  - Detects SL/TP triggers, calculates slippage, closes positions
  - Broadcasts updates via WebSocket
  - Includes circuit breaker for API failures

**Backend: migrations/**
- Purpose: Database schema version control
- Contains: 7 migration files for PostgreSQL schema evolution

**Backend: scripts/**
- Purpose: CLI tools for database setup and maintenance
- Contains: Scripts for migrations, seeding test data, clearing positions

**Frontend: components/**
- Purpose: React components organized by functional views
- Contains: 18+ view components and utility UI components
  - View Components (large, full-screen features):
    - `AuthView.tsx` - Login/registration form
    - `HomeView.tsx` - Welcome/onboarding screen
    - `DashboardView.tsx` - Market overview with indices and performance
    - `TradingTerminal.tsx` (96KB) - Main trading interface with candlestick charts
    - `PortfolioView.tsx` (40KB) - Portfolio and position management
    - `WatchlistView.tsx` (71KB) - Watched symbols and market data
    - `AiSignalsView.tsx` (20KB) - AI recommendations and signals
    - `AiMonitorPanel.tsx` (23KB) - AI trading monitor
    - `NotificationsView.tsx` (22KB) - Trade execution and system notifications
    - `SettingsView.tsx` (42KB) - User preferences and portfolio configuration
    - `RiskManagerView.tsx` - Risk limits and monitoring
    - `MarketNewsView.tsx` - Market news aggregation
  - Utility Components:
    - `Sidebar.tsx` - Main navigation
    - `TraderCard.tsx` - Profile display
    - `RiskProgressBar.tsx` - Risk meter visualization
    - `AppErrorBoundary.tsx` - Error catching and display
  - Sub-directory:
    - `charts/` - Chart visualization components
      - `CandlestickChart.tsx` - Lightweight-charts based candlestick with SMA

**Frontend: services/**
- Purpose: API client and service integrations
- Contains: 3 service files
  - `api.ts` (23KB) - Axios instance with JWT interceptors, typed endpoints (portfolioApi, positionApi, marketApi, aiApi, authApi)
  - `websocket.ts` (4KB) - Socket.IO client for real-time updates
  - `geminiService.ts` - Direct Gemini API calls (trader analysis)

**Frontend: utils/**
- Purpose: Helper functions and validators
- Contains: `vnStockRules.ts` - Vietnam stock market rules and validation

**Frontend: chart-plugins/**
- Purpose: Custom chart enhancements
- Contains: `helpers/dimensions/` - Chart dimension calculations

**Frontend: public/**
- Purpose: Static assets served as-is
- Contains: Favicons, manifest, public files

**Frontend: index.tsx**
- Purpose: React entry point
- Loads: Saved theme from localStorage, renders App to #root

**Frontend: App.tsx**
- Purpose: Root component managing app state and navigation
- Logic:
  - Global view state (which view is active)
  - User authentication state
  - Portfolio selection
  - Conditional rendering of auth vs dashboard views
  - Error boundary wrapping

**Frontend: constants.ts**
- Purpose: Shared constants for market data display
- Contains: STOCK_PRICE_DISPLAY_SCALE, PRICE_FRACTION_OPTIONS, EXCHANGES, INDUSTRY_CODES, formatting functions

**Frontend: types.ts**
- Purpose: TypeScript interfaces for frontend data models
- Contains: TraderProfile, TradeConfig, AiAnalysis, and related types

## Key File Locations

**Entry Points:**

| File | Purpose |
|------|---------|
| `ai-stoploss-engine-be/index.js` | Backend server startup, initializes DB, WebSocket, worker |
| `ai-stoploss-engine-fe/index.html` | HTML document, declares root div |
| `ai-stoploss-engine-fe/index.tsx` | React entry point, loads theme, renders App |
| `ai-stoploss-engine-fe/App.tsx` | Root component, manages app state and routing |

**Configuration:**

| File | Purpose |
|------|---------|
| `ai-stoploss-engine-be/config/database.js` | PostgreSQL connection pooling |
| `ai-stoploss-engine-be/.env` | Environment variables (DB, API keys, ports) |
| `ai-stoploss-engine-fe/vite.config.ts` | Vite build config, port 3000, React plugin, Tailwind |
| `ai-stoploss-engine-fe/tsconfig.json` | TypeScript strict mode config |

**Core Logic:**

| File | Purpose |
|------|---------|
| `ai-stoploss-engine-be/services/riskCalculator.js` | Position and portfolio risk in VND |
| `ai-stoploss-engine-be/services/aiService.js` | Gemini integration, ATR, signal suggestions |
| `ai-stoploss-engine-be/services/stopLossResolver.js` | SL/TP trigger detection |
| `ai-stoploss-engine-be/services/slippageCalculator.js` | Gap slippage calculation |
| `ai-stoploss-engine-be/workers/stopLossMonitor.js` | Background position monitor (2 min cron) |

**API Integration:**

| File | Purpose |
|------|---------|
| `ai-stoploss-engine-fe/services/api.ts` | Axios client, all endpoints |
| `ai-stoploss-engine-fe/services/websocket.ts` | Socket.IO client |
| `ai-stoploss-engine-be/services/websocket.js` | Socket.IO server, broadcast methods |

**Database Models:**

| File | Purpose |
|------|---------|
| `ai-stoploss-engine-be/models/Portfolio.js` | Portfolio CRUD and risk views |
| `ai-stoploss-engine-be/models/Position.js` | Position lifecycle management |
| `ai-stoploss-engine-be/models/Order.js` | Order creation and tracking |
| `ai-stoploss-engine-be/models/User.js` | User accounts |

**Controllers:**

| File | Purpose | Routes |
|------|---------|--------|
| `ai-stoploss-engine-be/controllers/position.controller.js` | Position management | POST/GET/PATCH positions, calculate, close |
| `ai-stoploss-engine-be/controllers/ai.controller.js` | AI recommendations | POST suggest-sltp, GET signals, dashboard |
| `ai-stoploss-engine-be/controllers/market.controller.js` | Market data | GET symbols, stocks, indices |

## Naming Conventions

**Files:**

| Pattern | Example | Usage |
|---------|---------|-------|
| `.js` (backend) | `position.controller.js` | All backend files |
| `.ts` / `.tsx` (frontend) | `DashboardView.tsx` | All frontend files |
| `{resource}.routes.js` | `auth.routes.js` | HTTP route definitions |
| `{resource}.controller.js` | `position.controller.js` | Request handlers |
| `{domain}Service.js` | `aiService.js`, `riskCalculator.js` | Business logic singletons |
| `{Domain}.js` | `Portfolio.js`, `Position.js` | Data models |
| `*View.tsx` | `DashboardView.tsx` | Full-screen view components |
| `*Selector.tsx` / `*Card.tsx` / `*Modal.tsx` | `TraderCard.tsx` | UI component subparts |

**Directories:**

| Pattern | Example | Usage |
|---------|---------|-------|
| plural noun | `controllers/`, `services/`, `models/`, `routes/` | Collections of related modules |
| lowercase | `config/`, `migrations/`, `public/` | Configuration and data |
| PascalCase with resource | Not used in this codebase | N/A |

**Functions & Variables:**

| Context | Pattern | Example |
|---------|---------|---------|
| React components | PascalCase | `DashboardView`, `TraderCard` |
| Functions (backend) | camelCase | `calculatePositionRisk`, `validatePosition` |
| Constants | UPPER_SNAKE_CASE | `MAX_RISK_PERCENT`, `VPBS_TO_VND` |
| Enums/Types | PascalCase | `PositionStatus`, `StopType` |
| Database columns | snake_case | `entry_price`, `stop_loss`, `created_at` |
| API response fields | camelCase | `portfolioId`, `entryPrice` |

## Where to Add New Code

**New Feature (API endpoint):**
1. **Backend:**
   - Create route handler in `ai-stoploss-engine-be/routes/{resource}.routes.js`
   - Implement logic in `ai-stoploss-engine-be/controllers/{resource}.controller.js`
   - Create/update model in `ai-stoploss-engine-be/models/{Resource}.js` for DB operations
   - Add shared logic to `ai-stoploss-engine-be/services/{domain}Service.js`
2. **Frontend:**
   - Add endpoint to `ai-stoploss-engine-fe/services/api.ts` (export as `{resource}Api`)
   - Call from component: `import { {resource}Api } from '../services/api'`
   - Display in appropriate view component

**New Component/UI Module:**
- Location: `ai-stoploss-engine-fe/components/{ComponentName}.tsx`
- Import into parent view or App.tsx
- Use Tailwind CSS classes for styling
- Accept props for data and callbacks
- Example: Add `PerformanceChart.tsx` to display trader stats

**New Business Logic Service:**
- Location: `ai-stoploss-engine-be/services/{domainService}.js`
- Export static methods or a singleton instance
- Use consistent parameter patterns (portfolioId first, then data)
- Handle errors with descriptive messages
- Call from controllers or workers only

**New Background Worker Task:**
- Location: `ai-stoploss-engine-be/workers/{taskName}Worker.js`
- Start in `ai-stoploss-engine-be/index.js` via `await startWorker()`
- Use cron syntax for scheduling
- Broadcast updates via WebSocket services
- Implement error handling and circuit breaker pattern

**New Database Model/Table:**
1. Create migration file: `ai-stoploss-engine-be/migrations/{timestamp}_{description}.js`
2. Define CRUD class: `ai-stoploss-engine-be/models/{Resource}.js`
3. Use consistent patterns: `static async create()`, `static async findById()`, etc.
4. Return single object for singular queries, array for list queries

**New Shared Utility:**
- Frontend: `ai-stoploss-engine-fe/utils/{utilName}.ts`
- Backend: `ai-stoploss-engine-be/services/{utilName}.js` (if service-level) or directly in model
- Export as named functions or utility class

## Special Directories

**ai-stoploss-engine-be/migrations/**
- Purpose: Database schema version control (SQL scripts)
- Generated: Manual (run by developers)
- Committed: Yes
- Pattern: Numbered files, one migration per feature/change

**ai-stoploss-engine-be/logs/**
- Purpose: Runtime logs
- Generated: During execution
- Committed: No

**ai-stoploss-engine-fe/dist/**
- Purpose: Production build output
- Generated: `npm run build`
- Committed: No

**ai-stoploss-engine-fe/public/**
- Purpose: Static assets (icons, fonts, manifest)
- Generated: Manual
- Committed: Yes

**node_modules/**
- Purpose: Installed dependencies
- Generated: `npm install`
- Committed: No

---

*Structure analysis: 2026-03-26*
