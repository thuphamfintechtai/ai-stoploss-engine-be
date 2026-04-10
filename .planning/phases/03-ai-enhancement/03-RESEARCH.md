# Phase 3: AI Enhancement - Research

**Researched:** 2026-03-27
**Domain:** AI-enhanced trading risk management (Dynamic SL, Probability TP, Capital Allocation)
**Confidence:** HIGH

## Summary

Phase 3 nang cap 3 module AI: (1) Dynamic Stop Loss voi ATR streaming + regime detection rule-based, (2) Probability-based Take Profit dua tren log-normal distribution tu historical returns, (3) AI Capital Allocation voi half-Kelly criterion + risk budget visualization. Tat ca deu dung `trading-signals` va `simple-statistics` lam core computation, Gemini chi viet narrative text.

Codebase hien tai co `aiService.js` (~840 lines) voi ATR tu viet (lines 71-82), regime detection qua Gemini (ham `detectMarketRegime`), va SL/TP suggestion ATR-based (`suggestStopLossTakeProfit`). Phase nay thay the ATR tu viet bang `trading-signals` streaming API, them probability calculation tu `simple-statistics`, va tach code thanh nhieu module rieng thay vi gop chung 1 file.

**Primary recommendation:** Tach `aiService.js` thanh 3 module rieng (`dynamicStopLoss.js`, `probabilityTP.js`, `capitalAllocation.js`) + 1 shared `regimeDetector.js`. Install `trading-signals` + `simple-statistics` vao backend. Upgrade `stopLossMonitor.js` de monitor ca REAL positions voi dynamic SL recalculation moi 5 phut.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** SL recalculate moi 5 phut trong gio giao dich qua node-cron worker
- **D-02:** Dung `trading-signals` package (^7.4.3) thay the ATR tu viet trong aiService.js -- streaming API, TypeScript-native
- **D-03:** Regime detection: Bollinger Band percentile > 70 = VOLATILE, SMA50/SMA200 crossover cho BULLISH/BEARISH, else SIDEWAYS
- **D-04:** SL thich ung regime: VOLATILE -> mo rong ATR multiplier 2.5x, TRENDING -> standard 1.5x, SIDEWAYS -> thu hep 1.0x
- **D-05:** Trailing stop thong minh: khoang cach = ATR x regime_multiplier. Mo rong khi vol cao, thu hep khi thap
- **D-06:** Clamp SL trong bien do gia san (HOSE +/-7%, HNX +/-10%) -- dung vnStockRules.ts
- **D-07:** Gemini narrative giai thich TAI SAO SL thay doi, voi fallback rule-based khi API timeout 5s
- **D-08:** Cache regime 30 phut -- khong goi Gemini moi 5 phut
- **D-09:** Dung `simple-statistics` package (^7.8.9) cho log-normal distribution, percentile, CDF
- **D-10:** Tinh probability tu 60-200 ngay du lieu OHLCV lich su (daily returns)
- **D-11:** Hien thi 3-5 muc TP voi xac suat + timeframe: "70% dat 25,500 VND trong 5 ngay"
- **D-12:** Thay the TP co hoc (ATR x RR) bang probability-based lam default suggestion
- **D-13:** Label "experimental" cho probability-based TP -- thu thap feedback
- **D-14:** Fallback: neu khong du du lieu lich su (< 60 ngay), dung ATR x RR cu voi warning
- **D-15:** Kelly Criterion phan so (half-Kelly recommended): f* = (p x b - q) / b x 0.5, voi p = win rate, b = avg win/avg loss
- **D-16:** Win rate va avg R:R tinh tu closed positions (ca REAL va PAPER)
- **D-17:** Risk budget visualization: gauge hien thi "Da dung X% ngan sach rui ro" -- tai su dung RiskManagerView pattern
- **D-18:** Rebalancing suggestion qua Gemini: "HPG chiem 40% portfolio -- xem xet giam" voi fallback rule-based (> 30% = warn)
- **D-19:** Sector classification hardcode cho VN stocks pho bien (banking, real estate, tech, retail,...)

### Claude's Discretion
- Cach to chuc code cho 3 AI modules (tach file hay gop)
- Chart/visualization cho probability distribution
- Caching strategy cho historical OHLCV data
- Error handling khi VPBS API khong tra du historical data

