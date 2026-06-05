-- =============================================================================
-- DOWN 0274: revert the epistemic belief layer + learning-signal persistence.
--
-- WARNING: DATA LOSS. Dropping brain_beliefs / belief_revisions loses the
-- brain's entire epistemic state + its immutable revision history; dropping
-- learning_signals / preference_pairs / preference_head_weights loses the
-- learning telemetry + trained DPO head. Down only on dev / staging, never on
-- prod without an export-then-restore plan.
--
-- Reverses: 0274_litfin_belief_learning.sql:
--   - DROP RLS policies (tenant_isolation per table)
--   - DROP indexes (unique + secondary)
--   - DROP the seven tables (CASCADE)
--
-- Grants do not need explicit reversal — they vanish with the tables.
-- =============================================================================

DROP POLICY IF EXISTS brain_beliefs_tenant_isolation            ON public.brain_beliefs;
DROP POLICY IF EXISTS belief_revisions_tenant_isolation         ON public.belief_revisions;
DROP POLICY IF EXISTS belief_review_queue_tenant_isolation      ON public.belief_review_queue;
DROP POLICY IF EXISTS learning_signals_tenant_isolation         ON public.learning_signals;
DROP POLICY IF EXISTS preference_pairs_tenant_isolation         ON public.preference_pairs;
DROP POLICY IF EXISTS preference_head_weights_tenant_isolation  ON public.preference_head_weights;
DROP POLICY IF EXISTS correlation_findings_tenant_isolation     ON public.correlation_findings;

DROP TABLE IF EXISTS public.correlation_findings     CASCADE;
DROP TABLE IF EXISTS public.preference_head_weights  CASCADE;
DROP TABLE IF EXISTS public.preference_pairs         CASCADE;
DROP TABLE IF EXISTS public.learning_signals         CASCADE;
DROP TABLE IF EXISTS public.belief_review_queue      CASCADE;
DROP TABLE IF EXISTS public.belief_revisions         CASCADE;
DROP TABLE IF EXISTS public.brain_beliefs            CASCADE;
