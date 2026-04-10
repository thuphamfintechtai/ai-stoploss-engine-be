-- =============================================================================
-- Schema gộp – financial (users, portfolios, positions, signals, AI, risk, notifications)
-- Chạy: psql -U $DB_USER -d $DB_NAME -f migrations/schema.sql
-- Lưu ý: DROP SCHEMA CASCADE xóa toàn bộ dữ liệu. Chỉ dùng khi chưa có data hoặc reset.
-- =============================================================================

DROP SCHEMA IF EXISTS financial CASCADE;
CREATE SCHEMA financial;

-- ============================================================
-- 1. USERS
-- ============================================================

CREATE TABLE financial.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  CONSTRAINT chk_username_length CHECK (LENGTH(username) >= 3)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON financial.users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON financial.users(username);

COMMENT ON TABLE financial.users IS 'Bảng quản lý người dùng hệ thống';

-- ============================================================
-- 2. PORTFOLIOS (kèm expected_return_percent từ 004)
-- ============================================================

CREATE TABLE financial.portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES financial.users(id) ON DELETE CASCADE,
  name VARCHAR(255) DEFAULT 'Default Portfolio',
  total_balance NUMERIC(20, 2) NOT NULL CHECK (total_balance >= 0),
  max_risk_percent NUMERIC(5, 2) NOT NULL CHECK (max_risk_percent > 0 AND max_risk_percent <= 100),
  expected_return_percent NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (expected_return_percent >= -100 AND expected_return_percent <= 100),
  currency VARCHAR(10) DEFAULT 'VND',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user_id ON financial.portfolios(user_id);
CREATE INDEX IF NOT EXISTS idx_portfolios_is_active ON financial.portfolios(is_active);
CREATE INDEX IF NOT EXISTS idx_portfolios_created_at ON financial.portfolios(created_at DESC);

COMMENT ON TABLE financial.portfolios IS 'Bảng quản lý danh mục đầu tư (VND)';
COMMENT ON COLUMN financial.portfolios.expected_return_percent IS 'Lãi kỳ vọng theo kỳ (%)';

-- ============================================================
-- 3. TRIGGER updated_at (dùng chung)
-- ============================================================

CREATE OR REPLACE FUNCTION financial.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_users_updated_at ON financial.users;
CREATE TRIGGER trigger_users_updated_at
  BEFORE UPDATE ON financial.users
  FOR EACH ROW EXECUTE FUNCTION financial.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_portfolios_updated_at ON financial.portfolios;
CREATE TRIGGER trigger_portfolios_updated_at
  BEFORE UPDATE ON financial.portfolios
  FOR EACH ROW EXECUTE FUNCTION financial.update_updated_at_column();

-- ============================================================
-- 4. SIGNAL SOURCES
-- ============================================================

CREATE TABLE financial.signal_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL,
  description TEXT,
  strategy TEXT,
  roi NUMERIC(10, 2),
  win_rate NUMERIC(5, 2) CHECK (win_rate >= 0 AND win_rate <= 100),
  risk_score VARCHAR(10),
  total_signals INT DEFAULT 0 CHECK (total_signals >= 0),
  successful_signals INT DEFAULT 0 CHECK (successful_signals >= 0),
  followers_count INT DEFAULT 0 CHECK (followers_count >= 0),
  is_active BOOLEAN DEFAULT TRUE,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_source_type CHECK (source_type IN ('AI_GENERATED', 'TRADINGVIEW', 'TELEGRAM', 'USER_TRADER', 'MANUAL')),
  CONSTRAINT chk_successful_vs_total CHECK (successful_signals <= total_signals)
);

CREATE INDEX IF NOT EXISTS idx_signal_sources_type ON financial.signal_sources(source_type);
CREATE INDEX IF NOT EXISTS idx_signal_sources_active ON financial.signal_sources(is_active);

-- ============================================================
-- 5. POSITIONS (chỉ VND: risk_value_vnd, profit_loss_vnd)
-- ============================================================

