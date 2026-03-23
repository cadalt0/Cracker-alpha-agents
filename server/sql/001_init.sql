CREATE TABLE IF NOT EXISTS agents (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  agent_name TEXT NOT NULL,
  smart_account_address TEXT,
  delegation_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_wallet_address ON agents(wallet_address);
