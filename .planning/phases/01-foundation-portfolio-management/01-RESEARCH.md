# Phase 1: Foundation & Portfolio Management - Research

**Researched:** 2026-03-27
**Domain:** Context separation (REAL/PAPER) + Portfolio management (real order tracking, cash balance, T+2 settlement)
**Confidence:** HIGH

## Summary

Phase 1 la nen tang cua toan bo du an -- tach hoan toan Portfolio Management (real order tracking) khoi Paper Trading (simulation) trong codebase brownfield da co. Hien tai, moi order deu chay qua `fillEngine` de simulate matching, khong co khai niem "ghi nhan lenh that". Thay doi chinh bao gom: (1) them cot `context` vao orders/positions tables, (2) tao controllers/services rieng cho real orders, (3) xay dung cash balance model voi T+2 settlement, (4) UI form nhap lenh that don gian, va (5) dam bao paper trading van hoat dong binh thuong.

Codebase hien tai dung layered architecture (routes > controllers > services > models) voi Express.js backend va React + TypeScript frontend. Database la PostgreSQL voi schema `financial`. Khong co test infrastructure -- se can tao tu dau.

**Primary recommendation:** Xay tu duoi len: DB migration truoc, roi shared kernel refactor, roi backend services/controllers, cuoi cung la frontend UI. Toan bo thay doi phai backward-compatible voi paper trading flow hien tai.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Them cot `context VARCHAR(20) CHECK (IN 'REAL', 'PAPER')` vao bang orders va positions hien tai -- khong tao bang moi. Migration nhe, it breaking change.
- **D-02:** Tao controllers rieng: RealOrderController, RealPositionController (portfolio) vs PaperOrderController, PaperPositionController (simulation). Shared logic (fees, tick size, risk) nam trong Shared Kernel.
- **D-03:** fillEngine KHONG DUOC chay cho context='REAL'. Lenh that chi ghi nhan, khong gia lap khop.
- **D-04:** Form nhap lenh that don gian: ma CK, exchange, side (MUA/BAN), so luong, gia khop thuc te, ngay khop. Khong co order type (LO/MP/ATO) vi lenh da khop roi.
- **D-05:** Phi tu dong tinh theo exchange rules (0.15% mua, 0.15% ban + 0.1% thue ban). User khong can nhap phi.
- **D-06:** Khi nhap lenh MUA -> tao position OPEN ngay. Khi nhap lenh BAN -> dong position tuong ung.
- **D-07:** Them fields vao portfolio: `total_balance`, `available_cash`, `pending_settlement_cash`.
- **D-08:** T+2 settlement: khi ban, tien vao `pending_settlement_cash`. Sau 2 ngay lam viec, tu chuyen sang `available_cash`.
- **D-09:** Khi mua, tru `available_cash` ngay. Khong cho mua neu `available_cash` khong du.
- **D-10:** User nhan "Dong vi the" -> nhap gia ban thuc te + ngay ban -> he thong tinh realized P&L (bao gom phi + thue VN).
- **D-11:** Position status chuyen sang CLOSED_MANUAL. Giu nguyen cac status khac (CLOSED_SL, CLOSED_TP) cho paper trading.