CREATE TABLE financial.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES financial.portfolios(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  exchange VARCHAR(50) NOT NULL,
  entry_price NUMERIC(20, 8) NOT NULL CHECK (entry_price > 0),
  stop_loss NUMERIC(20, 8) NOT NULL CHECK (stop_loss > 0),
  take_profit NUMERIC(20, 8) CHECK (take_profit IS NULL OR take_profit > 0),
  quantity NUMERIC(20, 8) NOT NULL CHECK (quantity > 0),
  risk_value_vnd NUMERIC(20, 2) NOT NULL CHECK (risk_value_vnd >= 0),
  status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
  side VARCHAR(10) DEFAULT 'LONG',
  stop_type VARCHAR(30),
  stop_params JSONB,
  take_profit_type VARCHAR(30),
  take_profit_params JSONB,
  trailing_current_stop NUMERIC(20, 8),
  signal_source_id UUID REFERENCES financial.signal_sources(id) ON DELETE SET NULL,
  opened_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_price NUMERIC(20, 8),
  profit_loss_vnd NUMERIC(20, 2),
  profit_loss_usd NUMERIC(20, 2),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_position_status CHECK (status IN ('OPEN', 'CLOSED_TP', 'CLOSED_SL', 'CLOSED_MANUAL')),
  CONSTRAINT chk_closed_price_when_closed CHECK (
    (status = 'OPEN' AND closed_price IS NULL AND closed_at IS NULL) OR
    (status != 'OPEN' AND closed_price IS NOT NULL AND closed_at IS NOT NULL)
  ),
  CONSTRAINT chk_stop_loss_vs_entry CHECK (
    ((side IS NULL OR side = 'LONG') AND stop_loss < entry_price) OR
    (side = 'SHORT' AND stop_loss > entry_price)
  ),
  CONSTRAINT chk_take_profit_vs_entry CHECK (
    take_profit IS NULL
    OR ((side IS NULL OR side = 'LONG') AND take_profit > entry_price)
    OR (side = 'SHORT' AND take_profit < entry_price)
  ),
  CONSTRAINT chk_position_side CHECK (side IS NULL OR side IN ('LONG', 'SHORT'))
);

CREATE INDEX IF NOT EXISTS idx_positions_portfolio_id ON financial.positions(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_positions_status ON financial.positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON financial.positions(symbol, exchange);
CREATE INDEX IF NOT EXISTS idx_positions_opened_at ON financial.positions(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_signal_source ON financial.positions(signal_source_id);
CREATE INDEX IF NOT EXISTS idx_positions_portfolio_status ON financial.positions(portfolio_id, status);

COMMENT ON TABLE financial.positions IS 'Bảng vị thế giao dịch. Logic tiền tệ: VND.';

DROP TRIGGER IF EXISTS trigger_positions_updated_at ON financial.positions;
CREATE TRIGGER trigger_positions_updated_at
  BEFORE UPDATE ON financial.positions
  FOR EACH ROW EXECUTE FUNCTION financial.update_updated_at_column();

-- ============================================================
-- 6. SIGNALS
-- ============================================================

CREATE TABLE financial.signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id UUID NOT NULL REFERENCES financial.signal_sources(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  exchange VARCHAR(50) NOT NULL,
  action VARCHAR(10) NOT NULL,
  entry_price NUMERIC(20, 8) NOT NULL CHECK (entry_price > 0),
  stop_loss NUMERIC(20, 8) NOT NULL CHECK (stop_loss > 0),
  take_profit NUMERIC(20, 8) CHECK (take_profit IS NULL OR take_profit > 0),
  recommended_quantity NUMERIC(20, 8) CHECK (recommended_quantity IS NULL OR recommended_quantity > 0),
  confidence_score NUMERIC(5, 2) CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100)),
  reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_signal_action CHECK (action IN ('BUY', 'SELL')),
  CONSTRAINT chk_stop_loss_vs_entry_signal CHECK (
    (action = 'BUY' AND stop_loss < entry_price) OR
    (action = 'SELL' AND stop_loss > entry_price)
  )
);

CREATE INDEX IF NOT EXISTS idx_signals_source ON financial.signals(source_id);
CREATE INDEX IF NOT EXISTS idx_signals_symbol ON financial.signals(symbol, exchange);
CREATE INDEX IF NOT EXISTS idx_signals_created ON financial.signals(created_at DESC);

-- ============================================================
-- 7. AI EVALUATIONS
-- ============================================================