### Deferred Ideas (OUT OF SCOPE)
- Correlation analysis between positions -- needs large historical data, defer to v2
- Monte Carlo for SL optimization -- defer to Phase 4 (Risk Simulation)
- Machine learning model training -- too complex for v1, rule-based + Gemini sufficient
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AISL-01 | SL tu dong dieu chinh theo ATR hien tai | `trading-signals` ATR streaming API thay the hand-rolled ATR. Dynamic recalculation in worker. |
| AISL-02 | SL thich ung voi regime thi truong qua Bollinger Band percentile | `trading-signals` BollingerBands + SMA indicators. Rule-based regime detector module. |
| AISL-03 | Trailing stop thong minh: mo rong khi vol cao, thu hep khi thap | Regime-adaptive multiplier table (D-04). Existing trailing stop logic in stopLossMonitor.js. |
| AISL-04 | SL nam trong bien do gia san (HOSE +/-7%, HNX +/-10%) | `vnStockRules.ts` co san frontend. Can port/re-export cho backend hoac dung `tickSizeEngine.js`. |
| AISL-05 | Worker recalculate SL moi 5 phut trong gio giao dich | Existing `stopLossMonitor.js` worker pattern. Them dynamic SL cron job. |
| AISL-06 | AI narrative giai thich TAI SAO SL thay doi | Existing Gemini integration pattern (`callGeminiJSON`). Fallback rule-based text generation. |
| AITP-01 | TP dua tren phan phoi thong ke log-normal tu du lieu lich su | `simple-statistics`: mean, standardDeviation, cumulativeStdNormalProbability. Custom log-normal CDF. |
| AITP-02 | Hien thi 3-5 muc TP voi xac suat tuong ung | Computed from CDF at each TP level. Frontend integration in TradingTerminal.tsx. |
| AITP-03 | Thay the TP co hoc bang TP probability-based lam default | Upgrade `suggestStopLossTakeProfit` response format. Keep ATR x RR as fallback. |
| AITP-04 | Label "experimental" cho probability-based TP, thu thap feedback | Frontend label + backend metadata field `experimental: true`. |
| AICAP-01 | AI suggest position sizing (Kelly Criterion variant) | Half-Kelly formula: f* = (p*b - q)/b * 0.5. Stats from closed positions query. |
| AICAP-02 | Visualization risk budget toan portfolio | Reuse `RiskGauge` component from RiskManagerView.tsx. Extend RiskCalculator. |
| AICAP-03 | AI rebalancing suggestions | Sector concentration check (hardcode VN sectors). Gemini narrative + rule-based fallback. |
</phase_requirements>

## Standard Stack

### Core (New Dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| trading-signals | ^7.4.3 | ATR, BollingerBands, SMA streaming indicators | TypeScript-native, streaming API via `.add()`, `getResult()`. Thay the ATR tu viet trong aiService.js |
| simple-statistics | ^7.8.9 | Standard deviation, mean, CDF, percentile | Zero dependencies, 95+ functions. Dung cho probability-based TP va Kelly Criterion stats |

### Existing (No Change)
| Library | Version | Purpose |
|---------|---------|---------|
| node-cron | 3.0.3 | Dynamic SL recalculation cron (5min intervals) |
| @google/generative-ai | 0.21.0 | Gemini narrative text generation |
| recharts | 3.7.0 | Probability distribution chart, risk budget gauge |
| socket.io | 4.6.1 | Real-time SL update broadcast |

### NOT Installing
| Library | Reason |
|---------|--------|
| mathjs | D-15 half-Kelly la cong thuc don gian, khong can matrix ops. Defer mathjs den Phase 4 (correlation matrix) |
| brain.js / tensorflow.js | Project dung Gemini cho AI -- khong them ML framework thu 2 |

**Installation:**
```bash
cd ai-stoploss-engine-be
npm install trading-signals@^7.4.3 simple-statistics@^7.8.9
```

**Version verification:**
| Package | npm Latest | Decision Version | Status |
|---------|-----------|-----------------|--------|
| trading-signals | 7.4.3 | ^7.4.3 | OK - current |
| simple-statistics | 7.8.9 | ^7.8.9 | OK - current |

## Architecture Patterns

