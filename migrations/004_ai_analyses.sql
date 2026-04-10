-- Migration 004: Tạo bảng lịch sử phân tích AI
-- Chạy: psql -U $DB_USER -d $DB_NAME -f migrations/004_ai_analyses.sql

CREATE TABLE IF NOT EXISTS financial.ai_analyses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES financial.users(id) ON DELETE CASCADE,
  symbol      VARCHAR(20) NOT NULL,
  exchange    VARCHAR(10) NOT NULL DEFAULT 'HOSE',
  trend       VARCHAR(20),
  strength    INTEGER,
  recommendation VARCHAR(10),
  summary     TEXT,
  signals     JSONB,
  key_levels  JSONB,
  volume_analysis TEXT,
  current_price   NUMERIC(20,4),
  candles_used    INTEGER,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_analyses_user_symbol
  ON financial.ai_analyses (user_id, symbol, created_at DESC);

COMMENT ON TABLE financial.ai_analyses IS 'Lịch sử phân tích xu hướng AI cho từng mã CK theo user';
