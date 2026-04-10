# Domain Pitfalls

**Domain:** AI-enhanced trading risk management platform (Vietnam stock market)
**Researched:** 2026-03-26
**Overall confidence:** HIGH (based on codebase analysis + domain research + VN market rules)

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or user financial harm.

### Pitfall 1: Order/Position Identity Crisis

**What goes wrong:** Portfolio tracking (real trades) and paper trading (simulated trades) share the same Order -> fill -> Position pipeline. User enters a real trade they already executed on broker, but the system runs fillEngine and "simulates" a fill at market price. The recorded entry price diverges from the user's actual entry price. Portfolio P&L becomes meaningless.

**Why it happens:** The current codebase has a single `fillEngine.js` that runs INSTANT mode on all orders. There is no concept of "record-only" orders for portfolio tracking vs "simulate" orders for paper trading. PROJECT.md confirms this: "Form tao lenh chay fillEngine INSTANT -> gia lap khop ngay -> tao position."

**Consequences:**
- Portfolio module shows wrong entry prices (simulated fill != actual broker fill)
- Users lose trust when P&L doesn't match their broker account
- Risk calculations based on wrong entry prices lead to incorrect SL/TP levels
- Cannot distinguish paper trading performance from real portfolio performance in analytics

**Prevention:**
1. Create two distinct flows with separate database flags: `order.mode = 'PORTFOLIO' | 'PAPER'`
2. PORTFOLIO mode: user inputs actual fill price, quantity, date -- no fill engine involvement, direct position creation
3. PAPER mode: order goes through fillEngine with simulated matching
4. Never allow mode switching on an existing order/position
5. UI must make the mode visually obvious (different colors, labels, separate navigation)

**Detection (warning signs):**
- Users reporting P&L doesn't match their broker
- Entry prices in positions don't match what user expected
- No `mode` or `type` field distinguishing real vs simulated in orders table

**Phase relevance:** Phase 1 (highest priority) -- this is the core architectural fix. All other improvements depend on clean separation.

---

### Pitfall 2: AI Stop Loss Overfitting to Historical Volatility

**What goes wrong:** ATR-based stop loss calculated from recent N periods assumes future volatility will match recent past. In trending markets, ATR compresses during consolidation then explodes on breakout. A stop loss set during low-ATR consolidation gets blown out immediately when volatility returns. Conversely, during high-volatility periods, stops are set too wide, exposing users to excessive risk.

**Why it happens:** Current implementation calculates ATR once at order time ("AI Stop Loss tinh 1 lan luc dat, khong tu dieu chinh khi thi truong thay doi"). ATR is a lagging indicator by nature -- it describes what happened, not what will happen.

**Consequences:**
- Stop losses too tight in pre-breakout consolidation = premature exits
- Stop losses too wide after volatile events = excessive drawdowns
- Users develop false confidence in "AI-recommended" levels that are mechanically derived
- The "AI" label creates authority bias -- users override their own judgment

**Prevention:**
1. Never present ATR-based calculations as "AI recommendations" -- label them as "volatility-based suggestions"
2. Implement dynamic adjustment: recalculate SL at configurable intervals (daily, per-session) and notify user of proposed changes
3. Add regime-aware ATR: use different lookback periods and multipliers based on market regime (trending vs ranging vs volatile)
4. Show confidence intervals, not point estimates: "SL range: 42,000 - 43,500 (68% confidence)" instead of "SL: 42,800"
5. Include a volatility regime warning: "Current ATR is 40% below 20-day average -- breakout risk elevated"
6. Require user confirmation when AI adjusts SL -- never auto-move without consent

**Detection (warning signs):**
- SL levels that haven't changed in days despite market movement
- Backtested SL performance significantly better than live performance
- Users complaining about stops being hit right before price reverses

**Phase relevance:** Phase 2-3 -- after order/position separation is clean. Requires market regime detection (already exists via Gemini) to be connected to SL calculation.

---

### Pitfall 3: Take Profit Without Probability Creates False Expectations

**What goes wrong:** Current TP uses `ATR x Risk/Reward ratio` mechanically. A 1:3 RR target says nothing about the probability of reaching that target. Users see "TP: +15%" and assume it's likely, when the actual probability might be 20%.