### Recommended Module Structure
```
ai-stoploss-engine-be/services/
  ai/
    dynamicStopLoss.js       # AISL-01..06: ATR streaming, regime multiplier, SL clamp
    probabilityTP.js         # AITP-01..04: Log-normal CDF, multi-level TP
    capitalAllocation.js     # AICAP-01..03: Half-Kelly, risk budget, rebalancing
    regimeDetector.js        # Shared: BB percentile + SMA crossover = regime
    indicatorCache.js        # Shared: Cache ATR/BB/SMA instances per symbol
    sectorClassification.js  # AICAP-03: Hardcoded VN sector map
  aiService.js               # KEEP: Existing Gemini helpers (callGeminiJSON, etc.)
  shared/
    riskCalculator.js        # EXTEND: Add Kelly criterion + portfolio risk budget
```

### Pattern 1: Indicator Streaming Cache
**What:** Moi symbol co 1 bo indicator instances (ATR, BB, SMA) duoc cache va update streaming.
**When to use:** Worker recalculate SL moi 5 phut -- khong can re-create indicators tu dau.

```javascript
// ai/indicatorCache.js
import { ATR, BollingerBands, SMA } from 'trading-signals';

const cache = new Map(); // symbol -> { atr, bb, sma50, sma200, lastUpdate }
const CACHE_TTL = 30 * 60 * 1000; // 30 min (D-08)

export function getOrCreateIndicators(symbol, period = 14) {
  if (!cache.has(symbol)) {
    cache.set(symbol, {
      atr: new ATR(period),
      bb: new BollingerBands(20, 2),  // 20-period, 2 std dev
      sma50: new SMA(50),
      sma200: new SMA(200),
      lastUpdate: 0,
      regime: null,
      regimeTimestamp: 0,
    });
  }
  return cache.get(symbol);
}

export function feedCandle(symbol, candle) {
  const ind = getOrCreateIndicators(symbol);
  // ATR needs {high, low, close} object
  ind.atr.add({ high: candle.high, low: candle.low, close: candle.close });
  ind.bb.add(candle.close);
  ind.sma50.add(candle.close);
  ind.sma200.add(candle.close);
  ind.lastUpdate = Date.now();
}
```

### Pattern 2: Rule-Based Regime Detection (D-03)
**What:** Detect market regime tu BB percentile + SMA crossover, KHONG dung Gemini.
**When to use:** Moi 5 phut khi recalculate SL. Gemini chi dung cho narrative text.

```javascript
// ai/regimeDetector.js
export function detectRegime(indicators) {
  const { bb, sma50, sma200 } = indicators;

  if (!bb.isStable || !sma50.isStable) return 'SIDEWAYS'; // default

  const bbResult = bb.getResult();
  const price = bbResult.middle; // current middle band
  const bbWidth = bbResult.upper - bbResult.lower;
  const bbPercentile = bbWidth / bbResult.middle * 100;

  // D-03: BB percentile > 70 = VOLATILE
  if (bbPercentile > 70) return 'VOLATILE';

  // SMA crossover: SMA50 > SMA200 = BULLISH
  if (sma200.isStable) {
    const sma50Val = sma50.getResult();
    const sma200Val = sma200.getResult();
    if (sma50Val > sma200Val) return 'BULLISH';
    if (sma50Val < sma200Val) return 'BEARISH';
  }

  return 'SIDEWAYS';
}

// D-04: Regime -> ATR multiplier
export const REGIME_MULTIPLIERS = {
  VOLATILE: 2.5,
  BULLISH: 1.5,
  BEARISH: 1.5,
  SIDEWAYS: 1.0,
};
```

### Pattern 3: Probability-Based TP via Log-Normal CDF (D-09..D-11)
**What:** Tinh xac suat gia dat muc TP dua tren phan phoi log-normal cua daily returns.
**When to use:** Khi user request SL/TP suggestion.

