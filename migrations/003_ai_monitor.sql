-- Migration: Add AI Monitor columns to portfolios table
-- Run: psql -d your_db -f migrations/003_ai_monitor.sql

-- Add AI monitor settings to portfolios
ALTER TABLE financial.portfolios
  ADD COLUMN IF NOT EXISTS ai_monitor_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS ai_monitor_frequency_min INTEGER DEFAULT 30 CHECK (ai_monitor_frequency_min IN (15, 30, 60, 120)),
  ADD COLUMN IF NOT EXISTS ai_monitor_last_run TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_monitor_next_run TIMESTAMPTZ;

-- Create AI alerts table
CREATE TABLE IF NOT EXISTS financial.ai_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES financial.portfolios(id) ON DELETE CASCADE,
  position_id UUID REFERENCES financial.positions(id) ON DELETE SET NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  symbol VARCHAR(20),
  title VARCHAR(255) NOT NULL,
  narrative TEXT NOT NULL,
  action_type VARCHAR(20) CHECK (action_type IN ('HOLD', 'TIGHTEN_SL', 'TAKE_PARTIAL', 'EXIT', 'REBALANCE', 'INFO')),
  action_payload JSONB,
  acked_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_alerts_portfolio_id ON financial.ai_alerts(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_ai_alerts_created_at ON financial.ai_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_alerts_dismissed ON financial.ai_alerts(dismissed_at) WHERE dismissed_at IS NULL;

COMMENT ON TABLE financial.ai_alerts IS 'AI-generated alerts for portfolio monitoring';
