# Feature Landscape

**Domain:** AI-Enhanced Trading Risk Management Platform (Vietnam Stock Market)
**Researched:** 2026-03-26
**Focus:** Portfolio Management, Paper Trading, AI Stop Loss/Take Profit, Risk Simulation

## Table Stakes

Features users expect from a trading risk management platform. Missing = product feels incomplete or untrustworthy.

### Portfolio Management (Real Order Tracking)

| Feature | Why Expected | Complexity | Status | Notes |
|---------|--------------|------------|--------|-------|
| Manual order entry (record real trades placed on broker) | Core use case -- user tracks what they actually bought/sold | Low | Needs fix | Currently runs fillEngine which simulates matching -- should just RECORD |
| Position list with real-time P&L | Every portfolio tracker shows current unrealized P&L | Low | Exists | Already shows positions with market price updates |
| Cash balance tracking | Users need to know how much capital is available vs deployed | Med | Missing | No explicit cash flow model -- need total_balance minus deployed capital |
| Buy/Sell transaction history | Basic accounting -- users need to see what happened | Low | Partial | ExecutionLog exists but is tied to simulation logic |
| Portfolio summary (total value, total P&L, % return) | Standard dashboard metric | Low | Partial | Some aggregation exists, needs proper cash flow integration |
| Position close recording (manual) | User sells on broker, records it here for tracking | Low | Needs fix | Currently auto-closes via SL/TP monitor -- need manual close option |
| Fees and tax calculation (Vietnam-specific) | VN trading fees: 0.15% buy, 0.15% sell + 0.1% tax on sell | Low | Exists | feeEngine.js handles this |
| Multiple portfolio support | Users may have multiple broker accounts or strategies | Low | Exists | Already supports multiple portfolios per user |

### Paper Trading (Simulated Orders)

| Feature | Why Expected | Complexity | Status | Notes |
|---------|--------------|------------|--------|-------|
| Simulated order placement (market + limit) | Core paper trading function | Med | Partial | fillEngine exists but logic mixed with real portfolio |
| Realistic order matching against market price | Credibility of simulation depends on this | Med | Partial | fillEngine does basic matching but lacks queue/delay realism |
| Virtual cash balance with allocation | Paper traders need fake money to manage | Low | Missing | No separate virtual cash model for paper trading |
| Order book simulation (bid/ask spread) | Without spread, fills are unrealistically optimistic | High | Missing | Currently fills at exact market price -- no spread modeling |
| Pending order management (modify/cancel) | Standard order management | Med | Partial | Orders exist but lifecycle management is incomplete |
| Slippage simulation | Critical for realistic P&L -- paper trading without slippage is misleading | Med | Exists | slippageCalculator.js exists, needs integration with paper flow |
| Paper trading performance report | Users need to evaluate how their paper strategy performed | Med | Missing | No dedicated reporting for paper trading results |

### AI Stop Loss

| Feature | Why Expected | Complexity | Status | Notes |
|---------|--------------|------------|--------|-------|
| ATR-based stop loss suggestion | Industry standard volatility-based SL | Low | Exists | aiService suggestSltPv2 does this |
| Multiple SL levels (conservative/moderate/aggressive) | Different risk appetites need different options | Low | Exists | 3 levels already provided |
| Support/resistance-based SL | Technical analysis standard | Med | Exists | Calculated in AI service |
| Visual SL/TP on price chart | Users need to SEE where their stops are | Med | Partial | Some visualization exists |

### General Platform

| Feature | Why Expected | Complexity | Status | Notes |
|---------|--------------|------------|--------|-------|
| Real-time price updates | Trading platform without live prices is useless | Low | Exists | WebSocket + VPBS API |
| Watchlist | Track stocks of interest | Low | Exists | WatchlistView implemented |
| Market overview (VNINDEX, VN30) | Context for trading decisions | Low | Exists | DashboardView |
| Notifications (SL/TP triggered, price alerts) | Users need to know when important events happen | Low | Exists | notificationService + WebSocket |
| Authentication and multi-user | Basic security | Low | Exists | JWT auth implemented |

## Differentiators

Features that set TradeGuard AI apart. Not expected from every platform, but create competitive advantage.

### AI-Powered Dynamic Stop Loss

| Feature | Value Proposition | Complexity | Status | Notes |
|---------|-------------------|------------|--------|-------|
| Dynamic SL adjustment based on market regime | SL adapts when market shifts from trending to ranging -- prevents premature stops in volatile conditions | High | Missing | Current SL is static -- calculated once at position entry |
| Volatility-adaptive trailing stop | Trailing distance expands in high volatility, contracts in low -- smarter than fixed trailing % | Med | Missing | Current trailing is fixed distance |
| Time-decay stop tightening | Stops tighten as position ages -- forces discipline on stale positions | Med | Missing | No time-based adjustment |
| Multi-indicator SL convergence | Combine ATR + support/resistance + moving average for more robust SL placement | Med | Partial | ATR + S/R exists, needs MA integration and convergence logic |
| AI narrative explanation for SL changes | Gemini explains WHY the stop moved -- builds trust and educates | Med | Partial | Gemini already generates explanations, needs dynamic update flow |