```javascript
// ai/probabilityTP.js
import ss from 'simple-statistics';

export function calculateTPProbabilities(ohlcvData, currentPrice, timeframeDays = [3, 5, 10, 20]) {
  if (ohlcvData.length < 60) return null; // D-14: fallback

  // Daily log returns
  const closes = ohlcvData.map(c => c.close).filter(Boolean);
  const logReturns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i-1] > 0) {
      logReturns.push(Math.log(closes[i] / closes[i-1]));
    }
  }

  const mu = ss.mean(logReturns);       // daily mean log return
  const sigma = ss.standardDeviation(logReturns); // daily std dev

  const tpLevels = [];
  const percentiles = [0.25, 0.50, 0.75, 0.90]; // target probability thresholds

  for (const days of timeframeDays) {
    // N-day parameters (log-normal scaling)
    const muN = mu * days;
    const sigmaN = sigma * Math.sqrt(days);

    for (const pTarget of percentiles) {
      // Price level where P(reach) = pTarget
      // Z-score for (1 - pTarget) since we want P(price >= level) = pTarget
      const z = ss.probit(1 - pTarget); // inverse CDF
      const logReturn = muN + sigmaN * z;
      const targetPrice = currentPrice * Math.exp(logReturn);

      if (targetPrice > currentPrice) {
        tpLevels.push({
          price: Math.round(targetPrice),
          probability: Math.round(pTarget * 100),
          timeframe_days: days,
          label: `${Math.round(pTarget * 100)}% dat ${Math.round(targetPrice).toLocaleString('vi-VN')} trong ${days} ngay`,
        });
      }
    }
  }

  return {
    levels: tpLevels.slice(0, 5), // D-11: 3-5 levels
    data_quality: {
      days_used: closes.length,
      mu_daily: mu,
      sigma_daily: sigma,
    },
    experimental: true, // D-13
  };
}
```

### Pattern 4: Half-Kelly Position Sizing (D-15..D-16)
**What:** Tinh recommended position size tu win rate + avg R:R cua closed positions.

```javascript
// ai/capitalAllocation.js
export function calculateHalfKelly(winRate, avgWinLoss) {
  // f* = (p * b - q) / b * 0.5
  // p = win rate, q = 1 - p, b = avg win / avg loss
  const p = Math.max(0, Math.min(1, winRate));
  const q = 1 - p;
  const b = Math.max(0.01, avgWinLoss); // avoid division by zero

  const kelly = (p * b - q) / b;
  const halfKelly = Math.max(0, kelly * 0.5); // D-15: half-Kelly, floor at 0

  return {
    kelly_fraction: kelly,
    half_kelly: halfKelly,
    recommended_percent: Math.min(halfKelly * 100, 25), // cap at 25%
    interpretation: kelly <= 0
      ? 'Negative expectancy -- khong nen tang vi the'
      : `Nen dau tu ${(halfKelly * 100).toFixed(1)}% von vao vi the nay`,
  };
}
```

### Anti-Patterns to Avoid
- **KHONG** goi Gemini de tinh so -- Gemini chi viet text narrative. Moi phep tinh (ATR, BB, CDF, Kelly) deu rule-based.
- **KHONG** re-create indicator instances moi lan recalculate -- cache va stream data.
- **KHONG** tu dong thay doi SL cua user -- luon yeu cau xac nhan hoac hien thi "de xuat" de user chon.
- **KHONG** tinh win rate tu < 10 closed positions -- so lieu khong du tin cay, hien thi warning.
- **KHONG** dung `detectMarketRegime` (Gemini-based) cho 5-min SL recalculation -- dung rule-based `detectRegime` thay the.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ATR calculation | calcATR() trong aiService.js lines 71-82 | `trading-signals` ATR class | Streaming API, tested, handles edge cases (insufficient data) |
| Bollinger Bands | Tu tinh upper/lower bands | `trading-signals` BollingerBands class | Precision, stability check via `.isStable` |
| SMA 50/200 | Tu tinh moving average | `trading-signals` SMA class | Consistency voi ATR/BB, same streaming pattern |
| Standard deviation | Math tu viet | `simple-statistics` standardDeviation | Handles edge cases, Bessel's correction for sample |
| CDF / probability | Tu viet normal distribution | `simple-statistics` cumulativeStdNormalProbability + probit | Mathematically correct, tested |
| Percentile | Tu sort va tinh | `simple-statistics` quantile/quantileSorted | Handles interpolation correctly |

## Common Pitfalls

### Pitfall 1: Regime Detection Spam Gemini API
**What goes wrong:** Goi Gemini moi 5 phut de detect regime -> rate limit, cost cao, latency.
**Why it happens:** detectMarketRegime() hien tai dung Gemini thuần.
**How to avoid:** D-03 da lock: dung Bollinger Band percentile + SMA crossover (rule-based). Gemini chi viet narrative text, cache 30 phut (D-08). regimeDetector.js la pure math, khong co API call.
**Warning signs:** Gemini API usage tang vot, latency > 5s cho SL recalculation.

