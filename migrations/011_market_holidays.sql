-- Migration 011: market_holidays table (F0 empty schema, v2 seed data)
-- Phase 2 — vnMarketRules dùng weekend check; table này chuẩn bị cho holiday calendar v2.

CREATE TABLE IF NOT EXISTS market_holidays (
  id           SERIAL PRIMARY KEY,
  holiday_date DATE         NOT NULL,
  exchange     VARCHAR(10)  NOT NULL CHECK (exchange IN ('HOSE', 'HNX', 'UPCOM', 'ALL')),
  description  TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT market_holidays_unique UNIQUE (holiday_date, exchange)
);

CREATE INDEX IF NOT EXISTS idx_market_holidays_date ON market_holidays (holiday_date);
CREATE INDEX IF NOT EXISTS idx_market_holidays_exchange ON market_holidays (exchange);

COMMENT ON TABLE market_holidays IS
  'Lịch nghỉ lễ theo sàn — F0 empty, v2+ seed từ HOSE/HNX/UPCOM official';
COMMENT ON COLUMN market_holidays.exchange IS
  'Sàn áp dụng. ALL = tất cả sàn nghỉ cùng (Tết, Quốc khánh, ...).';
