ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS outcome_yes_won BOOLEAN,
  ADD COLUMN IF NOT EXISTS outcome_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS outcome_winning_escrow_total_raw TEXT;
