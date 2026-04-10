# Phase 2: Paper Trading Engine - Research

**Researched:** 2026-03-27
**Domain:** Paper trading simulation engine -- matching, virtual balance, order lifecycle, performance reporting
**Confidence:** HIGH

## Summary

Phase 2 nang cap Paper Trading tu INSTANT fill (khop ngay 100%, khong slippage) thanh he thong mo phong realistic. Co 4 mang chinh can xay dung: (1) PaperMatchingEngine custom voi slippage + fill probability, (2) Virtual cash balance rieng voi T+2 settlement, (3) Order lifecycle day du (PENDING/FILLED/CANCELLED/EXPIRED + sua/huy), va (4) Performance report (P&L, win rate, profit factor, buy & hold comparison).

Codebase hien tai da co nen tang tot tu Phase 1: context separation (REAL/PAPER) da hoan thanh, fillEngine.js co context guard, Order model co optimistic locking, CapitalService co T+2 settlement logic (addBusinessDays, VN holidays), va slippageCalculator.js da co san. Viec chinh la thay the logic fill INSTANT bang matching engine realistic, them virtual balance fields, va them API endpoints cho order management + performance report.

**Primary recommendation:** Build PaperMatchingEngine class (~300-500 dong) tich hop slippageCalculator existing + volume-based fill probability. Reuse CapitalService pattern cho virtual balance. Khong can npm dependency moi cho phase nay.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Custom PaperMatchingEngine xay rieng (~300-500 dong) -- khong dung npm package vi khong co lib nao ho tro quy tac san VN (tick size, bien do, ATO/ATC session)
- **D-02:** Slippage model: slippage = base_spread x (1 + volume_impact). Base spread = 0.1-0.3% tuy thanh khoan co phieu. Volume impact = order_qty / avg_daily_volume
- **D-03:** Xac suat khop: LO khop khi market_price crosses limit_price x fill_probability (dua tren volume). MP fill ngay voi slippage. ATO/ATC fill tai gia mo/dong cua
- **D-04:** Delay khop lenh: 1-5 giay random cho LO (mo phong queue), MP khop ngay sau slippage calc
- **D-05:** Virtual balance field rieng tren portfolio table (virtual_balance, paper_available_cash, paper_pending_settlement)
- **D-06:** T+2 settlement tai su dung logic tu CapitalService Phase 1 (addBusinessDays, VN holidays)
- **D-07:** Moi portfolio co virtual_balance default 1,000,000,000 VND (1 ty) cho paper trading
- **D-08:** PENDING -> FILLED (match success) | PARTIALLY_FILLED | CANCELLED (user cancel) | EXPIRED (end of session)
- **D-09:** User co the sua limit price va quantity cho lenh PENDING. Khong sua side hay symbol
- **D-10:** Lenh ATO expire neu khong khop trong phien mo cua. ATC expire neu khong khop trong phien dong cua
- **D-11:** Report hien thi: Total P&L, Win Rate, Average Win/Loss, Profit Factor, Max Drawdown
- **D-12:** So sanh voi Buy & Hold: tinh return neu user giu tat ca co phieu da mua tu dau
- **D-13:** Ky bao cao: tong cong + filter theo tuan/thang

### Claude's Discretion
- Cach to chuc code matching engine (class vs functional)
- Worker pattern cho periodic fill check (cron interval)
- UI layout cho performance report (chart types, table format)
- Error handling cho edge cases (market halt, price band lock)

### Deferred Ideas (OUT OF SCOPE)
- Full orderbook simulation (bid/ask spread day du) -- qua complex cho v1, basic slippage du
- Partial fill simulation -- defer, chi full fill hoac no fill cho v1
- Multi-day backtesting -- separate feature, not paper trading
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PAPER-01 | User co the dat lenh mo phong (MP, LO, ATO, ATC) voi virtual balance rieng | DB migration them virtual balance fields, PaperMatchingEngine class xu ly 4 order types, PaperCapitalService deduct virtual cash |
| PAPER-02 | Matching engine mo phong realistic: slippage, xac suat khop dua tren volume, delay khop | PaperMatchingEngine voi slippage formula (D-02), fill probability (D-03), setTimeout delay (D-04) |
| PAPER-03 | Virtual cash balance rieng cho paper trading, khong anh huong portfolio that | Virtual balance fields tren portfolios table (D-05), PaperCapitalService class reuse CapitalService pattern |
| PAPER-04 | User co the quan ly lenh pending (sua/huy) | PATCH endpoint cho edit limit_price + quantity (D-09), existing cancel logic da co |
| PAPER-05 | Mo phong T+2 settlement cho paper trading | Reuse addBusinessDays + VN_HOLIDAYS tu capitalService.js (D-06), paper_settlement_events table |
| PAPER-06 | Paper trading performance report rieng (P&L, win rate, so sanh voi mua giu) | Performance query filter context='PAPER', them buy-and-hold calculation (D-12), time filter (D-13) |
</phase_requirements>

