-- Migration 005: Bảng lịch sử AI review vị thế
-- Chạy: psql -U $DB_USER -d $DB_NAME -f migrations/005_ai_position_reviews.sql

CREATE TABLE IF NOT EXISTS financial.ai_position_reviews (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES financial.users(id) ON DELETE CASCADE,
  portfolio_id           UUID NOT NULL REFERENCES financial.portfolios(id) ON DELETE CASCADE,
  positions_reviewed     INTEGER NOT NULL DEFAULT 0,
  portfolio_health_score INTEGER,
  recommendations        JSONB,   -- mảng { position_id, symbol, action, new_stop_loss, new_take_profit, reasoning, urgency, key_concern }
  current_prices         JSONB,   -- { symbol: priceVND }
  applied_count          INTEGER NOT NULL DEFAULT 0,  -- số đề xuất user đã áp dụng
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_position_reviews_portfolio
  ON financial.ai_position_reviews (portfolio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_position_reviews_user
  ON financial.ai_position_reviews (user_id, created_at DESC);

COMMENT ON TABLE financial.ai_position_reviews IS 'Lịch sử AI review vị thế đang mở, lưu đề xuất SL/TP và health score';
