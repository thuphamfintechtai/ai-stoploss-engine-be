-- Migration 014: symbol listing flags (Phase 5 MDI-03)
-- Filter delisted symbols khỏi /api/market/symbols, getSymbolInfo, getEntryInfo.
-- Default TRUE để backward-compat: existing rows không bị ảnh hưởng.
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS.
--
-- Schema target: ${DB_MARKET_SCHEMA} (fallback ${DB_SCHEMA} fallback 'financial')
-- Apply thủ công: psql $DATABASE_URL -f migrations/014_symbol_listing_flags.sql
-- (Script migrate.js dùng search_path nên plain `symbols` cũng sẽ resolve về schema này.)

-- Schema qualifier: dùng `financial.symbols` theo MARKET_SCHEMA mặc định.
-- Nếu deploy dùng schema khác (vd `market`), set search_path trước khi chạy file này
-- hoặc sed thay chuỗi `financial.` sang schema thực tế.

ALTER TABLE financial.symbols
  ADD COLUMN IF NOT EXISTS is_listed BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_symbols_listed
  ON financial.symbols(is_listed) WHERE is_listed = TRUE;

COMMENT ON COLUMN financial.symbols.is_listed IS
  'Phase 5 MDI-03: FALSE khi symbol delisted khỏi sàn (suspended, huỷ niêm yết). Default TRUE cho backward-compat.';
