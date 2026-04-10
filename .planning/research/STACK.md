# Technology Stack — Milestone 2 Libraries

**Project:** TradeGuard AI
**Researched:** 2026-03-26
**Scope:** Libraries needed for order matching simulation, probability-based TP, dynamic SL, AI capital allocation
**Constraint:** Existing stack (React 19 + Express.js + PostgreSQL + Gemini) is fixed. This research covers NEW dependencies only.

## Recommended New Dependencies

### 1. Technical Indicators: `trading-signals`

| Field | Value |
|-------|-------|
| Package | `trading-signals` |
| Version | ^7.4.3 |
| Purpose | ATR, RSI, Bollinger Bands, EMA, SMA -- streaming indicator computation |
| Confidence | HIGH |

**Why this, not alternatives:**
- Written in TypeScript from scratch (not JS with types bolted on) -- matches project direction
- Streaming API: feed candles one-by-one via `.add()`, get updated values -- perfect for real-time WebSocket price feeds the project already has
- Provides `getSignal()` returning BEARISH/BULLISH/SIDEWAYS -- useful for dynamic SL adjustment triggers
- Actively maintained (v7.4.3, published ~Feb 2026)

**Why NOT `technicalindicators`:** Last published 2+ years ago. No streaming API -- batch-only. Larger bundle. The project currently hand-rolls ATR in `aiService.js` (lines 71-80); `trading-signals` replaces this with tested, maintained code.

**Why NOT `fast-technical-indicators`:** Claims 2-6x performance over `technicalindicators`, but the project processes ~100 candles per symbol, not millions. Performance is irrelevant. `trading-signals` has better DX and TypeScript support.

### 2. Statistical Computation: `simple-statistics`

| Field | Value |
|-------|-------|
| Package | `simple-statistics` |
| Version | ^7.8.9 |
| Purpose | Standard deviation, percentiles, linear regression, probability distributions |
| Confidence | HIGH |

**Why:** Zero dependencies. 95+ statistical functions. Needed for:
- **Probability-based take profit:** Calculate probability distribution of price reaching TP levels using historical return data
- **Monte Carlo inputs:** Normal/log-normal distribution sampling
- **Dynamic SL:** Volatility percentile calculations to determine market regime
- **Capital allocation:** Sharpe ratio, correlation matrix inputs

**Why NOT `mathjs` for stats:** mathjs is 600KB+ (tree-shakeable but still large). simple-statistics is ~50KB, purpose-built for exactly these calculations. Use mathjs only if matrix operations are needed.

### 3. Math/Matrix Operations: `mathjs` (selective import)

| Field | Value |
|-------|-------|
| Package | `mathjs` |
| Version | ^14.6.0 |
| Purpose | Matrix operations for portfolio optimization (covariance matrix, matrix inversion) |
| Confidence | MEDIUM |

**Why:** Portfolio optimization (mean-variance, minimum variance) requires matrix math: covariance matrices, eigenvalue decomposition, matrix inversion. `mathjs` is the only mature JS library for this.

**Important:** Use selective imports only:
```typescript
import { matrix, multiply, transpose, inv, det } from 'mathjs';
```
Do NOT import the entire library. This keeps bundle impact manageable.

**Alternative considered:** Build matrix operations by hand. NOT recommended -- matrix inversion bugs cause silent wrong portfolio weights, which means wrong capital allocation. Use a tested library.

### 4. Order Matching Engine: Build Custom (no library)

| Field | Value |
|-------|-------|
| Package | N/A -- custom implementation |
| Purpose | Paper trading order matching simulation |
| Confidence | HIGH |

**Why no library:** All npm order matching libraries (`orderbook-engine`, `exchangeengine`, etc.) are either:
- Abandoned (last update 5-9 years ago)
- Designed for crypto exchange backends (not stock market simulation)
- Missing Vietnam stock market rules (T+2.5 settlement, lot size 100, tick size rules, ATO/ATC sessions, price band limits +/- 7% HOSE)

The project already has `tickSizeEngine.js` with Vietnam-specific tick size logic. The matching engine MUST respect:
- **Price bands:** +/- 7% HOSE, +/- 10% HNX, +/- 15% UPCOM
- **Lot sizes:** 100 shares (HOSE/HNX), 1 share (UPCOM odd lot)
- **Order types:** LO, MP, ATO, ATC
- **Session matching:** Continuous (9:15-11:30, 13:00-14:30), ATO (9:00-9:15), ATC (14:30-14:45)
- **Realistic fill simulation:** Partial fills, queue position estimation based on volume

**Build approach:** ~300-500 lines. A `PaperMatchingEngine` class that:
1. Maintains a virtual orderbook per symbol
2. Uses real VPBS price data as reference prices
3. Simulates fills based on real volume data + randomized queue position
4. Respects all Vietnam exchange rules above

### 5. Scheduling/Cron: Already have `node-cron` 3.0.3

| Field | Value |
|-------|-------|
| Package | `node-cron` (existing) |
| Purpose | Schedule dynamic SL recalculation, portfolio rebalancing signals |
| Confidence | HIGH |

**No new dependency needed.** Use existing `node-cron` to:
- Recalculate dynamic stop losses every N minutes during trading hours
- Run portfolio risk assessment after market close
- Trigger AI capital allocation review on schedule

### 6. UUID Generation: Already have `uuid` 9.0.0

No new dependency. Use for paper trading order IDs.

---

## What NOT to Install

