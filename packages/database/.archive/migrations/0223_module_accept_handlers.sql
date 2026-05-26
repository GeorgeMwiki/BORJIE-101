-- =============================================================================
-- 0220: module_accept_handlers — registry of accept_proposal handlers.
--
-- The executor (`packages/central-intelligence/src/kernel/agency/executor`)
-- looks up handlers in this table to dispatch a `module_update_proposals`
-- row to the right code path inside a module template. Every handler:
--
--   1. Belongs to ONE module template (e.g. ESTATE, HR, FLEET).
--   2. Implements ONE action (`create_lease_application`,
--      `start_onboarding_workflow`, `post_receipt_draft`, ...).
--   3. Declares its `payload_zod_jsonb` so the executor can validate
--      payloads at runtime without re-deploying.
--   4. Declares `allowed_persona_tiers` (subset of {1..5}) so the
--      executor refuses calls from disallowed tiers.
--   5. Declares its `risk_tier` so the inviolable + policy-gate know
--      when to demand four-eye / sovereign-ledger.
--   6. Declares `emits_money_mutation` so the money-path guard knows
--      the ledger transaction must originate from here.
--
-- Handler resolution is INSERT-only at boot — the @borjie/module-
-- templates package UPSERTs its handlers on service startup. Editing a
-- handler is done via INSERT of a new version + soft-delete of the old.
-- (For Piece B we treat each (template, action) as a single live row.)
--
-- This table is PLATFORM-WIDE. Tenants neither read nor write it
-- directly; the executor reads it server-side.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Create module_accept_handlers table.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS module_accept_handlers (
  id                      TEXT PRIMARY KEY,
  module_template_id      TEXT NOT NULL REFERENCES module_templates(slug) ON DELETE CASCADE,
  action                  TEXT NOT NULL,
  payload_zod_jsonb       JSONB NOT NULL,
  handler_module          TEXT NOT NULL,
  allowed_persona_tiers   SMALLINT[] NOT NULL,
  risk_tier               TEXT NOT NULL DEFAULT 'MEDIUM'
    CHECK (risk_tier IN ('LOW', 'MEDIUM', 'HIGH', 'SOVEREIGN')),
  emits_money_mutation    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_module_accept_handlers_action UNIQUE (module_template_id, action),
  CONSTRAINT ck_module_accept_handlers_payload_object CHECK (
    jsonb_typeof(payload_zod_jsonb) = 'object'
  ),
  CONSTRAINT ck_module_accept_handlers_handler_nonempty CHECK (
    length(handler_module) > 0
  ),
  CONSTRAINT ck_module_accept_handlers_tiers_nonempty CHECK (
    array_length(allowed_persona_tiers, 1) >= 1
  )
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Indexes.
-- ─────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS module_accept_handlers_template_idx
  ON module_accept_handlers (module_template_id);

CREATE INDEX IF NOT EXISTS module_accept_handlers_risk_idx
  ON module_accept_handlers (risk_tier)
  WHERE risk_tier IN ('HIGH', 'SOVEREIGN');

CREATE INDEX IF NOT EXISTS module_accept_handlers_money_idx
  ON module_accept_handlers (emits_money_mutation)
  WHERE emits_money_mutation = TRUE;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. RLS — platform-wide catalogue. SELECT allowed for authenticated;
--    INSERT / UPDATE / DELETE forbidden from authenticated (service-role
--    only — handlers are registered via boot).
-- ─────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'module_accept_handlers'
  ) THEN
    ALTER TABLE public.module_accept_handlers ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.module_accept_handlers FORCE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS module_accept_handlers_select_all ON public.module_accept_handlers;
    DROP POLICY IF EXISTS module_accept_handlers_modify_none ON public.module_accept_handlers;

    EXECUTE $pol$
      CREATE POLICY module_accept_handlers_select_all ON public.module_accept_handlers
      FOR SELECT
      TO authenticated
      USING (true);
    $pol$;

    EXECUTE $pol$
      CREATE POLICY module_accept_handlers_modify_none ON public.module_accept_handlers
      FOR ALL
      TO authenticated
      USING (false)
      WITH CHECK (false);
    $pol$;

    REVOKE ALL ON public.module_accept_handlers FROM anon;
  END IF;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Seed the ESTATE `create_lease_application` handler — Piece B ships
--    one end-to-end proof of concept; the other 9 templates register
--    their handlers at runtime via the @borjie/module-templates
--    boot routine.
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO module_accept_handlers (
  id, module_template_id, action, payload_zod_jsonb, handler_module,
  allowed_persona_tiers, risk_tier, emits_money_mutation
)
VALUES (
  'mah_estate_create_lease_application',
  'ESTATE',
  'create_lease_application',
  '{
    "kind":"object",
    "fields":{
      "prospective_tenant":{"kind":"object","required":true},
      "unit_id":{"kind":"text","required":true},
      "desired_start_date":{"kind":"date","required":true},
      "monthly_rent":{"kind":"object","required":true},
      "proposed_term_months":{"kind":"int","required":true,"min":1,"max":120},
      "source":{"kind":"object","required":true}
    }
  }'::jsonb,
  '@borjie/module-templates/estate/handlers/create_lease_application',
  ARRAY[1, 2, 3]::SMALLINT[],
  'HIGH',
  TRUE
)
ON CONFLICT (module_template_id, action) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Documentation.
-- ─────────────────────────────────────────────────────────────────────────

COMMENT ON TABLE module_accept_handlers IS
  'Piece B registry of accept_proposal handlers. Executor uses this to '
  'dispatch a module_update_proposals row to module-template code with '
  'payload-Zod validation, tier checks, risk classification, and money-'
  'mutation flagging.';

COMMENT ON COLUMN module_accept_handlers.payload_zod_jsonb IS
  'Serialised Zod-schema tree (kind | fields | required | constraints). '
  'Reconstructed to a runtime z.object(...) by the executor before '
  'parsing the proposal payload.';

COMMENT ON COLUMN module_accept_handlers.allowed_persona_tiers IS
  'Subset of {1,2,3,4,5}. Executor REFUSES the call if the proposing '
  'user''s power tier is not in this array.';

COMMENT ON COLUMN module_accept_handlers.risk_tier IS
  'LOW / MEDIUM / HIGH / SOVEREIGN — drives policy-gate / four-eye / '
  'kill-switch checks. HIGH and SOVEREIGN are NEVER eligible for '
  'auto-accept (Rung 5 autonomy caps it explicitly).';

COMMENT ON COLUMN module_accept_handlers.emits_money_mutation IS
  'TRUE iff the handler''s execution path goes through LedgerService.post(). '
  'Used by audit + observability to assert money-path discipline.';