## Standard Stack

### Core (No New Dependencies)
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| Existing codebase | - | Custom PaperMatchingEngine | D-01: Khong co npm lib ho tro VN market rules |
| node-cron | 3.0.3 | Periodic fill check worker | Da co, dung cho paper fill worker |
| uuid | 9.0.0 | Worker run IDs | Da co |

### Existing Shared Kernel (Reuse)
| Module | Location | Reuse For |
|--------|----------|-----------|
| slippageCalculator.js | services/shared/ | Tich hop vao matching engine slippage calc |
| feeEngine.js | services/shared/ | Fee calculation cho paper trades |
| tickSizeEngine.js | services/shared/ | Tick size validation, snapToTickSize, price band check |
| capitalService.js | services/portfolio/ | Reuse pattern addBusinessDays, VN_HOLIDAYS cho T+2 |
| websocket.js | services/ | Broadcast order status updates |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom matching engine | `orderbook-engine` npm | Abandoned, no VN rules -- not viable |
| setTimeout delay | Bull/BullMQ job queue | Overkill cho personal tool, setTimeout du tot |
| In-process cron | External scheduler | Khong can, node-cron da du cho monolith |

**Installation:** Khong can install them gi moi. Phase 2 chi dung existing dependencies.

## Architecture Patterns

### Recommended Project Structure (New/Modified Files)
```
ai-stoploss-engine-be/
  services/
    paper/
      fillEngine.js              # UPGRADE: thay INSTANT bang matching engine call
      paperMatchingEngine.js     # NEW: core matching logic (~300-500 lines)
      paperCapitalService.js     # NEW: virtual balance management
      paperOrderService.js       # NEW: order edit/management
      paperPerformanceService.js # NEW: performance report queries
  controllers/
    paper/
      paperOrder.controller.js   # UPGRADE: them edit endpoint, realistic mode
      paperPerformance.controller.js # NEW: performance report API
  routes/
    order.routes.js              # UPGRADE: them PATCH route
    paperTrading.routes.js       # NEW hoac them vao existing routes
  workers/
    paperFillWorker.js           # NEW: periodic fill check cho PENDING orders
  migrations/
    008_paper_virtual_balance.sql # NEW: virtual balance + settlement
```

### Pattern 1: PaperMatchingEngine Class
**What:** Class xu ly tat ca matching logic, nhan order + market data, tra ve fill result
**When to use:** Moi khi order can fill (create MP, worker check PENDING LO/ATO/ATC)
**Recommendation:** Dung class voi static methods (consistent voi RiskCalculator, CapitalService pattern)

