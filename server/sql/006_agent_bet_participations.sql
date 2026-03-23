CREATE TABLE IF NOT EXISTS agent_bet_participations (
  id BIGSERIAL PRIMARY KEY,
  agent_wallet_address TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  bet_row_id BIGINT NOT NULL REFERENCES bets (id) ON DELETE CASCADE,
  bet_address TEXT NOT NULL,
  onchain_bet_id TEXT NOT NULL,
  status TEXT NOT NULL,
  join_tx_hash TEXT,
  fund_tx_hash TEXT,
  vote_tx_hash TEXT,
  vote_yes BOOLEAN,
  detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_abp_agent_wallet ON agent_bet_participations (agent_wallet_address);
CREATE INDEX IF NOT EXISTS idx_abp_bet_row ON agent_bet_participations (bet_row_id);
CREATE INDEX IF NOT EXISTS idx_abp_status ON agent_bet_participations (status);