### Pitfall 2: Log-Normal Assumption Sai Cho VN Market
**What goes wrong:** VN market co gia tran/san (+/-7% HOSE, +/-10% HNX) nen daily returns bi truncated, khong thuc su log-normal.
**Why it happens:** Price band limits tao fat tails va ceiling/floor effects.
**How to avoid:** (1) Clamp TP levels trong price band, (2) Label "experimental" (D-13), (3) Hien thi caveat "Probability gia dinh phan phoi log-normal, co the khong chinh xac khi gia tran/san", (4) Dung du lieu 60-200 ngay de smooth out extremes.
**Warning signs:** TP probability 90%+ cho target > 7% gain trong 1 ngay.

### Pitfall 3: Dynamic SL Tu Dong Move Xuong
**What goes wrong:** SL moi thap hon SL cu -> tang risk cho user ma khong biet.
**Why it happens:** Khi regime chuyen tu SIDEWAYS (1.0x) sang VOLATILE (2.5x), SL mo rong.
**How to avoid:** Trailing logic: SL chi duoc move LEN (LONG) hoac XUONG (SHORT) de bao ve loi nhuan. Khi regime mo rong multiplier, SL moi = max(SL_cu, price - ATR * new_multiplier). KHONG BAO GIO ha SL xuong duoi SL cu.
**Warning signs:** SL distance tang sau khi regime change.

### Pitfall 4: Insufficient Historical Data for Probability TP
**What goes wrong:** User co ma CK moi list < 60 ngay, khong du data cho log-normal fit.
**Why it happens:** VPBS API co the tra < 60 ngay cho ma moi hoac ma it giao dich.
**How to avoid:** D-14: fallback ve ATR x RR cu voi warning "Khong du du lieu lich su de tinh xac suat". Quality gate: check `ohlcvData.length >= 60` truoc khi chay probability.
**Warning signs:** `data_quality.days_used < 60` trong response.

### Pitfall 5: Kelly Criterion Voi Win Rate Thap
**What goes wrong:** Half-Kelly tra ve 0% hoac negative khi win rate < 50% va R:R thap. User confused.
**Why it happens:** Kelly formula ket qua negative khi expected value am.
**How to avoid:** (1) Khi kelly <= 0, hien thi warning "He thong chua co loi the thong ke -- can cai thien strategy", (2) Minimum 10 closed positions de tinh (khong tinh tu 2-3 trades), (3) Separate REAL va PAPER stats de user so sanh.
**Warning signs:** `kelly_fraction <= 0` va user van muon tang size.

### Pitfall 6: Worker Overload Khi Nhieu Positions
**What goes wrong:** 5-min SL recalculation cho N positions x M symbols -> nhieu API calls, timeout.
**Why it happens:** Moi position can fetch candle data tu VPBS.
**How to avoid:** Group positions by symbol (da co trong stopLossMonitor.js), fetch candle 1 lan/symbol. Cache indicator instances (Pattern 1). Limit concurrent API calls.
**Warning signs:** Worker cycle > 60s, VPBS API rate limit.

### Pitfall 7: SL Vuot Price Band Limits
**What goes wrong:** AI tinh SL tai -8% nhung HOSE chi cho -7%. SL khong bao gio trigger.
**Why it happens:** ATR x multiplier co the vuot bien do gia san.
**How to avoid:** D-06: Clamp SL trong bien do. Backend co `tickSizeEngine.js` voi `snapToTickSize`. Can them price band validation: `sl_vnd >= ref_price * (1 - band_limit)`. Frontend co `vnStockRules.ts` -- port logic price band sang backend hoac tao shared utility.
**Warning signs:** SL distance > 7% cho HOSE stocks.

## Code Examples

### Example 1: Dynamic SL Worker Integration

