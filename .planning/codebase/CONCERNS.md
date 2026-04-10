# Codebase Concerns

**Analysis Date:** 2026-03-26

## Tech Debt

### Monolithic App Component
- **Issue:** `App.tsx` is 4162 lines – massive component mixing UI rendering, state management, API calls, and chart initialization.
- **Files:** `ai-stoploss-engine-fe/App.tsx`
- **Impact:** Makes code difficult to test, maintain, and reason about. Component is too large to comprehend and modify safely. Every change risks introducing bugs across the entire app.
- **Fix approach:** Break into domain-specific container components: `DashboardContainer`, `TerminalContainer`, `PortfolioContainer`. Extract state management logic and API calls into custom hooks (`useDashboard`, `useChart`, `usePortfolio`).

### Type Safety Issues (excessive `any` types)
- **Issue:** 30+ instances of `any` type annotations throughout codebase avoiding proper typing. Examples: chart data stored as `any[]`, state variables like `symbolDetail`, `companyInfo`, `financialData`, `matchingHistory`, `orderBook` all typed as `any`.
- **Files:**
  - `ai-stoploss-engine-fe/App.tsx` (calculateSMA, CandlestickChartLW, multiple state vars)
  - `ai-stoploss-engine-fe/components/TradingTerminal.tsx` (chartData, symbolDetail, matchingHistory, orderBook)
  - `ai-stoploss-engine-fe/components/WatchlistView.tsx` (chartData, symbolDetail, aiAnalysis)
  - `ai-stoploss-engine-fe/services/websocket.ts` (callback parameters)
- **Impact:** Lost type checking at compile and runtime. Refactoring becomes risky, IDE autocomplete fails, caught bugs at runtime instead of development time.
- **Fix approach:** Define concrete TypeScript interfaces for all data structures (ChartData, SymbolDetail, CompanyInfo, MatchingHistory, OrderBook). Use generics for API responses. Replace all `any` with proper types incrementally.

### Excessive console statements in production code
- **Issue:** 40+ console.log/warn/error statements scattered across codebase, many with debug-level detail (e.g., "CandlestickChartLW: Initializing chart, container:", "🔍 MATCHING RESPONSE:").
- **Files:** `ai-stoploss-engine-fe/App.tsx` (contains 8+ console.log calls for chart initialization)
- **Impact:** Performance degradation on high-frequency operations (chart updates). Cluttered browser console makes real errors hard to spot. Sensitive data could leak if not filtered.
- **Fix approach:** Implement proper logging service with levels (debug, info, warn, error). Add environment-based filtering: strip all debug logs in production builds using Vite configuration.

## Known Bugs

### Chart Container Reference Initialization
- **Symptoms:** CandlestickChart may fail to render if container ref is null or not ready when useEffect runs.
- **Files:** `ai-stoploss-engine-fe/App.tsx` lines 67-72
- **Trigger:** Fast component mount/unmount, server-side rendering compatibility issues, or if parent resizes before chart initializes.
- **Workaround:** Explicit null check exists but recovery is silent – chart just doesn't render with no user feedback.

### Unhandled WebSocket Reconnection
- **Symptoms:** After 3 failed reconnection attempts, WebSocket silently stops trying. No UI feedback to user that real-time updates are unavailable.
- **Files:** `ai-stoploss-engine-fe/services/websocket.ts` lines 51-61
- **Trigger:** Backend down for >30 seconds during peak market hours.
- **Workaround:** Manual page refresh forces reconnection attempt.