**Why it happens:** PROJECT.md states: "AI Take Profit co hoc: Chi dung ATR x RR ratio, khong co xac suat thong ke." RR ratios are meaningful only when combined with win rate probability.

**Consequences:**
- Users hold positions too long waiting for unlikely TP levels
- Unrealized profits evaporate because TP was set at improbable level
- No partial profit-taking strategy -- it's all-or-nothing at a single TP level
- Backtesting shows high average win but very low win rate = net negative expectancy

**Prevention:**
1. Implement probability-weighted TP levels: analyze historical price movement after similar setups to estimate probability of reaching each level
2. Provide multiple TP tiers (TP1: 60% probability at +5%, TP2: 35% at +10%, TP3: 15% at +15%)
3. Show expected value: `P(reach) x profit - P(miss) x average_loss_if_miss`
4. Use historical support/resistance zones as TP anchors, not just ATR multiples
5. Display the tradeoff explicitly: "Higher TP = lower probability. Choose based on your strategy."

**Detection (warning signs):**
- TP hit rate below 30% across users
- Users consistently closing positions before TP (manual override = TP was unrealistic)
- TP levels that ignore obvious resistance levels above

**Phase relevance:** Phase 2-3 -- requires historical price data analysis capability.

---

### Pitfall 4: Paper Trading Instant Fill Creates Unrealistic Confidence

**What goes wrong:** Current `fillEngine.js` fills orders instantly at current market price (MP) or limit price (LO). No slippage, no partial fills, no queue position, no spread. Paper trading results look significantly better than real trading would be.

**Why it happens:** The fillEngine uses `fillOrderInstant` with zero slippage model. LO orders fill at `order.limit_price` exactly when `currentPrice <= limitPrice` (BUY) or `currentPrice >= limitPrice` (SELL). In reality, your order joins a queue and may not fill even when price touches your limit.

**Consequences:**
- Paper trading win rates 10-30% higher than realistic
- Users size up real positions based on inflated paper performance
- Limit orders fill 100% of the time in paper but maybe 40-60% in reality (especially at support/resistance where everyone has the same limit)
- No experience with partial fills, order rejection, or slippage on volatile days

**Prevention:**
1. Add slippage model: `actual_fill = limit_price + random(0, spread * slippage_factor)` for market orders
2. Implement fill probability for limit orders: based on volume at price level, not just price touch
3. Add realistic delays: orders don't fill instantly, add 1-5 second simulated latency
4. Implement partial fills: large orders relative to average volume should fill in chunks
5. Model spread: bid-ask spread should affect fill price, especially for less liquid stocks on HNX/UPCOM
6. Show disclaimer: "Paper trading results do not reflect real market conditions. Real fills may differ significantly."

**Detection (warning signs):**
- Paper trading Sharpe ratio > 2.0 (suspiciously good)
- 100% fill rate on limit orders
- Zero slippage in all paper trades
- Users shocked by real trading results after paper period

**Phase relevance:** Phase 2 (Paper Trading module rebuild) -- implement REALISTIC mode that fillEngine.js already has a placeholder for.

---

## Moderate Pitfalls

### Pitfall 5: Risk Calculation Ignoring Correlation

**What goes wrong:** Position sizing treats each position independently. User has 5 positions in VN30 banking stocks (VCB, BID, CTG, TCB, MBB) thinking they're "diversified" but these stocks correlate at 0.7-0.9. A banking sector downturn hits all 5 simultaneously. Total portfolio drawdown is 3-4x what individual position risk suggested.

**Why it happens:** Risk calculation (`getPositionRiskVnd`) computes per-position risk without considering cross-position correlation. This is standard in simple portfolio trackers but dangerous for risk management tools.

**Prevention:**
1. Group positions by sector/industry and show "sector concentration" warnings
2. Implement simple correlation check: if >40% of portfolio value is in same sector, warn user
3. Show "portfolio heat" metric: sum of correlated risk, not just individual risk
4. For VN market specifically: flag when multiple positions are in VN30 constituents (they move together)
5. Advanced (future): compute rolling correlation matrix from VPBS price data