```javascript
// workers/stopLossMonitor.js -- UPGRADE
// Them vao existing checkAndClosePositions function

import { getOrCreateIndicators, feedCandle } from '../services/ai/indicatorCache.js';
import { detectRegime, REGIME_MULTIPLIERS } from '../services/ai/regimeDetector.js';
import { snapToTickSize } from '../services/tickSizeEngine.js';

async function recalculateDynamicSL(positions, candle, symbol) {
  const indicators = getOrCreateIndicators(symbol);
  feedCandle(symbol, candle);

  if (!indicators.atr.isStable) return; // chua du data

  const regime = detectRegime(indicators);
  const multiplier = REGIME_MULTIPLIERS[regime];
  const atrValue = Number(indicators.atr.getResult());

  for (const pos of positions) {
    if (pos.stop_type !== 'DYNAMIC') continue; // chi xu ly dynamic SL

    const isLong = (pos.side || 'LONG') === 'LONG';
    const currentSL = parseFloat(pos.stop_loss);

    let newSL;
    if (isLong) {
      newSL = candle.close - atrValue * multiplier;
      newSL = Math.max(newSL, currentSL); // TRAILING: chi tang, khong giam
    } else {
      newSL = candle.close + atrValue * multiplier;
      newSL = Math.min(newSL, currentSL); // TRAILING: chi giam, khong tang
    }

    // D-06: Clamp to price band
    const exchange = pos.exchange || 'HOSE';
    const bandLimit = exchange === 'HNX' ? 0.10 : 0.07; // HOSE 7%, HNX 10%
    const floorPrice = candle.close * (1 - bandLimit);
    if (isLong) newSL = Math.max(newSL, floorPrice);

    newSL = snapToTickSize(Math.round(newSL), exchange);

    if (newSL !== currentSL) {
      // Update position SL
      await Position.update(pos.id, { stopLoss: newSL });
      // Broadcast via WebSocket
      // Log to ExecutionLog
    }
  }
}
```

### Example 2: Fetch Historical OHLCV for Probability TP

```javascript
// controllers/ai.controller.js -- upgrade suggestSLTP
async function fetchHistoricalOHLCV(symbol, exchange, days = 200) {
  const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
  const url = `${API_BASE}/api/market/symbols/${encodeURIComponent(symbol)}/ohlcv?timeframe=1d&limit=${days}&exchange=${exchange}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json?.data || [];
  } catch {
    return [];
  }
}
```

### Example 3: Sector Classification (D-19)

```javascript
// ai/sectorClassification.js
export const VN_SECTOR_MAP = {
  // Banking
  VCB: 'BANKING', BID: 'BANKING', CTG: 'BANKING', TCB: 'BANKING',
  MBB: 'BANKING', ACB: 'BANKING', VPB: 'BANKING', STB: 'BANKING',
  HDB: 'BANKING', TPB: 'BANKING', LPB: 'BANKING', MSB: 'BANKING',
  // Real Estate
  VHM: 'REAL_ESTATE', VIC: 'REAL_ESTATE', NVL: 'REAL_ESTATE',
  KDH: 'REAL_ESTATE', DXG: 'REAL_ESTATE', PDR: 'REAL_ESTATE',
  // Technology
  FPT: 'TECHNOLOGY', CMG: 'TECHNOLOGY',
  // Retail
  MWG: 'RETAIL', PNJ: 'RETAIL', DGW: 'RETAIL',
  // Steel
  HPG: 'STEEL', HSG: 'STEEL', NKG: 'STEEL',
  // Securities
  SSI: 'SECURITIES', VCI: 'SECURITIES', HCM: 'SECURITIES',
  // Energy
  GAS: 'ENERGY', POW: 'ENERGY', PLX: 'ENERGY',
  // Consumer
  VNM: 'CONSUMER', SAB: 'CONSUMER', MSN: 'CONSUMER',
};

export const SECTOR_LABELS = {
  BANKING: 'Ngan hang',
  REAL_ESTATE: 'Bat dong san',
  TECHNOLOGY: 'Cong nghe',
  RETAIL: 'Ban le',
  STEEL: 'Thep',
  SECURITIES: 'Chung khoan',
  ENERGY: 'Nang luong',
  CONSUMER: 'Hang tieu dung',
  OTHER: 'Khac',
};