### Claude's Discretion
- Cach to chuc directory structure cho controllers moi (co the tao subfolder hoac prefix)
- Loading skeleton/states cho form nhap lenh
- Error message format cho validation errors

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | Tach Portfolio Management (real) va Paper Trading (simulation) thanh 2 flow rieng biet | DB migration them `context` column (D-01), separate controllers (D-02), fillEngine guard (D-03) |
| FOUND-02 | Them cot `context` ('REAL'/'PAPER') vao bang orders va positions | Migration 007 pattern, ALTER TABLE approach (D-01) |
| FOUND-03 | Portfolio mode khong chay fillEngine -- user nhap lenh da dat tren san | RealOrderService tao position truc tiep, khong goi fillEngine (D-03, D-06) |
| FOUND-04 | Paper Trading mode su dung fillEngine rieng voi virtual balance | Guard fillEngine chi chay cho context='PAPER', existing code van giu nguyen |
| FOUND-05 | To chuc lai Shared Kernel (MarketData, FeeEngine, TickSizeEngine, RiskCalculator) | Di chuyen vao services/shared/ subfolder, giu nguyen logic |
| PORT-01 | User co the nhap lenh that da dat tren san (form don gian) | RealOrderController + frontend RealOrderForm (D-04, D-05) |
| PORT-02 | User co the xem cash balance (tong von, von deployed, von available) | Portfolio model them available_cash, pending_settlement_cash (D-07) |
| PORT-03 | Cash balance tu dong cap nhat khi nhap/dong lenh, tinh dung T+2 settlement | CapitalService + SettlementWorker (D-08, D-09) |
| PORT-04 | User co the dong vi the thu cong (ghi nhan ban tren san, tinh realized P&L) | RealPositionController.closePosition() + feeEngine (D-10, D-11) |
| PORT-05 | User co the xem lich su giao dich (mua/ban) voi phi va thue VN | Query orders + positions WHERE context='REAL', join fee data |
| PORT-06 | User co the xem tong quan portfolio (tong gia tri, tong P&L, % return) | Extend Portfolio.getPerformance() voi context filter + cash balance |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Tech stack co dinh:** React + Express + PostgreSQL + Gemini -- khong thay doi stack
- **Brownfield:** Refactor khong phai rebuild -- code cu phai van chay
- **Git commits:** Conventional commits format `type(scope): mo ta ngan gon`, nhieu commit nho
- **Khong co AI co-author** trong commit messages
- **Ngon ngu:** Tieng Viet

## Standard Stack

### Core (da co trong project -- KHONG them moi)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Express.js | 4.21.0 | Backend HTTP framework | Da co, locked |
| React | 19.2.4 | Frontend UI | Da co, locked |
| PostgreSQL (pg) | 8.11.5 | Database driver | Da co, locked |
| Joi | 17.12.0 | Schema validation | Da co, pattern established |
| Socket.IO | 4.6.1 | WebSocket | Da co cho real-time updates |
| Tailwind CSS | 4.1.18 | Styling | Da co, locked |
| node-cron | 3.0.3 | Background job scheduling | Da co cho stopLossMonitor |

### Supporting (can them cho Phase 1)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | (latest) | Test framework | Unit test cho services moi (capitalService, realOrderService). Wave 0 setup |

**Khong can them bat ky dependency nao khac.** Moi feature trong Phase 1 deu su dung cac library da co san.

### Alternatives Considered

Khong -- tat ca decisions da locked. Khong xem xet alternatives.

## Architecture Patterns

### Recommended Directory Structure (Phase 1 target)

```
ai-stoploss-engine-be/
  controllers/
    portfolio/                  # NEW subfolder
      portfolio.controller.js   # MOVE from controllers/
      realOrder.controller.js   # NEW - real order entry
      realPosition.controller.js # NEW - position close, P&L
    paper/                      # NEW subfolder (rename existing)
      paperOrder.controller.js  # RENAME from order.controller.js
      paperPosition.controller.js # RENAME from position.controller.js
    shared/                     # NEW subfolder
      market.controller.js      # MOVE from controllers/
      notifications.controller.js # MOVE from controllers/
    auth.controller.js          # KEEP in place
    ai.controller.js            # KEEP in place
    watchlist.controller.js     # KEEP in place
    priceAlerts.controller.js   # KEEP in place
  services/
    shared/                     # NEW subfolder
      riskCalculator.js         # MOVE from services/
      feeEngine.js              # MOVE from services/
      tickSizeEngine.js         # MOVE from services/
      slippageCalculator.js     # MOVE from services/
      marketPriceService.js     # MOVE from services/
      notificationService.js    # MOVE from services/
      websocket.js              # MOVE from services/
    portfolio/                  # NEW subfolder
      capitalService.js         # NEW - cash balance, T+2 settlement
      realOrderService.js       # NEW - real order business logic
      realPositionService.js    # NEW - position tracking, P&L
    paper/                      # NEW subfolder
      fillEngine.js             # MOVE from services/
      paperOrderService.js      # EXISTING logic extracted
    ai/                         # KEEP existing or move later
      aiService.js              # KEEP
  routes/
    portfolio.routes.js         # UPDATE - add real order/position routes
    paperTrading.routes.js      # NEW - paper trading specific routes
    (keep existing routes)
  workers/
    settlementWorker.js         # NEW - T+2 settlement cron job
    stopLossMonitor.js          # UPDATE - add context filter
  migrations/
    007_context_separation.sql  # NEW - context column + cash balance
```

