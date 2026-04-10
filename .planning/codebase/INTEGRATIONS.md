# External Integrations

**Analysis Date:** 2026-03-26

## APIs & External Services

**AI & Content Intelligence:**
- Google Gemini API (generative-ai) - AI-powered trading analysis
  - SDK/Client: `@google/generative-ai` 0.21.0
  - Auth: `GEMINI_API_KEY` environment variable
  - Models: `gemini-2.5-flash` (configurable via `GEMINI_MODEL`)
  - Used in: `ai-stoploss-engine-be/services/aiService.js`
  - Purpose: Generate trading signals, trend analysis, risk evaluation, SL/TP suggestions

- Firecrawl Web Scraping API - Content extraction
  - Auth: `FIRECRAWL_API_KEY` environment variable
  - Used in: `ai-stoploss-engine-be/services/cafefNewsService.js` and `ai-stoploss-engine-be/services/marketNewsService.js`
  - Purpose: Scrape market news from CafeF (cafef.vn) - fallback to manual HTML parsing if key unavailable
  - Endpoint: `https://api.firecrawl.dev/v1/scrape`

**Stock Market Data:**
- VPBS (VP Bank Securities) Market API
  - Endpoint base: `https://neopro.vpbanks.com.vn/neo-inv-tools/noauth/public/v1/stock`
  - Used in: `ai-stoploss-engine-be/services/marketPriceService.js`
  - Endpoints:
    - `/stockAdvancedInfo` - Current stock info (price, reference, trading volume)
    - `/matchingHistoryBuyUpSellDown` - Order book data (bid/ask volumes)
  - Purpose: Real-time market prices, reference prices, trading volumes
  - No authentication required (public API)
  - Client identification via User-Agent headers

- CafeF (cafef.vn) - Market News
  - URL: `https://cafef.vn/thi-truong-chung-khoan.chn`
  - Used in: `ai-stoploss-engine-be/services/cafefNewsService.js`
  - Method: Web scraping with optional Firecrawl API
  - Purpose: Vietnamese stock market news and announcements

## Data Storage

**Databases:**
- PostgreSQL (primary)
  - Host: `DB_HOST` environment variable (ailusion.io.vn in .env)
  - Port: `DB_PORT` (5432)
  - Database: `DB_NAME` (ailusion)
  - Schema: `financial` (configurable via `DB_SCHEMA`)
  - Connection: `pg` package (Node.js PostgreSQL driver)
  - Connection pooling:
    - Min: `DB_POOL_MIN` (default 2)
    - Max: `DB_POOL_MAX` (default 10)
    - Idle timeout: `DB_IDLE_TIMEOUT_MS` (60000ms)
    - Connection timeout: `DB_CONNECT_TIMEOUT_MS` (30000ms)
  - Tables: users, portfolios, positions, orders, notifications, price_alerts, market_data, ai_signals, etc.
  - Connection file: `ai-stoploss-engine-be/config/database.js`

**File Storage:**
- Local filesystem only - No external file storage integration
- Frontend built files: `ai-stoploss-engine-fe/dist/`
- Uploads: Not currently implemented

**Caching:**
- No external caching layer configured
- In-memory singleton instances for WebSocket and AI model initialization

## Authentication & Identity

**Auth Provider:**
- Custom JWT-based authentication
  - Implementation: `ai-stoploss-engine-be/middleware/auth.js`
  - Token storage: Bearer token in `Authorization` header
  - Frontend storage: `localStorage.getItem('auth_token')`
  - Secret: `JWT_SECRET` environment variable
  - Expiration: `JWT_EXPIRES_IN` (7d by default)
  - Refresh: `JWT_REFRESH_EXPIRES_IN` (30d by default)
  - Hashing: bcrypt with `BCRYPT_ROUNDS` (10 by default)
  - Routes: `ai-stoploss-engine-be/routes/auth.routes.js`
    - POST `/api/auth/register` - User registration
    - POST `/api/auth/login` - User login
    - GET `/api/auth/me` - Current user info (protected)
    - POST `/api/auth/logout` - User logout