export function getSector(symbol) {
  return VN_SECTOR_MAP[symbol?.toUpperCase()] || 'OTHER';
}
```

### Example 4: Win Rate Stats Query for Kelly (D-16)

```sql
-- Query closed positions for win rate calculation
SELECT
  context,
  COUNT(*) AS total_trades,
  COUNT(*) FILTER (WHERE profit_loss_vnd > 0) AS wins,
  COUNT(*) FILTER (WHERE profit_loss_vnd <= 0) AS losses,
  COALESCE(AVG(profit_loss_vnd) FILTER (WHERE profit_loss_vnd > 0), 0) AS avg_win,
  COALESCE(ABS(AVG(profit_loss_vnd) FILTER (WHERE profit_loss_vnd < 0)), 1) AS avg_loss
FROM financial.positions
WHERE portfolio_id = $1
  AND status IN ('CLOSED_SL', 'CLOSED_TP', 'CLOSED_MANUAL')
GROUP BY context;
```

## State of the Art

| Old Approach (Current) | New Approach (Phase 3) | Impact |
|------------------------|----------------------|--------|
| ATR tinh 1 lan khi dat lenh (aiService.js line 71-82) | ATR streaming qua trading-signals, recalculate moi 5 phut | SL phan ung voi thay doi volatility real-time |
| Regime detection qua Gemini API (detectMarketRegime) | Rule-based BB percentile + SMA crossover | Nhanh, khong ton token, khong co latency |
| TP = ATR x RR ratio (co hoc) | Probability-based TP tu log-normal distribution | User thay % xac suat, khong chi target price |
| Position sizing = max risk / risk per share | Half-Kelly dua tren win rate + avg R:R | Sizing dua tren evidence thong ke |
| Risk budget = % of total balance | Sector-aware risk budget + concentration warning | Tranh over-concentration nganh banking |
| stopLossMonitor chi monitor PAPER | Monitor ca REAL va PAPER voi dynamic SL | REAL positions cung duoc bao ve |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 |
| Config file | `ai-stoploss-engine-be/vitest.config.js` |
| Quick run command | `cd ai-stoploss-engine-be && npx vitest run --reporter=verbose` |
| Full suite command | `cd ai-stoploss-engine-be && npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AISL-01 | ATR streaming recalculation | unit | `npx vitest run tests/services/dynamicStopLoss.test.js -t "ATR"` | Wave 0 |
| AISL-02 | Regime detection BB + SMA | unit | `npx vitest run tests/services/regimeDetector.test.js` | Wave 0 |
| AISL-03 | Trailing stop regime-adaptive | unit | `npx vitest run tests/services/dynamicStopLoss.test.js -t "trailing"` | Wave 0 |
| AISL-04 | SL clamp to price band | unit | `npx vitest run tests/services/dynamicStopLoss.test.js -t "clamp"` | Wave 0 |
| AISL-05 | Worker 5-min recalculation | integration | `npx vitest run tests/services/dynamicStopLoss.test.js -t "worker"` | Wave 0 |
| AISL-06 | Gemini narrative + fallback | unit | `npx vitest run tests/services/dynamicStopLoss.test.js -t "narrative"` | Wave 0 |
| AITP-01 | Log-normal probability calc | unit | `npx vitest run tests/services/probabilityTP.test.js -t "probability"` | Wave 0 |
| AITP-02 | Multi-level TP display | unit | `npx vitest run tests/services/probabilityTP.test.js -t "levels"` | Wave 0 |
| AITP-03 | Default suggestion upgrade | integration | `npx vitest run tests/services/probabilityTP.test.js -t "default"` | Wave 0 |
| AITP-04 | Experimental label | unit | `npx vitest run tests/services/probabilityTP.test.js -t "experimental"` | Wave 0 |
| AICAP-01 | Half-Kelly calculation | unit | `npx vitest run tests/services/capitalAllocation.test.js -t "kelly"` | Wave 0 |
| AICAP-02 | Risk budget visualization data | unit | `npx vitest run tests/services/capitalAllocation.test.js -t "budget"` | Wave 0 |
| AICAP-03 | Rebalancing suggestion | unit | `npx vitest run tests/services/capitalAllocation.test.js -t "rebalance"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd ai-stoploss-engine-be && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd ai-stoploss-engine-be && npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/services/dynamicStopLoss.test.js` -- covers AISL-01..06
- [ ] `tests/services/regimeDetector.test.js` -- covers AISL-02 regime logic
- [ ] `tests/services/probabilityTP.test.js` -- covers AITP-01..04
- [ ] `tests/services/capitalAllocation.test.js` -- covers AICAP-01..03
- [ ] `tests/helpers/indicatorMocks.js` -- mock trading-signals instances