### Probability-Based Take Profit

| Feature | Value Proposition | Complexity | Status | Notes |
|---------|-------------------|------------|--------|-------|
| Statistical TP with confidence levels | Instead of "TP at 3R", show "70% probability of reaching 25,500 VND based on 200-day distribution" | High | Missing | Current TP is purely mechanical ATR x RR ratio |
| Multiple TP targets with probability ranking | Show 3-5 targets each with probability -- user picks risk/reward preference | Med | Missing | Current 3 levels don't have probability backing |
| Historical price distribution analysis | Use past price movements to estimate probability of reaching target | Med | Missing | No historical distribution calculation |
| Partial take profit recommendation | Suggest taking 50% at high-probability target, let rest run to stretch target | Med | Missing | No partial exit logic |
| Win rate tracking per strategy | Track how often each TP level actually gets hit over time | Med | Missing | No backtesting or hit-rate tracking |

### Risk Scenario Simulation

| Feature | Value Proposition | Complexity | Status | Notes |
|---------|-------------------|------------|--------|-------|
| Monte Carlo portfolio simulation | Simulate 1000+ portfolio paths to show probability distribution of outcomes | High | Missing | Current scenario is just basic P&L at SL/TP |
| Value at Risk (VaR) calculation | "With 95% confidence, your max loss in 1 day is X VND" -- institutional-grade metric | Med | Missing | No VaR calculation |
| Stress test scenarios (market crash, sector crash) | "What if VNINDEX drops 15%?" -- show impact on portfolio | Med | Missing | No stress testing |
| Correlation analysis between positions | Show if portfolio is over-concentrated in correlated stocks | High | Missing | No correlation tracking |
| Drawdown analysis and visualization | Maximum drawdown over time -- critical risk metric | Med | Missing | No drawdown tracking |

### AI Capital Allocation

| Feature | Value Proposition | Complexity | Status | Notes |
|---------|-------------------|------------|--------|-------|
| AI-suggested position sizing (Kelly Criterion variant) | Optimal capital allocation per trade based on win probability and R:R | Med | Missing | No position sizing recommendation |
| Portfolio-level risk budget visualization | "You've used 60% of your risk budget across 5 positions" | Med | Partial | RiskCalculator validates but doesn't visualize budget |
| Sector/industry concentration alerts | Warn when too much capital in one sector | Low | Missing | No sector analysis |
| AI rebalancing suggestions | "Your HPG position is 40% of portfolio -- consider trimming" | Med | Missing | No rebalancing logic |

## Anti-Features

Features to deliberately NOT build. Building these would hurt the product or exceed scope.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Real broker API integration (auto-execute trades) | Too risky for v1 -- regulatory issues in Vietnam, liability if bugs cause real losses | Manual order recording. User places order on broker app, records here for tracking |
| Social/copy trading | Not core value, massive moderation burden, regulatory complexity | Focus on individual AI-assisted risk management |
| Fundamental analysis engine (financial statements, DCF) | Huge scope, many tools already do this well (Vietstock, CafeF) | Link to external fundamental data sources, focus on technical + risk |
| Real-time chat/forum | Community features distract from core risk management tool | Notifications and AI explanations serve the communication need |
| Backtesting engine (full strategy backtesting) | Massive engineering effort, needs historical data infrastructure | Start with simple win-rate tracking on forward trades, add basic backtest later |
| Crypto/forex support | Different market structure, different data providers, different regulations | Vietnam equities only (HOSE, HNX, UPCOM) -- be excellent at one market |
| Mobile native app | Resource-intensive, web works on mobile browsers | Responsive web design. Consider PWA later if mobile usage is high |
| Automated trading bot | Regulatory risk, liability, complex error handling for real money | AI suggests, human decides. Keep human in the loop always |
| Options/derivatives trading | Vietnam derivatives market is small, different tick rules, adds complexity | Focus on equities. Derivative support is future scope |

## Feature Dependencies

```
Portfolio Management (real order tracking)
  --> Cash balance tracking
    --> Capital allocation visualization
      --> AI position sizing recommendation
  --> Position close recording
    --> Performance reporting
      --> Win rate tracking per strategy

Paper Trading (simulation)
  --> Virtual cash balance
    --> Simulated order placement
      --> Realistic order matching
        --> Slippage simulation
          --> Paper trading performance report

AI Dynamic Stop Loss
  --> Market regime detection (exists via Gemini)
    --> Dynamic SL adjustment
      --> Volatility-adaptive trailing
        --> Time-decay tightening
  --> Multi-indicator convergence
    --> AI narrative for SL changes

Probability-Based Take Profit
  --> Historical price distribution analysis
    --> Statistical TP with confidence levels
      --> Multiple TP targets with probability
        --> Partial take profit recommendation

Risk Scenario Simulation
  --> Position data + market data (exists)
    --> VaR calculation
      --> Monte Carlo simulation
        --> Stress test scenarios
  --> Correlation analysis
    --> Drawdown analysis
```

## MVP Recommendation

### Priority 1: Fix the Foundation (Table Stakes)