| Library | Why Not |
|---------|---------|
| `portfolio-allocation` (npm) | v0.0.11, last published 5 years ago, 29 weekly downloads. Dead project. Build portfolio optimization using `mathjs` + `simple-statistics` + Gemini instead. |
| `technicalindicators` | Unmaintained. `trading-signals` is strictly better for this project. |
| `ta-lib` / `node-talib` | Native C++ binding. Painful to install, breaks on Node v24, overkill for the indicators needed. |
| `quantlib` (any JS port) | Massive, focused on derivatives pricing. Not needed for stock SL/TP. |
| `brain.js` / `tensorflow.js` | ML libraries. The project uses Gemini for AI -- don't add a second ML framework. |
| `pandas-js` / `dataframe-js` | Python-inspired dataframes. Unnecessary -- use plain arrays + `simple-statistics`. |
| Any Python bridge (child_process to Python) | Adds deployment complexity, latency, and failure modes. Keep everything in Node.js. |

---

## How Libraries Map to Features

### Feature 1: Realistic Order Matching (Paper Trading)

| Need | Solution |
|------|----------|
| Orderbook simulation | Custom `PaperMatchingEngine` |
| Tick size validation | Existing `tickSizeEngine.js` |
| Price band limits | Custom rules (constants from exchange) |
| Fill delay simulation | `setTimeout` + random delay based on volume |
| Real price reference | Existing VPBS WebSocket integration |

### Feature 2: Probability-Based Take Profit

| Need | Solution |
|------|----------|
| Historical return distribution | `simple-statistics`: standardDeviation, quantile, cumulativeStdNormalProbability |
| ATR for volatility bands | `trading-signals`: ATR indicator |
| Probability of reaching price X | Custom: CDF of log-normal distribution using `simple-statistics` |
| Multiple TP levels with probabilities | Custom calculation: for each level, compute P(price >= level) |
| AI narrative explanation | Existing Gemini integration |

**Algorithm sketch:**
```
1. Get 60-day daily returns
2. Fit log-normal distribution (mean, stddev via simple-statistics)
3. For each TP level, calculate P(reaching level within N days)
4. Return: { level: price, probability: 0.72, timeframe: "5 days" }
5. Pass to Gemini for human-readable explanation
```

### Feature 3: Dynamic Stop Loss Adjustment

| Need | Solution |
|------|----------|
| Real-time ATR tracking | `trading-signals`: ATR with streaming updates |
| Bollinger Band width for volatility regime | `trading-signals`: BollingerBands |
| Market regime detection | Existing Gemini market regime analysis |
| Trailing stop logic | Custom: ATR-multiplier trailing, with regime-adjusted multiplier |
| Periodic recalculation | Existing `node-cron` |

**Algorithm sketch:**
```
1. Every 5 min during trading hours:
   a. Update ATR(14) with latest candle
   b. Check Bollinger Band width percentile (volatility regime)
   c. If high volatility: widen multiplier (2.5x ATR)
   d. If low volatility: tighten multiplier (1.5x ATR)
   e. New SL = max(current_SL, price - multiplier * ATR)  // trailing: never moves down
2. If market regime changed (from Gemini): adjust multiplier table
3. Emit WebSocket event to frontend with updated SL
```

### Feature 4: AI Capital Allocation

| Need | Solution |
|------|----------|
| Correlation matrix | `simple-statistics` (pairwise correlation) + `mathjs` (matrix construction) |
| Portfolio variance | `mathjs`: matrix multiplication (w' * Cov * w) |
| Optimization solver | Custom: iterative mean-variance with constraints (min/max per position) |
| Risk metrics (Sharpe, Sortino) | `simple-statistics`: mean, standardDeviation on excess returns |
| AI recommendation narrative | Existing Gemini integration |
| Position sizing (Kelly criterion) | Custom: `f* = (bp - q) / b` using `simple-statistics` for win rate |

**Why not a full optimizer library:** The project doesn't need Markowitz frontier visualization or 50 optimization methods. It needs: "given N positions with correlations, suggest weights that maximize risk-adjusted return within constraints." This is ~100 lines with `mathjs` for matrix ops + a simple gradient descent or equal-risk-contribution algorithm.

---

## Installation

```bash
# In ai-stoploss-engine-be/
npm install trading-signals simple-statistics mathjs
```

**Total new dependencies: 3 packages.**

Bundle impact estimate:
- `trading-signals`: ~80KB (TypeScript, tree-shakeable)
- `simple-statistics`: ~50KB (zero dependencies)
- `mathjs`: ~600KB total, but with selective imports ~100KB effective

---

## Version Verification

| Package | Version | Last Published | Weekly Downloads | Source |
|---------|---------|----------------|------------------|--------|
| trading-signals | 7.4.3 | ~Feb 2026 | Active | [npm](https://www.npmjs.com/package/trading-signals), [GitHub](https://github.com/bennycode/trading-signals) |
| simple-statistics | 7.8.9 | ~Mar 2026 | Active | [npm](https://www.npmjs.com/package/simple-statistics), [GitHub](https://github.com/simple-statistics/simple-statistics) |
| mathjs | 14.6.0 | ~Jan 2026 | Very active | [npm](https://www.npmjs.com/package/mathjs), [GitHub](https://github.com/josdejong/mathjs) |

---

## Confidence Assessment

| Recommendation | Confidence | Reasoning |
|---------------|------------|-----------|
| `trading-signals` for indicators | HIGH | Verified active on npm/GitHub, TypeScript-native, streaming API matches architecture |
| `simple-statistics` for stats | HIGH | Well-known, zero-dep, verified active, 95+ functions cover all needs |
| `mathjs` for matrix ops | MEDIUM | Verified active. Risk: might be overkill if capital allocation stays simple. Can defer if portfolio optimization scope shrinks. |
| Custom order matching engine | HIGH | No viable npm alternatives for Vietnam stock market rules. Custom is the only correct answer. |
| No Python bridge | HIGH | Project constraint: keep Node.js stack. Python adds unnecessary complexity. |

---

*Researched: 2026-03-26*