**Rationale cho subfolder approach:** Controller va service files se tang len gap doi khi tach REAL/PAPER. Subfolder giu directory sach, de navigate, va enforce bounded context boundaries. Cac file khong thuoc Phase 1 (auth, ai, watchlist, priceAlerts) giu nguyen vi tri.

### Pattern 1: Context Guard Pattern

**What:** Moi query va service call phai explicitly pass `context` parameter de tranh lane lon REAL/PAPER.
**When to use:** Moi interaction voi orders/positions tables.

```javascript
// services/portfolio/realOrderService.js
import { calculateBuyFee } from '../shared/feeEngine.js';
import Position from '../../models/Position.js';
import Order from '../../models/Order.js';

class RealOrderService {
  static async recordBuyOrder(portfolioId, { symbol, exchange, quantity, filledPrice, filledDate }) {
    // RULE: KHONG goi fillEngine -- chi ghi nhan
    const order = await Order.create({
      portfolioId,
      symbol,
      exchange,
      side: 'BUY',
      orderType: 'MANUAL_RECORD',  // new type for real orders
      quantity,
      limitPrice: filledPrice,
      simulationMode: null,         // N/A for real
      context: 'REAL',
      status: 'RECORDED',           // not PENDING/FILLED -- this is a record
      actualFilledAt: filledDate,
    });

    // Tao position OPEN ngay lap tuc (D-06)
    const position = await Position.create({
      portfolioId,
      symbol,
      exchange,
      entryPrice: filledPrice,
      quantity,
      context: 'REAL',
      status: 'OPEN',
      side: 'LONG',
      // SL/TP = null cho real orders (user tu quan ly tren san)
      stopLoss: null,
      takeProfit: null,
      riskValueVnd: 0,
    });

    return { order, position };
  }
}
```

### Pattern 2: Cash Balance Transaction Pattern

**What:** Moi thay doi cash balance phai trong DB transaction de tranh race condition.
**When to use:** Mua (tru available_cash), ban (them pending_settlement), settlement (chuyen pending -> available).

```javascript
// services/portfolio/capitalService.js
import { transaction } from '../../config/database.js';

class CapitalService {
  static async deductForBuy(portfolioId, totalCost) {
    return transaction(async (client) => {
      // Lock row to prevent concurrent modifications
      const { rows } = await client.query(
        `SELECT available_cash FROM financial.portfolios
         WHERE id = $1 FOR UPDATE`,
        [portfolioId]
      );
      const available = parseFloat(rows[0]?.available_cash);
      if (available < totalCost) {
        throw Object.assign(new Error('Khong du tien mat kha dung'), { statusCode: 422 });
      }
      await client.query(
        `UPDATE financial.portfolios
         SET available_cash = available_cash - $2,
             updated_at = NOW()
         WHERE id = $1`,
        [portfolioId, totalCost]
      );
    });
  }

  static async addPendingSettlement(portfolioId, amount, settlementDate) {
    return transaction(async (client) => {
      await client.query(
        `UPDATE financial.portfolios
         SET pending_settlement_cash = pending_settlement_cash + $2,
             updated_at = NOW()
         WHERE id = $1`,
        [portfolioId, amount]
      );
      // Record settlement event for worker to process
      await client.query(
        `INSERT INTO financial.settlement_events (portfolio_id, amount, settlement_date)
         VALUES ($1, $2, $3)`,
        [portfolioId, amount, settlementDate]
      );
    });
  }
}
```

### Pattern 3: T+2 Business Day Calculation

**What:** Settlement date = trade date + 2 ngay lam viec (skip weekends + nghi le VN).
**When to use:** Khi user nhap lenh ban.

```javascript
// services/portfolio/capitalService.js

// HOSE/HNX holidays 2026 (hardcode -- khong co API chinh thuc)
const VN_HOLIDAYS_2026 = [
  '2026-01-01', // Tet Duong lich
  '2026-01-26', '2026-01-27', '2026-01-28', '2026-01-29', '2026-01-30', // Tet Nguyen Dan
  '2026-04-30', // Giai phong mien Nam
  '2026-05-01', // Quoc te lao dong
  '2026-09-02', // Quoc khanh
  // Them ngay bu nghi khi co thong bao chinh thuc
];

function addBusinessDays(date, days) {
  let current = new Date(date);
  let added = 0;
  while (added < days) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    const dateStr = current.toISOString().split('T')[0];
    if (day !== 0 && day !== 6 && !VN_HOLIDAYS_2026.includes(dateStr)) {
      added++;
    }
  }
  return current;
}
```