## Monitoring & Observability

**Error Tracking:**
- Not detected - Errors logged to console only

**Logs:**
- Console logging with timestamp and method/path info
- Log level configurable: `LOG_LEVEL` environment variable
  - Options: error, warn, info, debug
  - Debug mode shows query execution details and timing
- No centralized logging service

**Webhooks & Callbacks:**

**Incoming:**
- Not detected - No external webhook endpoints configured

**Outgoing:**
- Telegram Bot (currently disabled)
  - Package: `telegraf` 4.15.0
  - Feature flag: `FEATURE_TELEGRAM_SIGNALS=false`
  - Potential use: Send trading signals and alerts via Telegram
  - Not actively integrated

## CI/CD & Deployment

**Hosting:**
- Not specified - Self-hosted or Docker deployment required
- Backend: Runs on Node.js (port configurable via `PORT` env var, default 3000)
- Frontend: Static files from `dist/` after build

**CI Pipeline:**
- Not detected - No GitHub Actions or CI configuration found

## Real-time Communication

**WebSocket:**
- Socket.IO server on backend (`ai-stoploss-engine-be/services/websocket.js`)
  - Package: `socket.io` 4.6.1
  - Authentication: JWT token via `handshake.auth.token`
  - URL: Configurable, defaults to server root
  - Frontend client: `ai-stoploss-engine-fe/services/websocket.ts`
  - Reconnection: Max 3 attempts with exponential backoff

**WebSocket Events:**

Broadcast channels (server to client):
- `notification` - User notifications (SL/TP triggered, alerts)
- `portfolio_update` - Portfolio changes
- `price_update` - Real-time stock price updates
- `market_update` - Market-level changes
- `trade_alert` - Trade alerts and signals
- `risk_update` - Risk metric updates

Subscribe events (client to server):
- `subscribe_portfolio(portfolioId)` - Subscribe to portfolio updates
- `subscribe_symbol(symbol)` - Subscribe to price updates for a symbol
- `unsubscribe_portfolio(portfolioId)`
- `unsubscribe_symbol(symbol)`

## Environment Configuration

**Required env vars:**
- `NODE_ENV` - development/production
- `PORT` - Server port (default 3000)
- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` - PostgreSQL
- `DB_SCHEMA` - Database schema (default 'financial')
- `JWT_SECRET` - JWT signing key
- `GEMINI_API_KEY` - Google Gemini API key
- `CORS_ORIGIN` - Frontend origin for CORS

**Optional env vars:**
- `GEMINI_MODEL` - Gemini model name (default 'gemini-1.5-flash')
- `FIRECRAWL_API_KEY` - Firecrawl API key (optional, for enhanced news scraping)
- `LOG_LEVEL` - Logging level (info by default)
- `FEATURE_TELEGRAM_SIGNALS` - Enable Telegram integration (default false)
- `FEATURE_AUTO_STOPLOSS` - Enable auto SL/TP (default true)
- `STOP_LOSS_CHECK_INTERVAL` - SL monitoring interval in ms (default 10000)
- `SIGNAL_COLLECTION_INTERVAL` - Signal collection interval in ms (default 300000)
- `AI_SIGNAL_GENERATION_INTERVAL` - AI signal generation interval in ms (default 3600000)

**Secrets location:**
- Backend: `.env` file in `ai-stoploss-engine-be/` directory
- Frontend: Vite environment variables prefixed with `VITE_` (e.g., `VITE_API_URL`, `VITE_WS_URL`)
- Frontend API endpoint: `VITE_API_URL` (default 'http://localhost:3000/api')
- Frontend WebSocket endpoint: `VITE_WS_URL` (default 'http://localhost:3000')

## Rate Limiting

**Configuration:**
- Window: `RATE_LIMIT_WINDOW_MS` (900000ms = 15 minutes)
- Max requests per window: `RATE_LIMIT_MAX_REQUESTS` (100)
- Middleware: `express-rate-limit` package

---

*Integration audit: 2026-03-26*
