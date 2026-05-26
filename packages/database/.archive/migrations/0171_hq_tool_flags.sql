-- =============================================================================
-- 0171: HQ-tool feature flags — DA3 catalogue-publish filter (default-DISABLED)
-- =============================================================================
-- Seeds one feature-flag row per NOT_YET_WIRED HQ tool. The api-gateway
-- composition root (services/api-gateway/src/composition/hq-tool-registry.ts:
-- `computeFlagDisabledTools`) reads these flags at catalogue-publish time
-- and OMITS the tool from the brain's published catalogue when the flag
-- resolves to FALSE.
--
-- Why DEFAULT FALSE
-- ─────────────────
-- DA3 audit found that the 5 sovereign HQ tools below appear in the LLM's
-- tool list even when their underlying connectors / Temporal dispatchers
-- are not yet wired in production. The brain wastes turns proposing them;
-- only the runtime call refuses. With these flags off-by-default, the
-- catalogue publisher hides each tool until an operator flips the global
-- value (or a per-tenant override) once the connector / dispatcher lands.
--
-- The per-spec source of truth lives in each `platform.*.ts` file's
-- `HqToolSpec.featureFlag` field and the static
-- `HQ_TOOL_FEATURE_FLAGS` map (packages/central-intelligence/src/kernel/
-- tool-spec/hq-tools/index.ts). The two MUST agree.
--
-- Idempotent: re-running the migration is safe (`ON CONFLICT (flag_key)
-- DO NOTHING`).
-- =============================================================================

INSERT INTO feature_flags (id, flag_key, description, default_enabled)
VALUES
  ('ff_hq_tool_eviction_dispatcher',
   'hq_tool.eviction_dispatcher.enabled',
   'DA3 catalogue-publish gate for platform.evict_tenant. '
   'Default OFF until the eviction Temporal dispatcher is wired in production. '
   'When OFF, the brain catalogue OMITS the tool so the LLM does not '
   'propose calls the runtime would refuse (NOT_YET_WIRED_REASON.EVICTION_DISPATCHER). '
   'Flip ON globally or per-tenant once temporal-dispatcher-wiring.ts threads '
   'a real evictionDispatcher.',
   FALSE),
  ('ff_hq_tool_owner_payout_dispatcher',
   'hq_tool.owner_payout_dispatcher.enabled',
   'DA3 catalogue-publish gate for platform.payout_owner. '
   'Default OFF until the owner-payout Temporal dispatcher is wired in production. '
   'See NOT_YET_WIRED_REASON.OWNER_PAYOUT_DISPATCHER.',
   FALSE),
  ('ff_hq_tool_kra_mri_dispatcher',
   'hq_tool.kra_mri_dispatcher.enabled',
   'DA3 catalogue-publish gate for platform.file_kra_mri. '
   'Default OFF until the KRA-MRI Temporal dispatcher is wired in production. '
   'See NOT_YET_WIRED_REASON.KRA_MRI_DISPATCHER.',
   FALSE),
  ('ff_hq_tool_nida',
   'hq_tool.nida.enabled',
   'DA3 catalogue-publish gate for platform.verify_nida. '
   'Default OFF until the NIDA biometric gateway adapter is wired in production. '
   'See NOT_YET_WIRED_REASON.NIDA_PORT.',
   FALSE),
  ('ff_hq_tool_eardhi',
   'hq_tool.eardhi.enabled',
   'DA3 catalogue-publish gate for platform.verify_eardhi_title. '
   'Default OFF until the e-Ardhi land-registry gateway adapter is wired in production. '
   'See NOT_YET_WIRED_REASON.EARDHI_PORT.',
   FALSE)
ON CONFLICT (flag_key) DO NOTHING;
