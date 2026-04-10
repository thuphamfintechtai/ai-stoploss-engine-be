-- ============================================================
-- Migration 006: Orders, Fees, Slippage, Audit Trail
-- P0 changes theo kế hoạch kiến trúc lại hệ thống
-- ============================================================

-- 1. ORDERS TABLE (mới hoàn toàn)
-- Tách lifecycle lệnh ra khỏi positions
CREATE TABLE IF NOT EXISTS financial.orders (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id     UUID        NOT NULL REFERENCES financial.portfolios(id) ON DELETE CASCADE,
  symbol           VARCHAR(20) NOT NULL,
  exchange         VARCHAR(15) NOT NULL,
  side             VARCHAR(10) NOT NULL CHECK (side IN ('BUY','SELL')),
  order_type       VARCHAR(10) NOT NULL CHECK (order_type IN ('LO','ATO','ATC','MP')),
  limit_price      BIGINT,           -- VND, NULL cho ATO/ATC/MP
  quantity         INTEGER     NOT NULL CHECK (quantity > 0),
  filled_quantity  INTEGER     NOT NULL DEFAULT 0 CHECK (filled_quantity >= 0),
  avg_fill_price   BIGINT,           -- VND, set khi fill xong
  status           VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING','PARTIALLY_FILLED','FILLED','CANCELLED','EXPIRED','REJECTED')),
  reject_reason    TEXT,
  simulation_mode  VARCHAR(15) NOT NULL DEFAULT 'INSTANT' CHECK (simulation_mode IN ('INSTANT','REALISTIC')),
  -- SL/TP gắn vào order (sẽ chuyển sang position khi filled)
  stop_loss_vnd    BIGINT,
  stop_type        VARCHAR(30),
  stop_params      JSONB DEFAULT '{}',
  take_profit_vnd  BIGINT,
  take_profit_type VARCHAR(20),
  notes            TEXT,
  placed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  filled_at        TIMESTAMPTZ,
  expired_at       TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_portfolio_status ON financial.orders(portfolio_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_symbol_status ON financial.orders(symbol, status);
CREATE INDEX IF NOT EXISTS idx_orders_status_expired ON financial.orders(status, expired_at) WHERE status = 'PENDING';

-- 2. ALTER POSITIONS TABLE — thêm fee/slippage/audit fields
ALTER TABLE financial.positions
  ADD COLUMN IF NOT EXISTS order_id        UUID REFERENCES financial.orders(id),
  ADD COLUMN IF NOT EXISTS gross_pnl_vnd   BIGINT,
  ADD COLUMN IF NOT EXISTS buy_fee_vnd     BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sell_fee_vnd    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sell_tax_vnd    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slippage_vnd    BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slippage_reason VARCHAR(30) CHECK (slippage_reason IN ('GAP_DOWN','GAP_UP','PULLBACK_IN_CANDLE','FAVORABLE','NORMAL',NULL));

-- Backfill gross_pnl_vnd từ profit_loss_vnd cho records cũ
UPDATE financial.positions
SET gross_pnl_vnd = profit_loss_vnd
WHERE gross_pnl_vnd IS NULL AND profit_loss_vnd IS NOT NULL;

-- 3. ALTER PORTFOLIOS TABLE — fee config
ALTER TABLE financial.portfolios
  ADD COLUMN IF NOT EXISTS buy_fee_percent  DECIMAL(6,5) NOT NULL DEFAULT 0.00150,
  ADD COLUMN IF NOT EXISTS sell_fee_percent DECIMAL(6,5) NOT NULL DEFAULT 0.00150,
  ADD COLUMN IF NOT EXISTS sell_tax_percent DECIMAL(6,5) NOT NULL DEFAULT 0.00100;

COMMENT ON COLUMN financial.portfolios.buy_fee_percent  IS 'Phí môi giới mua (default 0.15%)';
COMMENT ON COLUMN financial.portfolios.sell_fee_percent IS 'Phí môi giới bán (default 0.15%)';
COMMENT ON COLUMN financial.portfolios.sell_tax_percent IS 'Thuế bán (default 0.1%)';

-- 4. EXECUTION LOGS TABLE (audit trail cho mọi state transition)
CREATE TABLE IF NOT EXISTS financial.execution_logs (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   VARCHAR(20) NOT NULL CHECK (entity_type IN ('ORDER','POSITION','ALERT')),
  entity_id     UUID    NOT NULL,
  portfolio_id  UUID    REFERENCES financial.portfolios(id),
  event_type    VARCHAR(40) NOT NULL,
  -- ORDER: ORDER_CREATED, ORDER_FILLED, ORDER_PARTIALLY_FILLED, ORDER_CANCELLED, ORDER_EXPIRED, ORDER_REJECTED
  -- POSITION: POSITION_CREATED, SL_TRIGGERED, TP_TRIGGERED, POSITION_CLOSED_MANUAL, TRAILING_UPDATED, SLIPPAGE_OCCURRED
  event_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trigger_price BIGINT,    -- giá ngưỡng (stop_loss / take_profit)
  fill_price    BIGINT,    -- giá thực tế fill
  slippage_vnd  BIGINT,
  metadata      JSONB DEFAULT '{}',
  worker_run_id VARCHAR(50)  -- correlate events trong cùng poll cycle
);

CREATE INDEX IF NOT EXISTS idx_exec_logs_entity ON financial.execution_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_exec_logs_portfolio ON financial.execution_logs(portfolio_id, event_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_logs_event_type ON financial.execution_logs(event_type, event_at DESC);

-- 5. AI RECOMMENDATIONS TABLE
CREATE TABLE IF NOT EXISTS financial.ai_recommendations (
  id                     UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID    NOT NULL REFERENCES financial.users(id),
  symbol                 VARCHAR(20) NOT NULL,
  exchange               VARCHAR(15),
  side                   VARCHAR(10) NOT NULL DEFAULT 'LONG' CHECK (side IN ('LONG','SHORT')),
  entry_price_at_request BIGINT  NOT NULL,
  ohlcv_from             DATE,
  ohlcv_to               DATE,
  days_available         INTEGER,
  -- Suggestions (3 mức: aggressive/moderate/conservative)
  suggestions            JSONB   NOT NULL DEFAULT '[]',
  -- Technical score (rule-based, KHÔNG từ Gemini)
  technical_score        INTEGER CHECK (technical_score BETWEEN 0 AND 100),
  technical_label        VARCHAR(20) CHECK (technical_label IN ('HOP_LY','TRUNG_BINH','YEU')),
  score_methodology      TEXT,
  -- AI explanation text (từ Gemini, chỉ text — không dùng để tính số)
  analysis_text          TEXT,
  key_levels             JSONB DEFAULT '{}',   -- {support:[], resistance:[], atr_14}
  -- Lifecycle
  status                 VARCHAR(20) NOT NULL DEFAULT 'GENERATED'
                         CHECK (status IN ('GENERATED','APPLIED','IGNORED','EXPIRED')),
  applied_level          VARCHAR(20) CHECK (applied_level IN ('aggressive','moderate','conservative')),
  applied_at             TIMESTAMPTZ,
  -- Metadata
  model_used             VARCHAR(50),
  disclaimer             TEXT    NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_rec_user ON financial.ai_recommendations(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_rec_symbol ON financial.ai_recommendations(symbol, created_at DESC);

-- 6. MODEL INFERENCE LOGS (track Gemini calls)
CREATE TABLE IF NOT EXISTS financial.model_inference_logs (
  id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID    REFERENCES financial.ai_recommendations(id),
  model_name        VARCHAR(50),
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  latency_ms        INTEGER,
  status            VARCHAR(20) CHECK (status IN ('SUCCESS','TIMEOUT','ERROR','FALLBACK')),
  error_message     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_model_logs_rec ON financial.model_inference_logs(recommendation_id);
CREATE INDEX IF NOT EXISTS idx_model_logs_created ON financial.model_inference_logs(created_at DESC);

-- Done
SELECT 'Migration 006 completed successfully' AS result;