Fix these first -- the existing confusion between Portfolio and Paper Trading undermines everything.

1. **Tach Portfolio Management vs Paper Trading** -- separate data models, separate UX flows, separate logic. This is the critical architectural fix.
2. **Portfolio: Manual order entry (record-only)** -- remove fillEngine from real portfolio flow. User enters: symbol, side, quantity, price, date. No simulation.
3. **Portfolio: Cash balance tracking** -- add deployed_capital and available_capital to portfolio model. Update on every order entry/close.
4. **Paper Trading: Virtual cash + simulated matching** -- fillEngine belongs HERE. Add virtual_balance to paper trading portfolio.
5. **Portfolio: Manual position close** -- user records selling on broker. Calculate realized P&L.

### Priority 2: Upgrade AI (Differentiators -- High Value)

6. **Probability-based Take Profit** -- replace mechanical RR with statistical distribution. Use historical candle data to calculate probability of reaching each level.
7. **Dynamic Stop Loss** -- SL adjusts based on current ATR, not just entry ATR. Worker recalculates periodically (e.g., daily after market close).
8. **AI position sizing** -- use fractional Kelly Criterion with user's tracked win rate and average R:R.

### Priority 3: Risk Simulation (Differentiators -- Impressive)

9. **VaR calculation** -- straightforward statistical calculation, high perceived value.
10. **Monte Carlo simulation** -- run N simulations of portfolio paths, show probability distribution. Visual impact is huge.
11. **Stress test scenarios** -- predefined scenarios (VNINDEX -10%, sector -20%) applied to current portfolio.

### Defer to Later

- **Correlation analysis** -- needs significant historical data and computation. Defer.
- **Partial take profit** -- adds UX complexity. Get basic probability TP working first.
- **Order book simulation for paper trading** -- nice to have, but basic price-match simulation is good enough for v1.
- **Full backtesting engine** -- out of scope, massive effort.
- **Volatility-adaptive trailing** -- nice upgrade after basic dynamic SL works.

## Complexity Budget Estimate

| Feature Group | Estimated Effort | Risk Level |
|---------------|-----------------|------------|
| Portfolio/Paper Trading separation | 3-5 days | Medium -- refactoring existing code, migration needed |
| Cash flow model | 1-2 days | Low -- data model addition |
| Probability-based TP | 3-5 days | Medium -- statistical calculation, needs historical data |
| Dynamic Stop Loss | 2-3 days | Medium -- worker modification, new calculation logic |
| AI Position Sizing | 2-3 days | Low -- mathematical formula, integrate with existing risk calc |
| VaR Calculation | 1-2 days | Low -- well-known formula |
| Monte Carlo Simulation | 3-5 days | Medium -- computation + visualization |
| Stress Testing | 2-3 days | Low -- apply multipliers to existing portfolio data |

## Vietnam Market-Specific Considerations

| Factor | Impact on Features |
|--------|-------------------|
| HOSE price limit +/-7%, HNX +/-10% | Monte Carlo and stress tests must cap daily moves at these limits |
| T+2 settlement | Cash balance must account for unsettled trades (money not available yet) |
| Trading hours 9:00-11:30, 13:00-14:45 | Paper trading matching engine only active during market hours |
| Lot size: 100 shares (HOSE), 100 shares (HNX) | Order validation must enforce lot sizes |
| Tick size rules vary by price range | tickSizeEngine.js already handles this -- reuse |
| ATO/ATC auction sessions | Paper trading should handle opening/closing auction differently |
| Foreign ownership limits | Not relevant for VN retail investor tool -- ignore |

## Sources

- [3Commas AI Trading Bot Risk Management Guide 2025](https://3commas.io/blog/ai-trading-bot-risk-management-guide-2025)
- [AlgoBulls - Risk Management in Algorithmic Trading](https://algobulls.com/blog/algo-trading/risk-management)
- [Dynamic Risk Management - MQL5](https://www.mql5.com/en/blogs/post/765797)
- [LuxAlgo ATR Dynamic Stop Loss Levels](https://www.luxalgo.com/blog/average-true-range-dynamic-stop-loss-levels/)
- [QuantInsti - Probability Trading](https://blog.quantinsti.com/probability-trading/)
- [Portfolio Visualizer - Monte Carlo Simulation](https://www.portfoliovisualizer.com/monte-carlo-simulation)
- [ETNA - Best Paper Trading Platform 2025](https://www.etnasoft.com/best-paper-trading-platform-for-u-s-broker-dealers-why-advanced-simulation-sets-the-2025-standard/)
- [Alpaca - Paper Trading vs Live Trading](https://alpaca.markets/learn/paper-trading-vs-live-trading-a-data-backed-guide-on-when-to-start-trading-real-money)
- [Trade Ideas - Position Sizing in Risk Management](https://www.trade-ideas.com/2025/04/04/the-role-of-position-sizing-in-your-risk-management-plan/)
- [Kelly Criterion - Wikipedia](https://en.wikipedia.org/wiki/Kelly_criterion)
- [Vietnam Stock Exchange Guide - The Shiv](https://the-shiv.com/the-vietnam-stock-exchange-quick-guide/)