```javascript
// services/paper/paperMatchingEngine.js
class PaperMatchingEngine {
  /**
   * Calculate slippage cho market order
   * slippage = base_spread * (1 + volume_impact)
   * base_spread = 0.1-0.3% tuy thanh khoan
   * volume_impact = order_qty / avg_daily_volume
   */
  static calculateSlippage(price, quantity, avgDailyVolume, exchange) {
    const liquidityTier = avgDailyVolume > 1_000_000 ? 'HIGH'
                        : avgDailyVolume > 100_000 ? 'MEDIUM' : 'LOW';
    const baseSpread = { HIGH: 0.001, MEDIUM: 0.002, LOW: 0.003 }[liquidityTier];
    const volumeImpact = quantity / Math.max(avgDailyVolume, 1);
    const slippagePct = baseSpread * (1 + volumeImpact);
    return Math.round(price * slippagePct);
  }

  /**
   * Tinh xac suat khop cho LO order
   * Fill probability dua tren volume tai muc gia
   */
  static calculateFillProbability(orderQty, avgDailyVolume) {
    // Lenh nho so voi volume -> xac suat cao
    const ratio = orderQty / Math.max(avgDailyVolume, 1);
    if (ratio < 0.001) return 0.95;  // < 0.1% volume -> gan nhu chac chan
    if (ratio < 0.01)  return 0.80;  // < 1% volume -> kha cao
    if (ratio < 0.05)  return 0.50;  // < 5% volume -> 50/50
    if (ratio < 0.10)  return 0.25;  // < 10% volume -> kho
    return 0.10;                      // > 10% volume -> rat kho
  }

  /**
   * Try fill LO order: kiem tra gia + xac suat
   */
  static async tryFillLimitOrder(order, currentPrice, avgDailyVolume) {
    const shouldCross = order.side === 'BUY'
      ? currentPrice <= order.limit_price
      : currentPrice >= order.limit_price;
    if (!shouldCross) return { filled: false };

    const fillProb = this.calculateFillProbability(order.quantity, avgDailyVolume);
    if (Math.random() > fillProb) return { filled: false, reason: 'LOW_FILL_PROBABILITY' };

    const slippage = this.calculateSlippage(order.limit_price, order.quantity, avgDailyVolume, order.exchange);
    const fillPrice = order.side === 'BUY'
      ? order.limit_price  // LO BUY fill tai limit (khong xau hon limit)
      : order.limit_price; // LO SELL fill tai limit

    return { filled: true, fillPrice, slippage: 0 }; // LO fill tai limit, no slippage
  }

  /**
   * Fill MP order: fill ngay voi slippage
   */
  static async fillMarketOrder(order, currentPrice, avgDailyVolume) {
    const slippage = this.calculateSlippage(currentPrice, order.quantity, avgDailyVolume, order.exchange);
    const fillPrice = order.side === 'BUY'
      ? currentPrice + slippage   // mua mac hon
      : currentPrice - slippage;  // ban re hon
    return { filled: true, fillPrice: snapToTickSize(fillPrice, order.exchange), slippage };
  }

  /**
   * Fill ATO order: tai gia mo cua
   */
  static async fillATOOrder(order, openPrice) {
    return { filled: true, fillPrice: openPrice, slippage: 0 };
  }

  /**
   * Fill ATC order: tai gia dong cua
   */
  static async fillATCOrder(order, closePrice) {
    return { filled: true, fillPrice: closePrice, slippage: 0 };
  }
}
```

### Pattern 2: PaperCapitalService (Reuse CapitalService Pattern)
**What:** Quan ly virtual cash rieng cho paper trading, reuse T+2 logic
**When to use:** Khi paper order filled (deduct) hoac paper position closed (add back)

```javascript
// services/paper/paperCapitalService.js
import { addBusinessDays } from '../portfolio/capitalService.js';

class PaperCapitalService {
  static async deductForBuy(portfolioId, totalCost) {
    // SELECT FOR UPDATE paper_available_cash
    // Deduct paper_available_cash
    // Tuong tu CapitalService.deductForBuy nhung tren virtual fields
  }

  static async addPendingSettlement(portfolioId, netAmount) {
    const settlementDate = addBusinessDays(new Date(), 2);
    // Them paper_pending_settlement + paper_settlement_events record
  }

  static async processSettlements() {
    // Query paper settlement events den han, chuyen sang available
  }

  static async getVirtualBalance(portfolioId) {
    // Return { virtual_balance, paper_available_cash, paper_pending_settlement, paper_deployed }
  }
}
```

### Pattern 3: PaperFillWorker (Periodic Fill Check)
**What:** Worker chay dinh ky de fill PENDING LO orders
**When to use:** Registered in index.js, chay moi 30s-1min trong gio giao dich
**Recommendation:** Tach rieng khoi stopLossMonitor.js de giu concern separation

```javascript
// workers/paperFillWorker.js
import cron from 'node-cron';

// Chay moi 30 giay trong gio giao dich
const FILL_CRON = '*/30 * * * * *'; // every 30s

async function checkPendingOrders() {
  // 1. Query PENDING orders (context = 'PAPER', simulation_mode = 'REALISTIC')
  // 2. Group by symbol
  // 3. For each symbol: get current price + avg volume
  // 4. Call PaperMatchingEngine.tryFillLimitOrder()
  // 5. If filled: create position, deduct virtual balance, broadcast
}
```