**Detection (warning signs):**
- Portfolio with 5+ positions all in same sector
- Total risk < sum of individual risks (means correlations were ignored)
- Max drawdown events significantly exceeding per-position risk estimates

**Phase relevance:** Phase 3 -- after portfolio management is solid. Requires historical price data for correlation calculation.

---

### Pitfall 6: Vietnam T+2 Settlement Not Modeled

**What goes wrong:** User buys stock today, system shows it as a tradeable position immediately. User tries to sell next day but in reality the shares haven't settled yet (T+2). For paper trading this creates unrealistic scenario. For portfolio tracking, it misrepresents available shares.

**Why it happens:** Neither the fillEngine nor position model tracks settlement date. Positions become "OPEN" immediately upon fill.

**Consequences:**
- Paper trading allows impossible trades (buy and sell same stock within T+2)
- Portfolio cash balance doesn't reflect T+2 settlement timing
- Users develop habits that won't work with real brokers
- Buying power calculation is wrong -- money from T+0 sell isn't available for T+2

**Prevention:**
1. Add `settlement_date` field to positions: `opened_at + 2 business days`
2. Paper Trading: prevent selling unsettled shares (or warn prominently)
3. Portfolio: show "settled" vs "pending settlement" shares separately
4. Cash flow: track "available cash" vs "total cash" (pending sell settlements)
5. Consider VN market holidays in settlement calculation (skip non-trading days)

**Detection (warning signs):**
- Users selling positions the same day or next day they bought
- Cash balance allowing trades that real broker would reject
- No `settlement_date` column in positions table

**Phase relevance:** Phase 2 (Paper Trading) and Phase 1 (Portfolio) -- fundamental to both modules.

---

### Pitfall 7: Price Band Violations in Stop Loss Calculation

**What goes wrong:** AI suggests stop loss at -8% but HOSE daily limit is -7%. The stop loss can literally never trigger in a single day. Worse: if price gaps down to floor (-7%) for multiple days (lock limit down), the stop loss is useless because there are no buyers at floor price.

**Why it happens:** SL calculation uses ATR without checking against exchange-specific price bands. The `vnStockRules.ts` has price validation but it's not connected to AI SL/TP calculation.

**Consequences:**
- SL levels below floor price create false safety illusion
- Lock-limit-down scenarios (common in VN market during panics) make any SL useless
- Users think they're protected at -5% SL but stock gaps down -7% at open

**Prevention:**
1. Clamp AI SL suggestions to within price band: max SL = floor price for current session
2. Warn when SL is close to floor price: "Your SL at 45,200 is near floor price 45,000. If stock hits floor, there may be no buyers."
3. For multi-day scenarios: simulate what happens if stock locks limit down for N consecutive days
4. Add "gap risk" warning for overnight positions: "Price can gap beyond your SL at market open"
5. Connect `vnStockRules.ts` price validation to AI SL output

**Detection (warning signs):**
- SL levels that exceed single-day price band
- No validation of SL against floor/ceiling prices
- Users with SL set but position shows loss beyond SL level

**Phase relevance:** Phase 2-3 (AI improvements) -- requires integration between vnStockRules and AI calculation layer.

---

### Pitfall 8: Tick Size Rounding Errors in P&L

**What goes wrong:** HOSE has tiered tick sizes (10d for <10k, 50d for 10k-50k, 100d for >=50k). If SL/TP prices don't snap to valid tick sizes, the simulated fill price is invalid. Small rounding errors compound across many positions.

**Why it happens:** `vnStockRules.ts` has `snapToTickSize()` but it's unclear if AI-calculated SL/TP values pass through this function. The fillEngine uses raw prices without tick validation.

**Consequences:**
- Orders at invalid prices would be rejected by real broker
- P&L calculations off by small amounts that compound
- Users learn invalid prices in paper trading, get rejected in real trading

**Prevention:**
1. All AI-generated prices (SL, TP, suggested entries) MUST pass through `snapToTickSize()` before display
2. fillEngine must validate fill prices against tick size before recording
3. Add tick size validation to position creation in fillEngine.js
4. Unit test: generate 1000 random AI SL/TP values, verify all pass `validateLOPrice()`