## Project Constraints (from CLAUDE.md)

- **Tech stack:** Giu nguyen React + Express + PostgreSQL + Gemini -- khong thay doi stack
- **AI provider:** Google Gemini (da tich hop) -- toi uu usage, khong spam API
- **Market data:** VPBS API -- phu thuoc vao gio giao dich san VN
- **Brownfield:** Code da co, can refactor khong phai rebuild
- **Git:** KHONG co Co-Authored-By, commit message conventional commits, nhieu commit nho
- **GSD Workflow:** Khong make direct repo edits ngoai GSD workflow

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | Yes | v24.10.0 | -- |
| PostgreSQL | Stats queries, position data | Yes | Running | -- |
| npm | Package install | Yes | v10+ | -- |
| VPBS API | Historical OHLCV data | External (market hours) | -- | Fallback to cached data or ATR x RR |
| Gemini API | Narrative text | External (API key required) | -- | Rule-based fallback text (D-07) |

**Missing dependencies with no fallback:** None

**Missing dependencies with fallback:**
- VPBS API (external, market hours only) -- fallback: cached data + ATR x RR for TP
- Gemini API (external, may timeout) -- fallback: rule-based text generation

## Open Questions

1. **Price band validation backend utility**
   - What we know: Frontend co `vnStockRules.ts` voi `snapToTickSize`, `getPriceStep`. Backend co `tickSizeEngine.js` voi `snapToTickSize` nhung KHONG co price band limits (+/-7%, +/-10%).
   - What's unclear: Nen port price band logic tu frontend sang backend, hay tao utility moi?
   - Recommendation: Tao `priceBandValidator.js` trong `services/shared/` voi `getFloorPrice(refPrice, exchange)` va `getCeilingPrice(refPrice, exchange)`. Don gian -- chi can reference price va exchange.

2. **stopLossMonitor scope: REAL + PAPER or chi PAPER?**
   - What we know: Hien tai chi monitor PAPER (context guard line 365-371). D-01 noi recalculate SL -- nhung khong specify context.
   - What's unclear: REAL positions co can dynamic SL monitor khong? User nhap lenh tu san, SL co the khong co.
   - Recommendation: Monitor REAL positions chi khi `stop_loss IS NOT NULL AND stop_type = 'DYNAMIC'`. Position REAL co the co SL null (schema cho phep). Worker kiem tra dieu kien nay.

3. **Historical OHLCV API limit**
   - What we know: D-10 yeu cau 60-200 ngay. `fetchOHLCV` hien tai default `limit=50`.
   - What's unclear: VPBS API co tra duoc 200 ngay OHLCV trong 1 request khong?
   - Recommendation: Test voi `limit=200` truoc. Neu VPBS gioi han, can paginate hoac cache historical data.

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `aiService.js` (840 lines), `stopLossMonitor.js` (543 lines), `riskCalculator.js`, `vnStockRules.ts`
- [trading-signals npm](https://www.npmjs.com/package/trading-signals) - v7.4.3, TypeScript streaming indicators
- [trading-signals GitHub](https://github.com/bennycode/trading-signals) - README, API patterns
- [simple-statistics docs](https://simple-statistics.github.io/docs/) - cumulativeStdNormalProbability, probit, mean, standardDeviation
- [simple-statistics npm](https://www.npmjs.com/package/simple-statistics) - v7.8.9, zero dependencies

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` - Library selection rationale (researched 2026-03-26)
- `.planning/research/PITFALLS.md` - Domain pitfalls (researched 2026-03-26)
- `.planning/codebase/ARCHITECTURE.md` - Current architecture analysis

### Tertiary (LOW confidence)
- Log-normal distribution assumption cho VN market -- can backtest voi du lieu thuc de validate. Price band truncation co the anh huong accuracy.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Locked decisions, packages verified on npm
- Architecture: HIGH - Based on existing codebase patterns + clear module separation
- Pitfalls: HIGH - Based on codebase analysis + VN market domain knowledge
- Probability TP math: MEDIUM - Log-normal assumption needs validation with real VN data
- Kelly Criterion: HIGH - Well-established formula, simple implementation

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (30 days - stable domain, locked dependencies)
