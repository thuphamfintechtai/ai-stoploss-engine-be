-- Migration 007: User settings JSONB + ai_position_reviews dismiss tracking
-- Chạy: psql -U $DB_USER -d $DB_NAME -f migrations/007_user_settings_and_dismiss_count.sql
-- Hoặc:  cd ai-stoploss-engine-be && node -e "..." (ad-hoc node)

BEGIN;

-- 1. Add settings JSONB column to users
ALTER TABLE financial.users
  ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN financial.users.settings IS
  'JSONB user preferences. Keys: enable_proactive_real_review (bool, default false). Forward-compatible.';

-- 2. Add dismiss_count to ai_position_reviews
ALTER TABLE financial.ai_position_reviews
  ADD COLUMN IF NOT EXISTS dismiss_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN financial.ai_position_reviews.dismiss_count IS
  'Số lần user dismiss bất kỳ rec nào trong batch này. Phase 07 feedback loop counter.';

-- 3. Partial index để worker query dismiss history nhanh (chỉ rows có dismiss > 0)
CREATE INDEX IF NOT EXISTS idx_ai_position_reviews_user_created_dismiss
  ON financial.ai_position_reviews (user_id, created_at DESC)
  WHERE dismiss_count > 0;

COMMIT;