CREATE TABLE financial.ai_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES financial.signals(id) ON DELETE CASCADE,
  source_id UUID REFERENCES financial.signal_sources(id) ON DELETE CASCADE,
  symbol VARCHAR(50) NOT NULL,
  exchange VARCHAR(50) NOT NULL,
  market_fit_score INT CHECK (market_fit_score >= 0 AND market_fit_score <= 100),
  safety_score INT CHECK (safety_score >= 0 AND safety_score <= 100),
  overall_score INT GENERATED ALWAYS AS ((COALESCE(market_fit_score, 0) + COALESCE(safety_score, 0)) / 2) STORED,
  verdict VARCHAR(50) NOT NULL,
  market_analysis TEXT,
  pros TEXT[],
  cons TEXT[],
  strategy_match VARCHAR(255),
  technical_context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_verdict CHECK (verdict IN ('RECOMMENDED', 'CAUTION', 'AVOID', 'NEUTRAL')),
  CONSTRAINT chk_at_least_one_ref CHECK (signal_id IS NOT NULL OR source_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_ai_eval_signal ON financial.ai_evaluations(signal_id);
CREATE INDEX IF NOT EXISTS idx_ai_eval_source ON financial.ai_evaluations(source_id);
CREATE INDEX IF NOT EXISTS idx_ai_eval_verdict ON financial.ai_evaluations(verdict);

-- ============================================================
-- 8. PORTFOLIO RISK SNAPSHOTS
-- ============================================================

CREATE TABLE financial.portfolio_risk_snapshots (
  id BIGSERIAL PRIMARY KEY,
  portfolio_id UUID NOT NULL REFERENCES financial.portfolios(id) ON DELETE CASCADE,
  total_balance NUMERIC(20, 2),
  max_risk_usd NUMERIC(20, 2),
  current_risk_used_usd NUMERIC(20, 2),
  risk_usage_percent NUMERIC(5, 2),
  available_risk_usd NUMERIC(20, 2),
  open_positions_count INT,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_risk_usage_range CHECK (risk_usage_percent IS NULL OR (risk_usage_percent >= 0 AND risk_usage_percent <= 100))
);

CREATE INDEX IF NOT EXISTS idx_risk_snapshots_portfolio ON financial.portfolio_risk_snapshots(portfolio_id, timestamp DESC);

-- ============================================================
-- 9. TRADE ORDERS
-- ============================================================

CREATE TABLE financial.trade_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id UUID NOT NULL REFERENCES financial.positions(id) ON DELETE CASCADE,
  order_type VARCHAR(20) NOT NULL,
  executed_price NUMERIC(20, 8) NOT NULL CHECK (executed_price > 0),
  quantity NUMERIC(20, 8) NOT NULL CHECK (quantity > 0),
  total_value_vnd NUMERIC(20, 2),
  total_value_usd NUMERIC(20, 2),
  executed_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  metadata JSONB,
  CONSTRAINT chk_order_type CHECK (order_type IN ('OPEN', 'CLOSE_TP', 'CLOSE_SL', 'CLOSE_MANUAL', 'PARTIAL_CLOSE'))
);

CREATE INDEX IF NOT EXISTS idx_orders_position ON financial.trade_orders(position_id);
CREATE INDEX IF NOT EXISTS idx_orders_executed ON financial.trade_orders(executed_at DESC);

-- ============================================================
-- 10. NOTIFICATIONS
-- ============================================================