### localStorage Access Without Error Handling
- **Symptoms:** Code accesses localStorage without try-catch in multiple places. If storage quota exceeded or private mode blocks access, app silently fails with undefined values.
- **Files:**
  - `ai-stoploss-engine-fe/index.tsx` (theme retrieval)
  - `ai-stoploss-engine-fe/components/WatchlistView.tsx` line 41 (has try-catch but others don't)
  - `ai-stoploss-engine-fe/components/SettingsView.tsx` (multiple localStorage calls)
  - `ai-stoploss-engine-fe/components/AuthView.tsx` (token storage)
- **Trigger:** Safari private mode, storage quota exceeded, or incognito mode.
- **Workaround:** None – app state becomes corrupted silently.

## Security Considerations

### Sensitive Data in localStorage
- **Risk:** Authentication tokens and user data stored in localStorage accessible to XSS attacks. No encryption.
- **Files:**
  - `ai-stoploss-engine-fe/services/api.ts` (lines 18, 34, 35, 152-155)
  - `ai-stoploss-engine-fe/components/AuthView.tsx` (token/user storage)
- **Current mitigation:** HttpOnly cookies not used. Token sent in Authorization header on every request.
- **Recommendations:**
  1. Move authentication token to httpOnly cookie set by backend on login
  2. Implement CSRF protection
  3. Add Content Security Policy headers
  4. Use sessionStorage for temporary UI state, not localStorage for credentials

### Unvalidated API Response Data
- **Risk:** API responses cast to `any` without validation. Malformed backend responses could cause app crashes or logic errors.
- **Files:** All API service calls that receive `any` typed data
- **Current mitigation:** TypeScript interfaces exist but not enforced during deserialization.
- **Recommendations:**
  1. Use runtime validation library (zod, io-ts) for critical endpoints
  2. Strict null checks on all API data before use
  3. Add error boundaries around data-dependent components

### No Rate Limiting on API Calls
- **Risk:** Frontend can spam API without backoff. Could enable DOS attacks or abuse.
- **Files:** `ai-stoploss-engine-fe/services/api.ts`, all API methods
- **Current mitigation:** 30-second request timeout only.
- **Recommendations:**
  1. Implement request queuing with debounce/throttle on high-frequency endpoints
  2. Add client-side rate limiting per endpoint
  3. Implement exponential backoff on failures

## Performance Bottlenecks

### Heavy Chart Rendering
- **Problem:** CandlestickChart with Moving Averages (MA20, MA50) renders on every price update. No memoization or virtualization.
- **Files:** `ai-stoploss-engine-fe/App.tsx` lines 135-200 (chart initialization and data updates)
- **Cause:** All chart series (candlesticks, volume, MA20, MA50) redraw on any data change. No batching of updates. WebSocket updates come at high frequency (potentially 1/second per symbol).
- **Improvement path:**
  1. Throttle WebSocket price updates to 500ms batches
  2. Memoize chart data transformation and SMA calculations
  3. Use React.memo for chart component to prevent unnecessary re-renders
  4. Consider using requestAnimationFrame for smooth chart updates instead of synchronous renders

### Large State Objects in Single Component
- **Problem:** App.tsx manages 30+ state variables. Every setState triggers full component re-render including unrelated subtrees.
- **Files:** `ai-stoploss-engine-fe/App.tsx` (lines 200+ useState calls)
- **Cause:** No state splitting by domain. UI state (modals, sidebar open) lives alongside API state (positions, portfolio).
- **Improvement path:**
  1. Split state into logical domains using custom hooks or context
  2. Memoize independent component branches
  3. Consider state management library (Zustand, Jotai) if complexity grows

### Market Data API Calls Not Cached
- **Problem:** Each symbol lookup fetches fresh data from VPBS API. No caching strategy.
- **Files:** `ai-stoploss-engine-fe/components/TradingTerminal.tsx`, `ai-stoploss-engine-fe/components/WatchlistView.tsx` (market API calls)
- **Cause:** Every user lookup or symbol detail fetch hits backend without cache validation.
- **Improvement path:**
  1. Implement SWR or React Query for automatic cache + revalidation
  2. Cache symbol details for 5min (OHLC, company info)
  3. Implement stale-while-revalidate for non-critical market data

## Fragile Areas

### Chart Plugin System
- **Files:** `ai-stoploss-engine-fe/chart-plugins/rectangle-drawing-tool.ts` (521 lines), supporting helpers in `helpers/`
- **Why fragile:** Complex coordinate transformation logic for drawing tools. Relies on DOM measurements and Lightweight Charts internals. Minimal type safety (many `any` types in helper files).
- **Safe modification:** Before changing rectangle-drawing-tool or position calculations, add comprehensive tests for edge cases (extreme prices, narrow/wide viewport, different exchanges with different tick sizes).
- **Test coverage:** No test files exist for this module.

### Vietnamese Stock Rules Engine
- **Files:** `ai-stoploss-engine-fe/utils/vnStockRules.ts` (222 lines)
- **Why fragile:** Implements complex exchange-specific rules (lot sizes, price steps, trading sessions) used in position validation. Multiple conditional branches for HOSE/HNX/UPCOM behavior. Wrong rule could allow invalid orders.
- **Safe modification:** Add unit tests for each exchange's lot size, price step, and session logic. Test with real VPBS data.
- **Test coverage:** No tests exist.

### WebSocket Event Subscription Model
- **Files:** `ai-stoploss-engine-fe/services/websocket.ts`
- **Why fragile:** Event listener registration has no deduplication. Multiple components can subscribe to same event. Unsubscribe logic must match subscription exactly. Memory leaks possible if components unmount without unsubscribing.
- **Safe modification:** Add integration test for subscribe → component unmount → unsubscribe flow. Verify no memory leaks with heap snapshots.
- **Test coverage:** No tests.

### Position Risk Calculation Logic
- **Files:** `ai-stoploss-engine-fe/App.tsx` (getPositionRiskVnd function, lines scattered throughout)
- **Why fragile:** Risk calculation mixes VND/points conversion, quantity, exchange rules, and portfolio risk limits. Off-by-one or rounding errors could cause position to exceed risk limit.
- **Safe modification:** Extract to pure function with unit tests. Test against known portfolio/position combinations with expected risk values.
- **Test coverage:** No tests.

## Scaling Limits

### Single Portfolio Context
- **Current capacity:** Single active portfolio at a time. App state assumes one portfolio context.
- **Limit:** Cannot easily support multi-portfolio viewing or rapid portfolio switching (state recreation overhead).
- **Scaling path:** Introduce portfolio context store with lazy-loaded position data. Cache multiple portfolios in memory with LRU eviction.

### Real-time Updates Throughput
- **Current capacity:** WebSocket handles one connection per browser tab. Subscribe to unlimited symbols but server may throttle at high subscription count.
- **Limit:** >100 active symbol subscriptions may cause server backpressure or client drops.
- **Scaling path:** Implement subscription deduplication. Merge redundant symbol subscriptions. Consider Symbol subscription aggregation service on backend.

### Chart Data Memory
- **Current capacity:** Full OHLC history loaded into memory. MA20/MA50 recalculated on each update.
- **Limit:** 3+ years of daily OHLC + multiple MAs for 10 symbols may cause memory pressure.
- **Scaling path:** Load windowed data (last 200 bars visible + 100 off-screen). Stream older data on-demand. Use canvas-based rendering for large datasets.

## Dependencies at Risk

### No Testing Framework Installed
- **Risk:** No test runner (Jest, Vitest) or assertion library in package.json. Cannot write or run tests.
- **Impact:** Cannot verify fixes for fragile areas. Refactoring App.tsx is high-risk.
- **Migration plan:** Install Vitest + React Testing Library. Start with tests for critical paths (authentication, position creation, risk calculation).

### Lightweight Charts Library (external chart library)
- **Risk:** Core chart rendering depends on `lightweight-charts@^5.1.0`. No alternative visualization if bugs found.
- **Impact:** Chart bugs block market data display.
- **Migration plan:** Evaluate TradingView's lightweight-charts alternatives (ApexCharts, ECharts) before full app launch.

### Outdated React Version Target
- **Risk:** React 19.2.4 is very new. May have stability issues or breaking changes.
- **Impact:** Dependency update cascade if bugs found mid-project.
- **Migration plan:** Consider pinning to LTS version (18.2.x) for stability if critical trading app.

## Missing Critical Features

### No Offline Mode
- **Problem:** App requires constant API/WebSocket connectivity. Extended disconnection causes data staleness but UI doesn't indicate connection status.
- **Blocks:** Mobile trading during poor connectivity, reliable position monitoring.

### No Transaction History Export
- **Problem:** Closed positions and trade logs cannot be exported (CSV, PDF) for tax reporting or record-keeping.
- **Blocks:** User compliance, portfolio audit trails.

### No Real-time Notifications
- **Problem:** Notifications fetched on-demand, not pushed. User must check UI for critical alerts (Stop-Loss approaching, SL triggered).
- **Blocks:** Unattended trading safety, risk management automation.

### No Mobile Responsive Design
- **Problem:** Layout is desktop-first. Chart and trading terminal not optimized for mobile viewports.
- **Blocks:** Mobile app usage during market hours.

## Test Coverage Gaps

### No Unit Tests for Core Logic
- **What's not tested:**
  - Position risk calculations (`getPositionRiskVnd`)
  - Stock rules validation (`vnStockRules.ts`)
  - SMA calculations (`calculateSMA`)
  - WebSocket subscription lifecycle
  - localStorage fallback logic
- **Files:** All files listed above
- **Risk:** Logic bugs in production with no detection until user reports. Critical trading calculations unverified.
- **Priority:** HIGH – Position risk calculation must be tested before production.

### No Integration Tests
- **What's not tested:**
  - Auth flow (login → token storage → API requests)
  - Position lifecycle (create → monitor → close)
  - WebSocket subscribe → unsubscribe → re-subscribe
  - Chart data load → render → price update
- **Risk:** Cross-component interactions break silently. Refactoring requires manual testing.
- **Priority:** MEDIUM – Add tests as UI stabilizes.

### No E2E Tests
- **What's not tested:** User workflows through real backend
- **Files:** Entire application
- **Risk:** Breaking changes in backend API not caught until deployment.
- **Priority:** LOW – defer to post-MVP, but add before scaling to production trading.

---

*Concerns audit: 2026-03-26*