### Anti-Patterns to Avoid

- **KHONG dung if/else context trong 1 controller:** Tach controller rieng, khong gom chung.
- **KHONG import cross-context:** Paper services khong import tu portfolio/, va nguoc lai. Chi import tu shared/.
- **KHONG chay fillEngine cho REAL:** Guard at service layer, khong chi o controller level.
- **KHONG de real position co status CLOSED_SL/CLOSED_TP:** Chi CLOSED_MANUAL cho real. SL/TP la paper trading concepts.
- **KHONG nullable context column:** Default 'PAPER' cho data cu, nhung require NOT NULL cho records moi.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fee calculation | Custom fee logic | `feeEngine.js` (da co) | Da tinh dung phi VN (0.15% + 0.1% thue) |
| Tick size validation | Manual price rounding | `tickSizeEngine.js` (da co) | Quy tac buoc gia phuc tap (khac theo san, khac theo gia) |
| VND price conversion | Ad-hoc multiplication | `marketPriceToVnd()` helper (da co) | VPBS tra gia theo nghin dong, can normalize |
| DB transaction | Manual BEGIN/COMMIT | `transaction()` from `config/database.js` | Da co helper, handle rollback |
| Validation schemas | Manual req.body checks | Joi schemas + `validate()` middleware | Pattern established, consistent error format |
| Portfolio ownership check | Inline auth checks | `ensurePortfolioOwnership()` helper (da co) | Pattern da dung trong moi controller |

**Key insight:** Phan lon infrastructure da co san. Phase 1 chu yeu la THEM code moi (real order flow, cash balance) va TO CHUC LAI code cu (subfolder, context column), khong phai viet lai tu dau.

## Common Pitfalls

### Pitfall 1: Breaking Paper Trading Flow

**What goes wrong:** Refactor order/position controllers lam hong paper trading hien tai. User khong dat duoc lenh paper nua.
**Why it happens:** Di chuyen/rename files ma khong cap nhat tat ca import paths. Hoac them constraint moi ma data cu khong satisfy.
**How to avoid:**
1. Migration 007 PHAI co DEFAULT 'PAPER' cho context column de data cu van valid
2. Paper trading routes van giu URL pattern cu (`/api/portfolios/:id/orders`) ngoai ra them URL moi cho real
3. Test paper trading flow sau MOI thay doi backend
**Warning signs:** fillEngine bao loi "order not found" hoac "invalid status"

### Pitfall 2: Cash Balance Race Condition

**What goes wrong:** 2 request mua dong thoi, ca 2 check available_cash du, ca 2 tru tien => available_cash am.
**Why it happens:** Check-then-update without row locking.
**How to avoid:** Dung `SELECT ... FOR UPDATE` trong transaction khi check + deduct cash.
**Warning signs:** available_cash co gia tri am trong DB.

### Pitfall 3: T+2 Settlement Holiday Edge Case

**What goes wrong:** Ban vao thu 5 truoc ky nghi le dai, settlement date tinh sai vi khong tinh ngay nghi.
**Why it happens:** Hardcode holidays thieu hoac khong cap nhat hang nam.
**How to avoid:**
1. Hardcode holidays 2026-2027 day du
2. Log warning khi settlement date > 5 calendar days (bat thuong, co the thieu holiday)
3. Cho phep admin override settlement date trong truong hop dac biet
**Warning signs:** Tien khong chuyen tu pending sang available dung han.

### Pitfall 4: Position Close Without Matching Order

**What goes wrong:** User nhan "Dong vi the" nhung khong co lenh BAN tuong ung duoc tao. P&L duoc tinh nhung khong co audit trail.
**Why it happens:** Close flow chi update position status ma khong tao sell order record.
**How to avoid:** Khi dong vi the, LUON tao 1 order record context='REAL' side='SELL' status='RECORDED' truoc khi update position.
**Warning signs:** positions co status CLOSED_MANUAL nhung khong co sell order tuong ung.

### Pitfall 5: Positions Table Constraint Conflict

**What goes wrong:** Real positions khong co stop_loss (user tu quan ly tren san), nhung DB constraint `stop_loss NOT NULL CHECK (stop_loss > 0)` block insert.
**Why it happens:** Schema hien tai REQUIRE stop_loss cho moi position.
**How to avoid:** Migration 007 phai ALTER constraint: cho phep stop_loss NULL khi context='REAL'. Hoac them exception: `CHECK (context = 'REAL' OR stop_loss IS NOT NULL)`.
**Warning signs:** INSERT position that bai voi "null value in column stop_loss violates not-null constraint".