CREATE TABLE financial.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES financial.users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) DEFAULT 'INFO',
  metadata JSONB,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_notification_type CHECK (type IN (
    'SL_TRIGGERED', 'TP_TRIGGERED', 'RISK_WARNING', 'NEW_SIGNAL',
    'POSITION_OPENED', 'POSITION_CLOSED', 'SIGNAL_EXPIRED',
    'PORTFOLIO_UPDATE', 'SYSTEM', 'AI_ALERT'
  )),
  CONSTRAINT chk_severity CHECK (severity IN ('INFO', 'WARNING', 'ERROR', 'SUCCESS'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON financial.notifications(user_id, is_read, created_at DESC);

-- ============================================================
-- 11. TRIGGERS (signal_sources, notifications)
-- ============================================================

DROP TRIGGER IF EXISTS trigger_signal_sources_updated_at ON financial.signal_sources;
CREATE TRIGGER trigger_signal_sources_updated_at
  BEFORE UPDATE ON financial.signal_sources
  FOR EACH ROW EXECUTE FUNCTION financial.update_updated_at_column();

CREATE OR REPLACE FUNCTION financial.update_notification_read_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_read = TRUE AND (OLD.is_read = FALSE OR OLD.is_read IS NULL) THEN
    NEW.read_at = NOW();
  ELSIF NEW.is_read = FALSE THEN
    NEW.read_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_notifications_read_at ON financial.notifications;
CREATE TRIGGER trigger_notifications_read_at
  BEFORE UPDATE ON financial.notifications
  FOR EACH ROW EXECUTE FUNCTION financial.update_notification_read_at();

-- ============================================================
-- 12. VIEWS
-- ============================================================

CREATE OR REPLACE VIEW financial.v_open_positions AS
SELECT
  p.id,
  p.portfolio_id,
  po.user_id,
  po.name AS portfolio_name,
  p.symbol,
  p.exchange,
  p.entry_price,
  p.stop_loss,
  p.take_profit,
  p.quantity,
  p.risk_value_vnd,
  p.trailing_current_stop,
  p.opened_at,
  ss.name AS signal_source_name,
  ss.source_type
FROM financial.positions p
JOIN financial.portfolios po ON p.portfolio_id = po.id
LEFT JOIN financial.signal_sources ss ON p.signal_source_id = ss.id
WHERE p.status = 'OPEN';

CREATE OR REPLACE VIEW financial.v_active_signals AS
SELECT
  s.id,
  s.source_id,
  ss.name AS source_name,
  ss.source_type,
  s.symbol,
  s.exchange,
  s.action,
  s.entry_price,
  s.stop_loss,
  s.take_profit,
  s.confidence_score,
  s.reason,
  s.created_at,
  s.expires_at
FROM financial.signals s
JOIN financial.signal_sources ss ON s.source_id = ss.id
WHERE s.expires_at IS NULL OR s.expires_at > NOW()
ORDER BY s.created_at DESC;

CREATE OR REPLACE VIEW financial.v_unread_notifications_count AS
SELECT
  user_id,
  COUNT(*) AS unread_count,
  MAX(created_at) AS latest_notification_at
FROM financial.notifications
WHERE is_read = FALSE
GROUP BY user_id;

CREATE OR REPLACE VIEW financial.v_latest_ai_evaluations AS
SELECT
  ae.id,
  ae.signal_id,
  ae.source_id,
  ae.symbol,
  ae.exchange,
  ae.market_fit_score,
  ae.safety_score,
  ae.overall_score,
  ae.verdict,
  ae.market_analysis,
  ae.created_at,
  s.action,
  s.entry_price,
  s.stop_loss,
  s.confidence_score,
  ss.name AS source_name,
  ss.source_type
FROM financial.ai_evaluations ae
LEFT JOIN financial.signals s ON ae.signal_id = s.id
LEFT JOIN financial.signal_sources ss ON ae.source_id = ss.id OR (ae.signal_id IS NOT NULL AND s.source_id = ss.id)
ORDER BY ae.created_at DESC;

-- View risk portfolio – VND là chính (tương đương 006)
CREATE OR REPLACE VIEW financial.v_portfolio_current_risk AS
SELECT
  p.id AS portfolio_id,
  p.user_id,
  p.name AS portfolio_name,
  p.total_balance,
  p.max_risk_percent,
  ((p.total_balance * p.max_risk_percent / 100) / 25000)::NUMERIC(20, 2) AS max_risk_usd,
  (COALESCE(SUM(pos.risk_value_vnd), 0) / 25000)::NUMERIC(20, 2) AS current_risk_usd,
  (((p.total_balance * p.max_risk_percent / 100) - COALESCE(SUM(pos.risk_value_vnd), 0)) / 25000)::NUMERIC(20, 2) AS available_risk_usd,
  CASE
    WHEN p.total_balance > 0 AND p.max_risk_percent > 0 THEN
      (COALESCE(SUM(pos.risk_value_vnd), 0) / NULLIF(p.total_balance * p.max_risk_percent / 100, 0) * 100)::NUMERIC(5, 2)
    ELSE 0
  END AS risk_usage_percent,
  COUNT(pos.id)::INT AS open_positions_count,
  (p.total_balance * p.max_risk_percent / 100)::NUMERIC(20, 2) AS max_risk_vnd,
  COALESCE(SUM(pos.risk_value_vnd), 0)::NUMERIC(20, 2) AS current_risk_vnd,
  ((p.total_balance * p.max_risk_percent / 100) - COALESCE(SUM(pos.risk_value_vnd), 0))::NUMERIC(20, 2) AS available_risk_vnd
FROM financial.portfolios p
LEFT JOIN financial.positions pos ON p.id = pos.portfolio_id AND pos.status = 'OPEN'
GROUP BY p.id, p.user_id, p.name, p.total_balance, p.max_risk_percent;

COMMENT ON VIEW financial.v_portfolio_current_risk IS 'Trạng thái risk: VND là chính; _usd = VND/25000.';

-- ============================================================
-- 13. FUNCTION log_portfolio_risk_snapshot (dùng view trên)
-- ============================================================

CREATE OR REPLACE FUNCTION financial.log_portfolio_risk_snapshot(p_portfolio_id UUID)
RETURNS VOID AS $$
DECLARE
  v_risk_data RECORD;
BEGIN
  SELECT
    total_balance,
    max_risk_usd,
    current_risk_usd,
    available_risk_usd,
    risk_usage_percent,
    open_positions_count
  INTO v_risk_data
  FROM financial.v_portfolio_current_risk
  WHERE portfolio_id = p_portfolio_id;

  IF FOUND THEN
    INSERT INTO financial.portfolio_risk_snapshots (
      portfolio_id,
      total_balance,
      max_risk_usd,
      current_risk_used_usd,
      available_risk_usd,
      risk_usage_percent,
      open_positions_count
    ) VALUES (
      p_portfolio_id,
      v_risk_data.total_balance,
      v_risk_data.max_risk_usd,
      v_risk_data.current_risk_usd,
      v_risk_data.available_risk_usd,
      v_risk_data.risk_usage_percent,
      v_risk_data.open_positions_count
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 14. AI ANALYSES – Lịch sử phân tích AI theo mã cổ phiếu
-- ============================================================

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
