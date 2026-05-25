-- =============================================================================
-- DOWN 0272: revert tenant_llm_budgets + tenant_llm_budget_caps.
--
-- WARNING: DATA LOSS. Dropping the tables loses every accumulated spend
-- record AND the per-tenant cap configuration. Reverting in prod will
-- reset the budget governor to "no caps" until caps are re-seeded.
--
-- Reverses: 0272_tenant_llm_budgets.sql (CREATE TABLE x2 + index).
-- Idempotent.
-- =============================================================================

DROP INDEX IF EXISTS tenant_llm_budgets_tenant_period_idx;

DROP TABLE IF EXISTS public.tenant_llm_budget_caps CASCADE;
DROP TABLE IF EXISTS public.tenant_llm_budgets CASCADE;
