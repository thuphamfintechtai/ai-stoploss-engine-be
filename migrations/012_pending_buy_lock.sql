-- ============================================================
-- Migration 012: Pending Buy Lock (MAP-01, D-05, D-07)
-- Them column pending_buy_lock de track tien dang lock cho pending buy orders.
-- buying_power = available_cash - pending_buy_lock
-- CHECK constraint: pending_buy_lock >= 0 (D-07) — hang phong ve cuoi cung
-- khi application logic co bug → DB tu choi row am.
-- ============================================================

-- 1. ADD COLUMN idempotent (IF NOT EXISTS)
ALTER TABLE financial.portfolios
  ADD COLUMN IF NOT EXISTS pending_buy_lock NUMERIC(20, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN financial.portfolios.pending_buy_lock IS
  'Tong tien dang lock cho pending BUY orders (MAP-01). buying_power = available_cash - pending_buy_lock';

-- 2. Backfill: rows cu pending_buy_lock = 0 (DEFAULT da xu ly, explicit cho ro rang)
UPDATE financial.portfolios SET pending_buy_lock = 0 WHERE pending_buy_lock IS NULL;

-- 3. D-07: CHECK constraint idempotent
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_pending_buy_lock_nonneg'
      AND conrelid = 'financial.portfolios'::regclass
  ) THEN
    ALTER TABLE financial.portfolios
      ADD CONSTRAINT chk_pending_buy_lock_nonneg
      CHECK (pending_buy_lock >= 0);
  END IF;
END $$;

-- 4. Data integrity checks sau ALTER (raise exception → rollback neu vi pham)
DO $$
DECLARE
  neg_count INT;
  over_count INT;
BEGIN
  -- Defense-in-depth: dam bao khong co row am (dung du CHECK constraint da chan)
  SELECT COUNT(*) INTO neg_count
  FROM financial.portfolios
  WHERE pending_buy_lock < 0;
  IF neg_count > 0 THEN
    RAISE EXCEPTION 'Migration 012 FAILED: % rows co pending_buy_lock < 0', neg_count;
  END IF;

  -- Data integrity: khong the lock qua so tien co trong available_cash
  SELECT COUNT(*) INTO over_count
  FROM financial.portfolios
  WHERE pending_buy_lock > available_cash;
  IF over_count > 0 THEN
    RAISE EXCEPTION 'Migration 012 FAILED: % rows co pending_buy_lock > available_cash (data integrity violation)', over_count;
  END IF;
END $$;

SELECT 'Migration 012 completed successfully' AS result;