### Anti-Patterns to Avoid
- **Mix INSTANT va REALISTIC logic trong cung function:** Tach rieng. INSTANT goi truc tiep trong controller (nhu hien tai). REALISTIC de worker xu ly.
- **Cross-context import:** PaperCapitalService KHONG import CapitalService class -- chi import helper function addBusinessDays. Virtual balance la domain rieng cua paper.
- **Modify stopLossMonitor.js:** KHONG them fill logic vao worker hien co. Tao paperFillWorker.js rieng.
- **Lam phuc tap Order model:** KHONG them paper-specific methods vao Order.js. Tao paperOrderService.js wrap Order model.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| T+2 business days calculation | Custom date math | `addBusinessDays()` tu capitalService.js | Da tested, co VN holidays |
| Tick size validation | Manual tick rounding | `snapToTickSize()` tu tickSizeEngine.js | Covers HOSE/HNX/UPCOM rules |
| Fee calculation | Custom fee math | `calculateBuyFee()`, `calculateFees()` tu feeEngine.js | Da co buy_fee_percent, sell_fee_percent, sell_tax_percent |
| Optimistic locking cho order fill | Manual version check | `Order.fill()`, `Order.cancel()` | Da co WHERE status IN ('PENDING') pattern |
| Price band validation | Manual exchange limits | `validatePriceInBand()` tu tickSizeEngine.js | Co HOSE +/-7%, HNX +/-10%, UPCOM +/-15% |
| WebSocket broadcast | Custom event system | `broadcastPortfolioUpdate()` | Da co, dung rooms per portfolio |

**Key insight:** Phase 1 da xay dung rat nhieu shared utilities. Phase 2 chu yeu la COMPOSE existing modules thanh matching engine moi, khong phai xay tu dau.

## Common Pitfalls

### Pitfall 1: Virtual Balance Race Condition
**What goes wrong:** 2 paper orders submit cung luc, ca 2 pass balance check, tong cost vuot virtual_balance
**Why it happens:** Khong co SELECT FOR UPDATE khi check balance
**How to avoid:** Copy pattern tu CapitalService.deductForBuy -- SELECT FOR UPDATE trong transaction
**Warning signs:** paper_available_cash am trong database

### Pitfall 2: Fill Worker va Controller Race Condition
**What goes wrong:** Controller fill INSTANT order dang trong khi worker cung try fill order do
**Why it happens:** Cung order co the bi pick boi ca 2 code paths
**How to avoid:** Order.fill() da co optimistic locking (WHERE status IN ('PENDING')). Order 2nd attempt se return null. DA CO SAN.
**Warning signs:** Logs "Race condition on order X"

### Pitfall 3: Slippage Lam Gia Fill Vuot Price Band
**What goes wrong:** MP order co slippage lam fill price vuot bien do gia san (+/-7% HOSE)
**Why it happens:** Slippage calc khong check against price band limits
**How to avoid:** Sau khi tinh slippage, clamp fill price vao [floor_price, ceiling_price] bang `validatePriceInBand()` + cap slippage
**Warning signs:** Fill prices ngoai bien do gia

### Pitfall 4: Virtual Balance Khong Giam Khi INSTANT Fill
**What goes wrong:** INSTANT mode fill order ngay nhung khong deduct virtual balance
**Why it happens:** Hien tai fillEngine.js KHONG goi PaperCapitalService (chua co)
**How to avoid:** Trong fillOrderInstant, PHAI goi PaperCapitalService.deductForBuy truoc khi tao position
**Warning signs:** User dat nhieu lenh nhung virtual balance khong giam

### Pitfall 5: T+2 Settlement Worker Khong Chay
**What goes wrong:** Paper settlement events tich luy ma khong bao gio settle
**Why it happens:** Quen register settlement worker trong index.js
**How to avoid:** Tao paper settlement cron (hoac reuse existing settlement cron voi paper filter)
**Warning signs:** paper_pending_settlement tang lien tuc, paper_available_cash khong bao gio tang

### Pitfall 6: Performance Report Query Khong Filter Context
**What goes wrong:** Report tinh P&L cua ca REAL va PAPER positions
**Why it happens:** Portfolio.getPerformance() hien tai KHONG filter context
**How to avoid:** Them WHERE context = 'PAPER' vao performance queries. Hoac tao paperPerformanceService rieng
**Warning signs:** Performance numbers khong match voi chi paper trading

### Pitfall 7: Buy & Hold Calculation Bi Sai Khi Co Sell Orders
**What goes wrong:** Buy & Hold return tinh tren tat ca BUY orders, nhung khong tru SELL orders
**Why it happens:** Logic don gian chi sum entry_price * quantity cho BUY
**How to avoid:** Buy & Hold = gia tri hien tai cua tat ca co phieu da mua (khong tinh da ban) - tong von dau tu. Can track "first buy" cho moi symbol.
**Warning signs:** Buy & Hold return cao bat thuong

