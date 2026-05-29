-- Migration 015: Fix available_cash backfill
-- Issue: Portfolios có total_balance > 0 nhưng available_cash = 0
-- Root cause: Migration 007 backfill không chạy hoặc portfolio tạo sau migration

-- 1. Backfill: available_cash = total_balance cho portfolios bị ảnh hưởng
UPDATE financial.portfolios 
SET available_cash = total_balance, updated_at = NOW()
WHERE available_cash = 0 AND total_balance > 0;

-- 2. Add trigger để tự động set available_cash khi tạo portfolio mới
CREATE OR REPLACE FUNCTION financial.set_default_available_cash()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.available_cash IS NULL OR NEW.available_cash = 0 THEN
    NEW.available_cash := NEW.total_balance;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_default_available_cash ON financial.portfolios;
CREATE TRIGGER trg_set_default_available_cash
  BEFORE INSERT ON financial.portfolios
  FOR EACH ROW
  EXECUTE FUNCTION financial.set_default_available_cash();
