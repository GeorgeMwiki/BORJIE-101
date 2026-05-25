-- Migration 0159 — drop literal `'KES'` defaults from every currency
-- column outside the explicit `currency_preferences` table.
--
-- Rationale (ProdFix-2 wire #3):
--   The original schemas defaulted to `'KES'` so a missed currency
--   field would silently pin a row to KES regardless of the tenant's
--   region / currency_preferences setting. That defeats the per-
--   tenant currency-resolution chain we shipped in migration 0119
--   (currency_preferences) and 0156/0158 (tenants.region).
--
--   This migration drops the literal defaults; the application layer
--   MUST now resolve the per-tenant currency from
--   `CurrencyPreferencesService.resolve({ tenantId })` before insert.
--   A missed wire surfaces as a NOT-NULL violation rather than a
--   silent 'KES'.
--
-- Tables touched:
--   - tenant_financial_statements.income_currency (NOT NULL kept)
--   - marketplace_listings.currency               (NOT NULL kept)
--   - tenders.currency                            (NOT NULL kept)
--   - bids.currency                               (NOT NULL kept)
--   - negotiation_policies.currency               (NOT NULL kept)
--   - conditional_survey_action_plans.currency    (was nullable already)
--
-- Existing rows keep their stored value — this migration only changes
-- the DEFAULT on the column, not the data.

ALTER TABLE tenant_financial_statements ALTER COLUMN income_currency DROP DEFAULT;
ALTER TABLE marketplace_listings        ALTER COLUMN currency        DROP DEFAULT;
ALTER TABLE tenders                     ALTER COLUMN currency        DROP DEFAULT;
ALTER TABLE bids                        ALTER COLUMN currency        DROP DEFAULT;
ALTER TABLE negotiation_policies        ALTER COLUMN currency        DROP DEFAULT;
ALTER TABLE conditional_survey_action_plans
                                       ALTER COLUMN currency        DROP DEFAULT;
