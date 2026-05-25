-- ─────────────────────────────────────────────────────────────────────
-- Migration 0119 — Currency preferences (per-user / per-tenant /
-- platform default). Resolution chain: user → tenant → platform.
--
-- Currency is a free-form ISO-4217 TEXT (no enum) so new codes can
-- be added without migrations. Pairs with currency_rates (0117).
-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS currency_preferences (
  scope_kind TEXT        NOT NULL,        -- 'user' | 'tenant' | 'platform-default'
  scope_id   TEXT        NOT NULL,        -- userId | tenantId | '*'
  currency   TEXT        NOT NULL,        -- ISO-4217, uppercase
  source     TEXT,                        -- 'self-selected' | 'admin-set' | 'seed'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_kind, scope_id)
);

CREATE INDEX IF NOT EXISTS idx_currency_preferences_kind
  ON currency_preferences (scope_kind);

-- Seed the platform-default singleton. Operators may override later
-- via the admin UI / a follow-up CLI; this is the safe fallback when
-- a user has neither a personal nor a tenant preference.
INSERT INTO currency_preferences (scope_kind, scope_id, currency, source)
VALUES ('platform-default', '*', 'USD', 'seed')
ON CONFLICT (scope_kind, scope_id) DO NOTHING;

COMMENT ON TABLE currency_preferences IS
  'Per-scope display-currency choice. Resolution: user > tenant > platform-default. ISO-4217 codes; pairs with currency_rates for FX normalisation.';