**Detection (warning signs):**
- Prices in database that don't align with tick size for their exchange
- AI suggesting prices like 25,030 on HOSE (invalid -- should be 25,000 or 25,050)

**Phase relevance:** Phase 1-2 -- should be part of initial refactoring since vnStockRules.ts already exists.

---

### Pitfall 9: Gemini API Dependency for Critical Decisions

**What goes wrong:** Market regime detection relies on Google Gemini API. If API is down, rate-limited, or returns unexpected format, the AI layer fails silently. Users make decisions without regime context, or worse, system uses stale regime data from hours ago.

**Why it happens:** LLM APIs have variable latency (500ms - 30s), rate limits, and can change response format without notice. Using LLM for real-time trading decisions adds uncontrolled latency.

**Consequences:**
- Regime detection fails during market hours when it's needed most
- Stale regime data leads to wrong SL/TP multipliers
- Gemini cost spikes if not rate-limited (each analysis call costs tokens)
- Response format changes break parsing silently

**Prevention:**
1. Always have rule-based fallback: if Gemini fails, use ATR + MA crossover for basic regime detection
2. Cache regime results: market regime doesn't change minute-to-minute, cache for 30-60 minutes
3. Validate Gemini response structure with schema (zod) before using
4. Set hard timeout: 5 seconds max for Gemini call, fallback to cached result
5. Track Gemini usage and cost: alert when daily token usage exceeds threshold
6. Never block user actions waiting for Gemini response -- show result async

**Detection (warning signs):**
- Gemini response times > 5 seconds
- Unhandled promise rejections from AI service
- No fallback behavior when AI service returns error
- Token costs growing unexpectedly

**Phase relevance:** Phase 2-3 -- when improving AI calculations, build the fallback layer simultaneously.

---

## Minor Pitfalls

### Pitfall 10: VND Currency Precision and Unit Confusion

**What goes wrong:** VPBS API returns prices in "points" (thousands of VND). Code has `VPBS_TO_VND = 1000` conversion. Mixing up units (points vs VND) in calculations causes 1000x errors in position value, risk, or P&L.

**Prevention:**
1. Establish one canonical unit throughout the system (recommend VND everywhere, convert at API boundary)
2. Use TypeScript branded types: `type VND = number & { __brand: 'VND' }` and `type Points = number & { __brand: 'Points' }` to catch mismatches at compile time
3. Name all variables explicitly: `priceVnd`, `pricePoints`, never just `price`
4. Add assertion: `if (priceVnd < 1000) throw new Error('Suspicious VND value -- did you pass points?')`

**Phase relevance:** Phase 1 -- foundational type safety improvement.

---

### Pitfall 11: WebSocket Disconnection During Market Hours

**What goes wrong:** CONCERNS.md documents: "After 3 failed reconnection attempts, WebSocket silently stops trying." During peak hours, user's real-time prices freeze but UI shows no indication. Stop loss monitor may use stale prices.

**Prevention:**
1. Show prominent connection status indicator in trading UI
2. Stop loss monitor must check data freshness: if last price update > 60 seconds, flag as stale
3. Implement exponential backoff with unlimited retries (not 3-and-stop)
4. If disconnected > 30 seconds during market hours, show full-screen warning

**Phase relevance:** Phase 1-2 -- affects both portfolio and paper trading accuracy.

---

### Pitfall 12: Scenario Simulation Without Monte Carlo

**What goes wrong:** Current scenario simulation calculates basic P&L (entry/SL/TP). This gives exactly 3 outcomes (hit SL, hit TP, or flat). Real outcomes follow a distribution. Users don't understand the range of possible outcomes.

**Prevention:**
1. Implement simple Monte Carlo: sample from historical daily returns for the stock, simulate 1000 paths
2. Show distribution of outcomes: "50% chance of +2% to +8%, 30% chance of -1% to -5%, 20% chance of worse"
3. Use Geometric Brownian Motion with parameters from historical data as minimum viable model
4. Keep rule-based (not Gemini) -- Monte Carlo is deterministic math, don't waste LLM tokens on it