### Pitfall 6: Frontend Import Chaos

**What goes wrong:** Di chuyen controllers vao subfolder nhung frontend API service van goi URL cu.
**Why it happens:** Backend route URLs thay doi nhung frontend `api.ts` khong cap nhat.
**How to avoid:** Giu route URLs backward-compatible. Them route MOI cho real orders, KHONG thay doi route cu cua paper trading.
**Warning signs:** 404 errors tren frontend khi goi API.

## Code Examples

### DB Migration 007: Context Separation + Cash Balance

```sql
-- Migration 007: Context separation + Cash balance
-- Phase 1: Foundation & Portfolio Management

-- 1. Add context column to orders (default PAPER for existing data)
ALTER TABLE financial.orders
  ADD COLUMN IF NOT EXISTS context VARCHAR(20) NOT NULL DEFAULT 'PAPER'
  CHECK (context IN ('REAL', 'PAPER'));

-- 2. Add context column to positions
ALTER TABLE financial.positions
  ADD COLUMN IF NOT EXISTS context VARCHAR(20) NOT NULL DEFAULT 'PAPER'
  CHECK (context IN ('REAL', 'PAPER'));

-- 3. Relax stop_loss constraint for REAL positions (real positions may not have SL)
ALTER TABLE financial.positions
  DROP CONSTRAINT IF EXISTS chk_stop_loss_vs_entry;
-- Re-add with context exception
ALTER TABLE financial.positions
  ADD CONSTRAINT chk_stop_loss_vs_entry CHECK (
    context = 'REAL'
    OR stop_loss IS NULL
    OR ((side IS NULL OR side = 'LONG') AND stop_loss < entry_price)
    OR (side = 'SHORT' AND stop_loss > entry_price)
  );

-- Also make stop_loss nullable (was NOT NULL)
ALTER TABLE financial.positions
  ALTER COLUMN stop_loss DROP NOT NULL;

-- 4. Add cash balance fields to portfolios
ALTER TABLE financial.portfolios
  ADD COLUMN IF NOT EXISTS available_cash NUMERIC(20, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_settlement_cash NUMERIC(20, 2) DEFAULT 0;

-- Backfill: existing portfolios set available_cash = total_balance
UPDATE financial.portfolios
  SET available_cash = total_balance
  WHERE available_cash = 0 OR available_cash IS NULL;

-- 5. Add real order specific columns
ALTER TABLE financial.orders
  ADD COLUMN IF NOT EXISTS actual_filled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_entry BOOLEAN DEFAULT FALSE;

-- Allow 'RECORDED' status for real orders, 'MANUAL_RECORD' order type
ALTER TABLE financial.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE financial.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('PENDING','PARTIALLY_FILLED','FILLED','CANCELLED','EXPIRED','REJECTED','RECORDED'));

ALTER TABLE financial.orders
  DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE financial.orders
  ADD CONSTRAINT orders_order_type_check
  CHECK (order_type IN ('LO','ATO','ATC','MP','MANUAL_RECORD'));

-- 6. Settlement events table (for T+2 settlement worker)
CREATE TABLE IF NOT EXISTS financial.settlement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES financial.portfolios(id) ON DELETE CASCADE,
  amount NUMERIC(20, 2) NOT NULL,
  settlement_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SETTLED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_settlement_portfolio ON financial.settlement_events(portfolio_id, status);
CREATE INDEX IF NOT EXISTS idx_settlement_date ON financial.settlement_events(settlement_date, status)
  WHERE status = 'PENDING';

-- 7. Indexes for context filtering
CREATE INDEX IF NOT EXISTS idx_orders_context ON financial.orders(context);
CREATE INDEX IF NOT EXISTS idx_positions_context ON financial.positions(context);
CREATE INDEX IF NOT EXISTS idx_positions_portfolio_context ON financial.positions(portfolio_id, context, status);

SELECT 'Migration 007 completed successfully' AS result;
```

### Real Order Entry (Backend Controller)

