-- ============================================================
-- Migration 007: Context Separation (REAL/PAPER) + Cash Balance
-- Tach REAL orders/positions khoi PAPER trading simulation
-- ============================================================

-- 1. THEM context column vao orders (D-01)
ALTER TABLE financial.orders
  ADD COLUMN IF NOT EXISTS context VARCHAR(20) NOT NULL DEFAULT 'PAPER'
  CHECK (context IN ('REAL', 'PAPER'));

-- 2. THEM context column vao positions (D-01)
ALTER TABLE financial.positions
  ADD COLUMN IF NOT EXISTS context VARCHAR(20) NOT NULL DEFAULT 'PAPER'
  CHECK (context IN ('REAL', 'PAPER'));

-- 3. THEM real order specific columns vao orders
ALTER TABLE financial.orders
  ADD COLUMN IF NOT EXISTS actual_filled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS manual_entry BOOLEAN DEFAULT FALSE;

-- 4. UPDATE status constraint de cho phep 'RECORDED'
ALTER TABLE financial.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE financial.orders ADD CONSTRAINT orders_status_check
  CHECK (status IN ('PENDING','PARTIALLY_FILLED','FILLED','CANCELLED','EXPIRED','REJECTED','RECORDED'));

-- 5. UPDATE order_type constraint de cho phep 'MANUAL_RECORD'
ALTER TABLE financial.orders DROP CONSTRAINT IF EXISTS orders_order_type_check;
ALTER TABLE financial.orders ADD CONSTRAINT orders_order_type_check
  CHECK (order_type IN ('LO','ATO','ATC','MP','MANUAL_RECORD'));

-- 6. RELAX stop_loss NOT NULL constraint cho REAL positions (Pitfall 5)
ALTER TABLE financial.positions ALTER COLUMN stop_loss DROP NOT NULL;
ALTER TABLE financial.positions DROP CONSTRAINT IF EXISTS chk_stop_loss_vs_entry;
ALTER TABLE financial.positions ADD CONSTRAINT chk_stop_loss_vs_entry CHECK (
  context = 'REAL' OR stop_loss IS NULL
  OR ((side IS NULL OR side = 'LONG') AND stop_loss < entry_price)
  OR (side = 'SHORT' AND stop_loss > entry_price)
);

-- 7. THEM cash balance fields vao portfolios (D-07)
ALTER TABLE financial.portfolios
  ADD COLUMN IF NOT EXISTS available_cash NUMERIC(20, 2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_settlement_cash NUMERIC(20, 2) DEFAULT 0;

-- Backfill: set available_cash = total_balance cho portfolios cu
UPDATE financial.portfolios SET available_cash = total_balance WHERE available_cash = 0 OR available_cash IS NULL;

-- 8. TAO settlement_events table
CREATE TABLE IF NOT EXISTS financial.settlement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES financial.portfolios(id) ON DELETE CASCADE,
  amount NUMERIC(20, 2) NOT NULL,
  settlement_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SETTLED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

-- 9. INDEXES
CREATE INDEX IF NOT EXISTS idx_settlement_portfolio ON financial.settlement_events(portfolio_id, status);
CREATE INDEX IF NOT EXISTS idx_settlement_date ON financial.settlement_events(settlement_date, status) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_orders_context ON financial.orders(context);
CREATE INDEX IF NOT EXISTS idx_positions_context ON financial.positions(context);
CREATE INDEX IF NOT EXISTS idx_positions_portfolio_context ON financial.positions(portfolio_id, context, status);

SELECT 'Migration 007 completed successfully' AS result;
