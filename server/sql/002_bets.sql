CREATE TABLE IF NOT EXISTS bets (
  id BIGSERIAL PRIMARY KEY,
  bet_id BIGINT NOT NULL,
  bet_address TEXT NOT NULL UNIQUE,
  bet_hash TEXT NOT NULL,
  question_raw TEXT NOT NULL,
  threshold_percent NUMERIC(4,2) NOT NULL,
  duration_minutes NUMERIC(4,2) NOT NULL,
  start_timestamp_unix BIGINT NOT NULL,
  settle_timestamp_unix BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  hint JSONB,
  join_fund_audit JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bets_bet_id ON bets(bet_id);