```javascript
// controllers/portfolio/realOrder.controller.js
import Joi from 'joi';
import Order from '../../models/Order.js';
import Position from '../../models/Position.js';
import { calculateBuyFee } from '../../services/shared/feeEngine.js';
import CapitalService from '../../services/portfolio/capitalService.js';

export const createRealOrderSchema = Joi.object({
  symbol:      Joi.string().max(20).uppercase().required(),
  exchange:    Joi.string().valid('HOSE', 'HNX', 'UPCOM').required(),
  side:        Joi.string().valid('BUY', 'SELL').required(),
  quantity:    Joi.number().integer().positive().required(),
  filled_price: Joi.number().positive().required(),  // Gia khop thuc te (VND)
  filled_date: Joi.date().iso().required(),           // Ngay khop
  notes:       Joi.string().max(500).optional(),
});

export const createRealOrder = async (req, res, next) => {
  try {
    const portfolio = await ensurePortfolioOwnership(req, res);
    if (!portfolio) return;

    const { symbol, exchange, side, quantity, filled_price, filled_date, notes } = req.validatedBody;
    const totalCost = filled_price * quantity;
    const buyFee = calculateBuyFee(filled_price, quantity, portfolio);

    if (side === 'BUY') {
      // Check va tru available_cash (D-09)
      await CapitalService.deductForBuy(portfolio.id, totalCost + buyFee);

      const order = await Order.create({
        portfolioId: portfolio.id,
        symbol, exchange, side,
        orderType: 'MANUAL_RECORD',
        limitPrice: filled_price,
        quantity,
        context: 'REAL',
        status: 'RECORDED',
        actualFilledAt: filled_date,
        manualEntry: true,
      });

      const position = await Position.create({
        portfolioId: portfolio.id,
        symbol, exchange,
        entryPrice: filled_price,
        quantity,
        context: 'REAL',
        side: 'LONG',
        riskValueVnd: 0,
        buyFeeVnd: buyFee,
      });

      return res.status(201).json({
        success: true,
        message: `Da ghi nhan mua ${quantity} ${symbol} tai ${filled_price.toLocaleString('vi-VN')}d`,
        data: { order, position },
      });
    }

    // SELL flow -> delegate to realPosition.controller.closePosition()
    // ...
  } catch (error) {
    next(error);
  }
};
```

### Frontend: Real Order Entry Form

```typescript
// components/portfolio/RealOrderForm.tsx
// Form don gian: ma CK, exchange, side, so luong, gia khop, ngay khop
// Phi tu dong hien thi (tinh tu feeEngine rules)
// Khong co order type (LO/MP/ATO) -- lenh da khop roi

interface RealOrderFormProps {
  portfolioId: string;
  availableCash: number;
  onSuccess: () => void;
}

// Fields:
// - symbol: text input + autocomplete tu market API
// - exchange: select (HOSE/HNX/UPCOM)
// - side: toggle MUA/BAN
// - quantity: number input (step=100 cho lot size)
// - filled_price: number input (VND)
// - filled_date: date picker (default today)
// Auto-calculated:
// - Tong gia tri = quantity * filled_price
// - Phi mua/ban = theo feeEngine rules
// - Available cash after = current - total - fee
```

## State of the Art