**Phase relevance:** Phase 3 -- advanced feature after core portfolio/paper trading work.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Portfolio/Paper Trading separation | Data migration -- existing orders/positions have no mode flag | Add migration with default `mode='PAPER'` for all existing records, let users recategorize |
| Portfolio: manual order entry | Users entering wrong price format (VND vs points) | Show current market price as reference, validate against recent price range (+/- 20%) |
| Paper Trading: realistic matching | Over-engineering matching engine | Start simple: add slippage + partial fill probability. Don't build full orderbook simulation in v1 |
| AI SL/TP improvements | Breaking existing positions when algorithm changes | Never retroactively change SL/TP on existing positions. New algorithm applies only to new calculations |
| AI regime detection | Testing only in bull market conditions | Backtest AI suggestions across 2020 COVID crash, 2022 bear market, 2024 recovery data |
| Risk calculation with correlation | Performance impact of correlation matrix | Cache correlation matrix, recalculate daily (not real-time). VN30 has only 30 stocks -- matrix is small |
| VN market rules engine | Rule changes by HOSE/HNX without notice | Subscribe to exchange announcements. Add `rules_version` field to validate against |
| T+2 settlement modeling | Holiday calendar maintenance | Use official HOSE/HNX holiday calendar API or maintain manual list updated annually |

---

## Anti-Patterns Specific to This Codebase

### Anti-Pattern: "AI" Label on Mechanical Calculations
ATR * multiplier is not AI. Labeling it as AI creates false authority and user over-reliance. Reserve "AI" label for Gemini-powered analysis (natural language reasoning about market conditions). Label mechanical calculations as "Rule-based" or "Volatility-based."

### Anti-Pattern: Instant Everything
Current fill engine fills instantly. Real markets have latency, queues, and rejection. Even for portfolio tracking, creating positions instantly without settlement modeling teaches wrong mental model. Add deliberate friction where the real market has friction.

### Anti-Pattern: Silent Failures
CONCERNS.md documents multiple silent failure modes: WebSocket stops reconnecting silently, localStorage fails silently, chart fails to render silently. In a trading context, silent failure is dangerous. Every failure must be visible to the user, especially during market hours.

---

## Sources

- Codebase analysis: `fillEngine.js`, `vnStockRules.ts`, `App.tsx`, CONCERNS.md, PROJECT.md
- [Live vs Simulation Trading Differences - PickMyTrade](https://blog.pickmytrade.trade/live-vs-simulation-differences-trading/)
- [TradeStation Paper Trading Fill Price Inaccuracy](https://blog.traderspost.io/article/tradestation-paper-trading-why-fill-prices-may-be-inaccurate)
- [AI for Algorithmic Trading: 7 Mistakes - Medium](https://alexhonchar.medium.com/ai-for-algorithmic-trading-7-mistakes-that-could-make-me-broke-a41f94048b8c)
- [AI Trading 2026: Investigative Deep-Dive - Medium](https://medium.com/@nancycampbell896azhelenwlidxh/i-tested-23-trading-platforms-and-lost-11-400-heres-what-actually-works-b83788257ab6)
- [Vietnam Stock Market Trading Rules 2026 - The Vietnam Yield](https://thevietnamyield.com/vietnam-stock-market-hours/)
- [HOSE Trading Regulations 2025](https://static2.vietstock.vn/vietstock/2025/4/29/20250429_20250429___hose___trading_regulations_on_hose.pdf)
- [TCBS Trading Regulations at HSX](https://help.tcbs.com.vn/en/trading-regulations-at-hsx-ho-chi-minh-stock-exchange/)
- [Portfolio Heat Management - Pro Trader Dashboard](https://protraderdashboard.com/blog/portfolio-heat-management/)
- [Position Sizing Risk Management - Medium](https://medium.com/@ZenoMontanari/position-sizing-the-one-risk-management-skill-that-actually-matters-a010fb8dfe74)
- [Minimum Tick Size and Market Quality in Vietnam - PMC/NIH](https://pmc.ncbi.nlm.nih.gov/articles/PMC10194971/)

---

*Concerns audit: 2026-03-26*
