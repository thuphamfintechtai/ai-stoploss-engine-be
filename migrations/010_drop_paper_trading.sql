-- ============================================================
-- Migration 010: Drop Paper Trading Schema
-- ============================================================
-- Xoa toan bo schema paper trading khoi database.
-- Forward-only — khong co rollback. Neu v2 can lai, rebuild moi.
--
-- Depends: 008 (tao paper_settlement_events + cols), 009 (paper index)
-- Triggered by: Phase 1 Remove Paper Trading (PTR-05)
-- ============================================================

BEGIN;

-- 1. RUNTIME FK safety check — abort migration neu co non-paper table FK toi paper_*
--    Ngan DROP CASCADE lan sang real tables neu prod DB co FK drift khong ngo toi.
--    Neu DO block raise exception → BEGIN rollback → khong co data loss.
DO $$
DECLARE
  fk_count INT;
BEGIN
  SELECT COUNT(*) INTO fk_count
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu USING (constraint_schema, constraint_name)
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name IN ('paper_orders','paper_positions','paper_virtual_balances','paper_settlement_events')
    AND tc.table_name NOT LIKE 'paper_%';
  IF fk_count > 0 THEN
    RAISE EXCEPTION 'FK safety check failed: % non-paper table(s) reference paper_*. Aborting migration to prevent data loss via CASCADE. Inspect va remove FK manually truoc khi rerun.', fk_count;
  END IF;
END $$;

-- 2. Drop indexes truoc (an toan)
DROP INDEX IF EXISTS financial.idx_paper_settlement_portfolio_settled;
DROP INDEX IF EXISTS financial.idx_paper_settlement_date;
DROP INDEX IF EXISTS financial.idx_paper_settlement_portfolio;
DROP INDEX IF EXISTS financial.idx_paper_orders_portfolio_status;
DROP INDEX IF EXISTS financial.idx_paper_positions_portfolio;

-- 3. Drop tables (CASCADE — sau FK safety check o buoc 1 da dam bao khong co real table reference.
--    paper_settlement_events FK to portfolios/orders ON DELETE CASCADE/SET NULL
--    nen DROP bang paper_* khong anh huong portfolios/orders.)
DROP TABLE IF EXISTS financial.paper_settlement_events CASCADE;
DROP TABLE IF EXISTS financial.paper_orders             CASCADE;
DROP TABLE IF EXISTS financial.paper_positions          CASCADE;
DROP TABLE IF EXISTS financial.paper_virtual_balances   CASCADE;

-- 4. Drop cac columns them vao portfolios trong migration 008
ALTER TABLE financial.portfolios
  DROP COLUMN IF EXISTS virtual_balance,
  DROP COLUMN IF EXISTS paper_available_cash,
  DROP COLUMN IF EXISTS paper_pending_settlement;

-- 5. Verification queries (ghi log de developer verify tay — khong fail migration)
-- SELECT tablename FROM pg_tables WHERE schemaname='financial' AND tablename LIKE 'paper_%';
-- Expected: 0 rows
-- SELECT column_name FROM information_schema.columns
--   WHERE table_schema='financial' AND table_name='portfolios'
--     AND column_name IN ('virtual_balance','paper_available_cash','paper_pending_settlement');
-- Expected: 0 rows

COMMIT;

-- ============================================================
-- Post-migration: update migrations/schema.sql canonical neu ton tai
-- va khong con tham chieu paper_*. Schema.sql scan 2026-04-19: da clean, khong can update.
-- ============================================================