| Old Approach (hien tai) | Current Approach (Phase 1) | Impact |
|-------------------------|---------------------------|--------|
| 1 order flow cho tat ca | Tach REAL (record-only) vs PAPER (simulated) | Core architectural fix |
| fillEngine chay moi order | fillEngine CHI chay context='PAPER' | Real orders ghi nhan chinh xac |
| Khong co cash balance model | available_cash + pending_settlement + T+2 | User biet chinh xac con bao nhieu tien |
| Position luc nao cung can SL/TP | Real positions co the khong co SL/TP | Phu hop voi ghi nhan lenh that |
| 1 controller xu ly tat ca | Controllers tach theo bounded context | Code sach hon, de maintain |

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest (chua co -- can setup Wave 0) |
| Config file | `ai-stoploss-engine-be/vitest.config.js` (Wave 0) |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | Context separation -- REAL vs PAPER queries return correct data | unit | `npx vitest run tests/services/contextSeparation.test.js` | Wave 0 |
| FOUND-02 | Migration adds context column with default PAPER | manual | Run migration, verify schema | Manual |
| FOUND-03 | RealOrderService does NOT call fillEngine | unit | `npx vitest run tests/services/realOrderService.test.js` | Wave 0 |
| FOUND-04 | Paper order still uses fillEngine correctly | unit | `npx vitest run tests/services/paperOrderService.test.js` | Wave 0 |
| FOUND-05 | Shared kernel services importable from both contexts | unit | `npx vitest run tests/services/sharedKernel.test.js` | Wave 0 |
| PORT-01 | Real order creation with valid input | unit | `npx vitest run tests/controllers/realOrder.test.js` | Wave 0 |
| PORT-02 | Cash balance correctly calculated | unit | `npx vitest run tests/services/capitalService.test.js` | Wave 0 |
| PORT-03 | T+2 settlement moves pending to available | unit | `npx vitest run tests/services/settlement.test.js` | Wave 0 |
| PORT-04 | Position close calculates correct P&L with fees | unit | `npx vitest run tests/services/realPositionService.test.js` | Wave 0 |
| PORT-05 | Transaction history query returns correct data | unit | `npx vitest run tests/services/transactionHistory.test.js` | Wave 0 |
| PORT-06 | Portfolio summary aggregation correct | unit | `npx vitest run tests/services/portfolioSummary.test.js` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --reporter=verbose`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `ai-stoploss-engine-be/vitest.config.js` -- vitest config for backend
- [ ] `ai-stoploss-engine-be/tests/` directory -- test root
- [ ] `ai-stoploss-engine-be/tests/helpers/db.js` -- mock database helper (mock pg query)
- [ ] Install vitest: `cd ai-stoploss-engine-be && npm install -D vitest`

## Open Questions

1. **Holiday calendar maintenance**
   - What we know: Can hardcode lich nghi le HOSE/HNX 2026-2027
   - What's unclear: Ai va khi nao cap nhat lich cho nam moi? Co API nao khong?
   - Recommendation: Hardcode 2026-2027, them TODO comment nhan nho cap nhat truoc 2028. Log warning khi settlement date vuot qua 5 calendar days.

2. **Constraint `stop_loss NOT NULL` cho positions hien tai**
   - What we know: Schema hien tai require stop_loss > 0 cho moi position
   - What's unclear: Da co data cu nao co stop_loss = 0 hoac NULL chua?
   - Recommendation: Migration 007 ALTER stop_loss DROP NOT NULL, them conditional CHECK constraint (REAL positions cho phep NULL, PAPER van require)

3. **Frontend routing: Tab hay separate view?**
   - What we know: Sidebar hien tai co `portfolio` view. Can them phan biet REAL vs PAPER.
   - What's unclear: Them tab trong PortfolioView hay tao view rieng?
   - Recommendation: Them tab trong PortfolioView (Real | Paper) de user de chuyen doi. Khong can them sidebar item moi.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Backend runtime | (assumed) | v24.10.0 | -- |
| PostgreSQL | Database | (assumed) | 12+ | -- |
| npm | Package management | (assumed) | v10+ | -- |
| vitest | Test framework | Not installed | -- | Install as Wave 0 task |

**Missing dependencies with no fallback:** None

**Missing dependencies with fallback:**
- vitest: Not installed -- Wave 0 task to install

## Sources

### Primary (HIGH confidence)
- Codebase analysis: models/Order.js, models/Position.js, models/Portfolio.js, controllers/order.controller.js, services/fillEngine.js, services/feeEngine.js
- DB schema: migrations/schema.sql, migrations/006_orders_fees_audit.sql
- `.planning/research/ARCHITECTURE.md` -- bounded context separation strategy
- `.planning/research/PITFALLS.md` -- order/position identity crisis, T+2 settlement pitfall
- `.planning/codebase/ARCHITECTURE.md` -- current layered architecture
- `.planning/codebase/STRUCTURE.md` -- directory layout
- `.planning/codebase/CONVENTIONS.md` -- code patterns

### Secondary (MEDIUM confidence)
- `.planning/research/FEATURES.md` -- feature landscape va complexity estimates
- `.planning/REQUIREMENTS.md` -- requirement definitions

### Tertiary (LOW confidence)
- VN holiday calendar 2026: Based on standard holidays, may need updates when official schedule announced

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- da analyze codebase, khong them dependency moi
- Architecture: HIGH -- patterns tu ARCHITECTURE.md research + codebase analysis
- DB migration: HIGH -- verified actual schema constraints that need changing
- Pitfalls: HIGH -- identified real constraint conflicts (stop_loss NOT NULL) from schema analysis
- T+2 settlement: MEDIUM -- logic don gian nhung holiday calendar can maintenance

**Research date:** 2026-03-27
**Valid until:** 2026-04-27 (stable domain, no fast-moving dependencies)
