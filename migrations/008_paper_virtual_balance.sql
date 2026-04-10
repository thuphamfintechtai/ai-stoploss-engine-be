-- ============================================================
-- Migration 008: Paper Trading Virtual Balance + Settlement Events
-- Them virtual balance fields va paper_settlement_events table
-- ============================================================

-- 1. THEM virtual balance fields vao portfolios (D-05, D-07)
ALTER TABLE financial.portfolios
  ADD COLUMN IF NOT EXISTS virtual_balance NUMERIC(20, 2) DEFAULT 1000000000,
  ADD COLUMN IF NOT EXISTS paper_available_cash NUMERIC(20, 2) DEFAULT 1000000000,
  ADD COLUMN IF NOT EXISTS paper_pending_settlement NUMERIC(20, 2) DEFAULT 0;

-- 2. Backfill: dam bao paper_available_cash = virtual_balance cho portfolios cu
UPDATE financial.portfolios
SET paper_available_cash = virtual_balance
WHERE paper_available_cash IS NULL OR paper_available_cash = 0;

-- 3. TAO paper_settlement_events table (rieng biet, khong mix voi REAL settlement_events)
CREATE TABLE IF NOT EXISTS financial.paper_settlement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES financial.portfolios(id) ON DELETE CASCADE,
  order_id UUID REFERENCES financial.orders(id) ON DELETE SET NULL,
  amount NUMERIC(20, 2) NOT NULL,
  settlement_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SETTLED', 'CANCELLED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ
);

-- 4. INDEXES cho paper_settlement_events
CREATE INDEX IF NOT EXISTS idx_paper_settlement_portfolio
  ON financial.paper_settlement_events(portfolio_id, status);

CREATE INDEX IF NOT EXISTS idx_paper_settlement_date
  ON financial.paper_settlement_events(settlement_date, status)
  WHERE status = 'PENDING';

SELECT 'Migration 008 completed successfully' AS result;
