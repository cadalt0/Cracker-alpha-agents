CREATE TABLE IF NOT EXISTS delegation_publish_jobs (
  id BIGSERIAL PRIMARY KEY,
  wallet_address TEXT NOT NULL,
  smart_account_address TEXT NOT NULL,
  request_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  tx_hash TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delegation_jobs_wallet ON delegation_publish_jobs(wallet_address);
