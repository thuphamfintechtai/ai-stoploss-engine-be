-- ============================================================
-- Migration 013: AI Audit Log (AIT-09, D-09)
-- Ghi lai moi Gemini call cho forensics / dispute resolution.
-- Threat mitigated: T-04-09 (user tranh cai AI recommendation, khong co bang chung).
--
-- Run: psql $DATABASE_URL -f migrations/013_ai_audit_log.sql
-- ============================================================

BEGIN;

SET search_path TO financial, public;

CREATE TABLE IF NOT EXISTS financial.ai_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES financial.users(id) ON DELETE CASCADE,
  endpoint        VARCHAR(100) NOT NULL,
  model_version   VARCHAR(50),
  prompt_text     TEXT,
  response_text   TEXT,
  input_tokens    INT,
  output_tokens   INT,
  latency_ms      INT,
  status          VARCHAR(20) DEFAULT 'success',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Query pattern: lay audit recent cua 1 user → (user_id, created_at DESC)
CREATE INDEX IF NOT EXISTS idx_ai_audit_user_created
  ON financial.ai_audit_log (user_id, created_at DESC);

COMMENT ON TABLE financial.ai_audit_log IS
  'AI call forensics (AIT-09). Retention: manual TRUNCATE theo policy v2.';
COMMENT ON COLUMN financial.ai_audit_log.status IS
  'success | fallback | error — phan biet Gemini thanh cong vs rule-based fallback';

COMMIT;

SELECT 'Migration 013 completed successfully' AS result;
