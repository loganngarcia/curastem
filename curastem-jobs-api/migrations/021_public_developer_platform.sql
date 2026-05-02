-- Public developer platform: API-key accounts, USD balances, and usage ledger.
-- Balances and charges use integer micro-USD to avoid floating point drift.

CREATE TABLE IF NOT EXISTS developer_accounts (
  id                      TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  owner_email             TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'active',
  created_at              INTEGER NOT NULL,
  updated_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_developer_accounts_owner_email
  ON developer_accounts (owner_email);

CREATE TABLE IF NOT EXISTS developer_account_balances (
  account_id              TEXT PRIMARY KEY REFERENCES developer_accounts(id) ON DELETE CASCADE,
  balance_usd_micros      INTEGER NOT NULL DEFAULT 0,
  updated_at              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS developer_balance_transactions (
  id                      TEXT PRIMARY KEY,
  account_id              TEXT NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
  type                    TEXT NOT NULL,
  amount_usd_micros       INTEGER NOT NULL,
  balance_after_usd_micros INTEGER NOT NULL,
  description             TEXT,
  admin_actor             TEXT,
  created_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_developer_balance_transactions_account
  ON developer_balance_transactions (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public_usage_ledger (
  id                      TEXT PRIMARY KEY,
  account_id              TEXT NOT NULL REFERENCES developer_accounts(id) ON DELETE CASCADE,
  api_key_id              TEXT NOT NULL REFERENCES api_keys(id),
  request_id              TEXT NOT NULL,
  route                   TEXT NOT NULL,
  tool_name               TEXT,
  status                  TEXT NOT NULL,
  provider                TEXT,
  model                   TEXT,
  input_tokens            INTEGER NOT NULL DEFAULT 0,
  output_tokens           INTEGER NOT NULL DEFAULT 0,
  total_tokens            INTEGER NOT NULL DEFAULT 0,
  raw_cost_usd_micros     INTEGER NOT NULL DEFAULT 0,
  charge_multiplier       REAL NOT NULL DEFAULT 5,
  charged_usd_micros      INTEGER NOT NULL DEFAULT 0,
  balance_after_usd_micros INTEGER,
  metadata_json           TEXT,
  created_at              INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_usage_ledger_request
  ON public_usage_ledger (request_id);
CREATE INDEX IF NOT EXISTS idx_public_usage_ledger_account
  ON public_usage_ledger (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_public_usage_ledger_key
  ON public_usage_ledger (api_key_id, created_at DESC);

ALTER TABLE api_keys ADD COLUMN account_id TEXT;
ALTER TABLE api_keys ADD COLUMN name TEXT;
ALTER TABLE api_keys ADD COLUMN key_prefix TEXT;
ALTER TABLE api_keys ADD COLUMN scopes TEXT;
ALTER TABLE api_keys ADD COLUMN daily_limit_usd_micros INTEGER;
ALTER TABLE api_keys ADD COLUMN monthly_limit_usd_micros INTEGER;

CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys (account_id);
