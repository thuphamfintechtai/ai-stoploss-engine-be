-- Migration 003: Watchlist & Price Alerts
-- Chạy bằng: node scripts/migrate-watchlist.js

-- 1. Bảng danh sách theo dõi (sync theo user, không chỉ localStorage)
CREATE TABLE IF NOT EXISTS financial.watchlists (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES financial.users(id) ON DELETE CASCADE,
  symbol      VARCHAR(20) NOT NULL,
  exchange    VARCHAR(10) NOT NULL DEFAULT 'HOSE',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_watchlist_user_symbol UNIQUE (user_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_watchlists_user ON financial.watchlists(user_id, created_at DESC);

-- 2. Bảng cảnh báo giá
CREATE TABLE IF NOT EXISTS financial.price_alerts (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          NOT NULL REFERENCES financial.users(id) ON DELETE CASCADE,
  symbol          VARCHAR(20)   NOT NULL,
  exchange        VARCHAR(10)   NOT NULL DEFAULT 'HOSE',
  -- condition: ABOVE=giá vượt lên, BELOW=giá giảm xuống, PERCENT_UP=tăng X%, PERCENT_DOWN=giảm X%
  condition       VARCHAR(20)   NOT NULL CHECK (condition IN ('ABOVE', 'BELOW', 'PERCENT_UP', 'PERCENT_DOWN')),
  target_value    NUMERIC(20,4) NOT NULL,        -- VND hoặc % tùy condition
  reference_price NUMERIC(20,4),                 -- giá tham chiếu lúc tạo alert (dùng cho PERCENT)
  note            TEXT,
  is_active       BOOLEAN       DEFAULT TRUE,
  is_triggered    BOOLEAN       DEFAULT FALSE,
  triggered_at    TIMESTAMPTZ,
  triggered_price NUMERIC(20,4),                 -- giá lúc alert kích hoạt
  created_at      TIMESTAMPTZ   DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_alerts_user ON financial.price_alerts(user_id, is_active, is_triggered);
CREATE INDEX IF NOT EXISTS idx_price_alerts_symbol ON financial.price_alerts(symbol, is_active);

-- Trigger: auto update updated_at
CREATE OR REPLACE FUNCTION financial.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trigger_price_alerts_updated_at ON financial.price_alerts;
CREATE TRIGGER trigger_price_alerts_updated_at
  BEFORE UPDATE ON financial.price_alerts
  FOR EACH ROW EXECUTE FUNCTION financial.set_updated_at();

-- 3. Mở rộng CHECK constraint của notifications để cho phép type PRICE_ALERT
ALTER TABLE financial.notifications DROP CONSTRAINT IF EXISTS chk_notification_type;
ALTER TABLE financial.notifications
  ADD CONSTRAINT chk_notification_type CHECK (type IN (
    'SL_TRIGGERED', 'TP_TRIGGERED', 'RISK_WARNING', 'NEW_SIGNAL',
    'POSITION_OPENED', 'POSITION_CLOSED', 'SIGNAL_EXPIRED',
    'PORTFOLIO_UPDATE', 'SYSTEM', 'AI_ALERT', 'PRICE_ALERT'
  ));