## Code Examples

### Database Migration 008
```sql
-- Migration 008: Paper Virtual Balance + Settlement

-- 1. THEM virtual balance fields vao portfolios
ALTER TABLE financial.portfolios
  ADD COLUMN IF NOT EXISTS virtual_balance NUMERIC(20,2) DEFAULT 1000000000,
  ADD COLUMN IF NOT EXISTS paper_available_cash NUMERIC(20,2) DEFAULT 1000000000,
  ADD COLUMN IF NOT EXISTS paper_pending_settlement NUMERIC(20,2) DEFAULT 0;

-- 2. TAO paper_settlement_events table
CREATE TABLE IF NOT EXISTS financial.paper_settlement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES financial.portfolios(id) ON DELETE CASCADE,
  order_id UUID REFERENCES financial.orders(id),
  amount NUMERIC(20,2) NOT NULL,
  settlement_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SETTLED','CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_paper_settlement_portfolio
  ON financial.paper_settlement_events(portfolio_id, status);
CREATE INDEX IF NOT EXISTS idx_paper_settlement_date
  ON financial.paper_settlement_events(settlement_date, status)
  WHERE status = 'PENDING';

-- 3. Backfill: set paper_available_cash = virtual_balance cho existing portfolios
UPDATE financial.portfolios
SET paper_available_cash = virtual_balance
WHERE paper_available_cash = 0 OR paper_available_cash IS NULL;
```

### Order Edit Endpoint
```javascript
// PATCH /api/portfolios/:portfolioId/orders/:id
export const editOrder = async (req, res, next) => {
  // 1. Validate ownership
  // 2. Check order.status === 'PENDING' (chi sua pending)
  // 3. Validate new limit_price (tick size, price band)
  // 4. Validate new quantity (lot size 100)
  // 5. Update order: SET limit_price = $2, quantity = $3 WHERE id = $1 AND status = 'PENDING'
  // 6. Audit log ORDER_MODIFIED
};
```

### Performance Report Query (voi Buy & Hold)
```sql
-- Paper trading performance (context filter)
SELECT
  COUNT(*) FILTER (WHERE status != 'OPEN') AS total_trades,
  COUNT(*) FILTER (WHERE profit_loss_vnd > 0 AND status != 'OPEN') AS winning_trades,
  COALESCE(SUM(profit_loss_vnd) FILTER (WHERE status != 'OPEN'), 0) AS total_pnl_vnd,
  COALESCE(AVG(profit_loss_vnd) FILTER (WHERE profit_loss_vnd > 0 AND status != 'OPEN'), 0) AS avg_win_vnd,
  COALESCE(ABS(AVG(profit_loss_vnd) FILTER (WHERE profit_loss_vnd < 0 AND status != 'OPEN')), 0) AS avg_loss_vnd
FROM financial.positions
WHERE portfolio_id = $1 AND context = 'PAPER';

-- Buy & Hold calculation: tong gia tri hien tai cua tat ca co phieu da mua
-- (can join voi market price -- goi tu service, khong join trong SQL)
SELECT symbol, SUM(quantity) AS total_bought_qty, SUM(entry_price * quantity) AS total_cost
FROM financial.positions
WHERE portfolio_id = $1 AND context = 'PAPER' AND side = 'LONG'
GROUP BY symbol;
-- Sau do: buy_hold_value = SUM(current_price * total_bought_qty) - total_cost
```

## State of the Art

| Old Approach (Current) | New Approach (Phase 2) | Impact |
|------------------------|----------------------|--------|
| fillOrderInstant: fill 100%, no slippage | PaperMatchingEngine: slippage + fill probability | Realistic trading simulation |
| No virtual balance tracking | PaperCapitalService: virtual_balance + T+2 | Teach user money management |
| Cancel only, no edit | Edit limit_price + quantity cho PENDING | Flexible order management |
| No paper-specific performance report | Dedicated report voi buy & hold comparison | Measure trading skill |
| stopLossMonitor fill PENDING in same worker | Separate paperFillWorker.js | Clean separation of concerns |

## Open Questions

1. **Average Daily Volume Source**
   - What we know: VPBS API co volume data trong OHLCV candles
   - What's unclear: Co API lay avg_daily_volume (20-day average) truc tiep khong, hay phai tinh tu 20 candles?
   - Recommendation: Fetch 20 candles, tinh average. Cache 1 gio. Khong phuc tap.

