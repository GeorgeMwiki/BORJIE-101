-- =============================================================================
-- Down-migration 0320 — reverse platform_llm_routing_config.
--
-- Dev/staging only. Dropping this table removes the LLM control-plane routing
-- config (core model + ordered fallback chain + ensemble + per-use-case map).
-- The fail-safe consequence is benign: the router consumption layer treats an
-- absent config exactly like an empty one and falls back to the static
-- TASK_LADDER — i.e. the pre-control-plane behaviour. No money/licence/ledger
-- records live here; sovereign HITL rails never depended on this table (they
-- live in the policy-gate). POWERS / kill-switch flags live in
-- platform_feature_flags and are untouched by this reversal.
--
-- Reverses migration 0320_llm_routing_config.sql.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS platform_llm_routing_config_service_role_only
  ON platform_llm_routing_config;

DROP INDEX IF EXISTS idx_platform_llm_routing_config_scope;

DROP TABLE IF EXISTS platform_llm_routing_config;

COMMIT;
