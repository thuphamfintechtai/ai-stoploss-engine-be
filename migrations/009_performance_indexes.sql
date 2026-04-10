-- Migration 009: Performance indexes cho frequent queries
-- Muc tieu: Toi uu hoa pagination sort, context filter, settlement lookup

-- Positions: composite index cho pagination voi opened_at sort (D-13)
-- Ho tro ORDER BY opened_at DESC khi filter theo portfolio_id
CREATE INDEX IF NOT EXISTS idx_positions_portfolio_opened
  ON financial.positions(portfolio_id, opened_at DESC);

-- Positions: context filter (REAL/PAPER queries)
-- Note: idx_positions_context va idx_orders_context da co tu migration 007
-- Them lai IF NOT EXISTS de dam bao idempotent
CREATE INDEX IF NOT EXISTS idx_positions_context
  ON financial.positions(context);

-- Orders: context filter
CREATE INDEX IF NOT EXISTS idx_orders_context
  ON financial.orders(context);

-- Settlement events: lookup by portfolio + settled status (D-16)
-- Dung status column (khong co is_settled)
CREATE INDEX IF NOT EXISTS idx_settlement_portfolio_settled
  ON financial.settlement_events(portfolio_id, status)
  WHERE status = 'SETTLED';

-- Paper settlement: lookup by portfolio + settled status
CREATE INDEX IF NOT EXISTS idx_paper_settlement_portfolio_settled
  ON financial.paper_settlement_events(portfolio_id, status)
  WHERE status = 'SETTLED';