2. **REALISTIC Mode UI Flow**
   - What we know: REALISTIC mode co delay 1-5s. User can thay order status PENDING truoc khi fill.
   - What's unclear: Frontend poll hay nhan WebSocket update khi order filled?
   - Recommendation: Dung WebSocket (da co broadcastPortfolioUpdate). Frontend listen 'order_filled' event.

3. **Paper Settlement Events vs Reuse settlement_events Table**
   - What we know: settlement_events da co cho REAL. Paper co the dung table rieng hoac them context column.
   - Recommendation: Tao paper_settlement_events rieng -- tach biet ro, khong risk mix data REAL/PAPER.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (configured) |
| Config file | `ai-stoploss-engine-be/vitest.config.js` |
| Quick run command | `cd ai-stoploss-engine-be && npx vitest run --reporter=verbose` |
| Full suite command | `cd ai-stoploss-engine-be && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAPER-01 | Dat lenh MP/LO/ATO/ATC voi virtual balance | unit | `npx vitest run tests/services/paperMatchingEngine.test.js -t "fill"` | Wave 0 |
| PAPER-02 | Slippage + fill probability + delay | unit | `npx vitest run tests/services/paperMatchingEngine.test.js -t "slippage"` | Wave 0 |
| PAPER-03 | Virtual cash balance deduct/add | unit | `npx vitest run tests/services/paperCapitalService.test.js` | Wave 0 |
| PAPER-04 | Edit/cancel pending orders | unit | `npx vitest run tests/services/paperOrderManagement.test.js` | Wave 0 |
| PAPER-05 | T+2 settlement cho paper | unit | `npx vitest run tests/services/paperSettlement.test.js` | Wave 0 |
| PAPER-06 | Performance report + buy & hold | unit | `npx vitest run tests/services/paperPerformance.test.js` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd ai-stoploss-engine-be && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd ai-stoploss-engine-be && npx vitest run`
- **Phase gate:** Full suite green truoc `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/services/paperMatchingEngine.test.js` -- covers PAPER-01, PAPER-02
- [ ] `tests/services/paperCapitalService.test.js` -- covers PAPER-03
- [ ] `tests/services/paperOrderManagement.test.js` -- covers PAPER-04
- [ ] `tests/services/paperSettlement.test.js` -- covers PAPER-05
- [ ] `tests/services/paperPerformance.test.js` -- covers PAPER-06
- [ ] `tests/helpers/dbMock.js` -- shared mock cho database queries (neu chua co)

## Project Constraints (from CLAUDE.md)

- **Language:** Noi tieng Viet
- **Git commits:** KHONG them Co-Authored-By. Commit message theo conventional commits format. Nhieu commit nho.
- **Tech stack:** Giu nguyen React + Express + PostgreSQL + Gemini (CLAUDE.md project constraints)
- **Brownfield:** Refactor, khong rebuild
- **Code style:** ES modules, 2 spaces indent, camelCase functions, PascalCase classes
- **Testing:** Vitest voi db mock helpers
- **Workers:** Register trong index.js voi node-cron

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `services/paper/fillEngine.js` -- current fill logic, context guard pattern
- Codebase analysis: `controllers/paper/paperOrder.controller.js` -- current order controller, validation
- Codebase analysis: `services/portfolio/capitalService.js` -- T+2 settlement pattern, addBusinessDays
- Codebase analysis: `services/shared/slippageCalculator.js` -- existing slippage calculation
- Codebase analysis: `models/Order.js` -- optimistic locking pattern (fill, cancel)
- Codebase analysis: `workers/stopLossMonitor.js` -- worker pattern, market hours check
- Codebase analysis: `migrations/007_context_separation.sql` -- current schema
- `.planning/research/STACK.md` -- custom matching engine recommendation
- `.planning/research/PITFALLS.md` -- instant fill pitfall, T+2 settlement
- `.planning/research/ARCHITECTURE.md` -- bounded context design

### Secondary (MEDIUM confidence)
- `.planning/phases/02-paper-trading-engine/02-CONTEXT.md` -- user decisions

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- khong can dependency moi, reuse existing
- Architecture: HIGH -- patterns da established tu Phase 1
- Matching engine logic: HIGH -- formulas locked trong CONTEXT.md, implementation straightforward
- Pitfalls: HIGH -- dua tren codebase analysis + domain knowledge
- Performance report: MEDIUM -- buy & hold calculation co edge cases can handle carefully

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable domain, no external dependency changes)
