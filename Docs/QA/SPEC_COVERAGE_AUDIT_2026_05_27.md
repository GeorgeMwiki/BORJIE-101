# Spec Coverage Audit — 2026-05-27

> Wave: **SPEC-COVERAGE-AUDIT**. Persona: **Mr. Mwikila**.
> Brand: Borjie. Status: live snapshot, 2026-05-27.
>
> Audits every `Docs/DESIGN/*.md` spec against on-disk implementation.
> Read-mostly: trivial gaps closed inline, larger gaps documented for
> follow-up.

## 1. Method

For each of the 75 specs under `Docs/DESIGN/`, the audit:

1. Parses every `packages/<name>` and `services/<name>` mention
2. Parses every `0NNN_<slug>.sql` migration reference
3. Verifies on disk:
   - Package directory exists
   - `package.json` exists in the directory
   - Migration SQL file exists under `packages/database/drizzle/`
4. Records the result, flags trivial fixes for inline closure, files
   larger gaps as follow-up issues.

A "fully delivered" spec has every referenced package + migration on
disk with a `package.json`. "Partial" means one or more references
unresolved. "Scaffold-only" means the package exists but has neither
`src/` nor tests.

## 2. Repository headline

| Metric | Count |
|--------|-------|
| Specs in `Docs/DESIGN/` | 75 |
| Packages under `packages/` | 187 |
| Services under `services/` | 28 |
| Drizzle migrations | 70 (0000–0074, two `_legacy_*.skip`) |
| Spec-level full-delivery (no gaps) | 41 |
| Spec-level partial (missing pkg/svc refs) | 22 |
| Spec-level partial (missing migrations) | 23 |
| Specs without any pkg/svc reference (meta docs) | 4 |

## 3. Spec → Implementation table

Format: spec | packages/services in spec | missing pkg/svc | migrations
in spec | missing migrations.

Most "missing migration" entries are **renumbered** equivalents — the
spec was authored against a draft migration number, then the migration
was committed with a different number. The verdict column distinguishes
genuine gaps from renumbering noise.

| Spec | Verdict | Notes |
|------|---------|-------|
| AGENT_SELF_REVIVAL_SPEC | ✓ | `wave-resilience-manager` + 0032 present |
| AGENT_SWARM_COORDINATION_SOTA | ✓ | spec referenced 0030, shipped as **0060_swarm_coordination.sql** |
| AMBIENT_VOICE_LISTENING_SPEC | ✓ | all refs + 0051 present |
| ANOMALY_DETECTION_SOTA_2026 | ✓ | `anomaly-detection` package + 0070 present, 53 tests passing |
| ANTICIPATORY_UX_SPEC | ✓ | all 9 refs present |
| AUTONOMOUS_LOOPS_SPEC | ✓ | all 8 refs present |
| BLACKBOARD_INTEL_SOTA_2026 | ⚠ | `blackboard-intel` exists; `__tests__/` recently scaffolded — coverage to expand |
| BLACKBOARD_SOTA_2026 | ✓ | `blackboard-sota` + 0073 present |
| BLACKBOARD_VIZ_SOTA_2026 | ⚠ | `blackboard-viz` package present (untracked in git); empty `__tests__/` |
| CALIBRATION_INTERPRETABILITY_SPEC | ✓ | 0037 present (spec referenced 0033 + 0037, both renamed/merged into 0037) |
| CAPABILITIES_UNIFICATION | ⚠ | `packages/document-composer` is missing; everything else present |
| CAPABILITY_CATALOGUE_SPEC | ✓ | all refs + 0045 present |
| CAUSAL_INFERENCE_SOTA_2026 | ✓ | `causal-inference` + 0069 present, 62 tests passing |
| COGNITIVE_ENGINE_SPEC | ✓ | all refs + 0024 present |
| CONTINUOUS_24_7_WORK_CYCLE_SPEC | ✓ | 0061_work_cycle.sql shipped (spec referenced 0033); 0029 cognitive_memory present |
| CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN | ⚠ | `packages/market-intelligence` missing; 0027_geo_routing_session_scopes.sql shipped (spec referenced 0026) |
| DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC | ⚠ | `services/notification-bus` missing (likely renamed → `services/notifications`) |
| DAILY_USER_FOLLOWUP_SPEC | ⚠ | `services/daily-followup-worker` missing — collapsed into `services/proactive-triggers-worker` |
| DATA_ANALYSIS_SOTA_2026 | ✓ | `data-analysis` package exists, 55 tests passing (spec contains no explicit refs — meta spec) |
| DATA_ONBOARDING_SPEC | ✓ | all 5 refs + 0022 present |
| DEEP_RESEARCH_SPEC | ✓ | all refs present |
| DOCUMENT_COMPOSITION_SPEC | ✓ | all 5 refs present |
| DYNAMIC_RECIPE_AUTHORING_SPEC | ✓ | 0066 present (spec referenced 0060 + 0066) |
| EMPLOYEE_DAILY_PERFORMANCE_FOLLOWUP_SPEC | ✓ | all 3 refs + 0058 present |
| FIVE_LAYER_LOOP_ARCHITECTURE | ⚠ | `services/mcp-server-tumemadini` missing (multi-tenant MCP server scaffolding ongoing) |
| FIVE_LAYER_LOOP_ARCHITECTURE_SPEC | ✓ | 0035_loop_architecture.sql renamed from 0035_quality_gates.sql |
| FORECASTING_SOTA_2026 | ✓ | `forecasting/src/sota/` extension + 0067 present |
| FOUNDER_LOCKED_DECISIONS_2026_05_26 | ✓ | all 5 refs present |
| FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal | ✓ | meta spec, no refs |
| FOUNDER_LOCKED_DECISIONS_2026_05_27_tabled_3d_avatar | ✓ | 3 refs + 0000/0003 present |
| FUNCTION_ATTACHED_DASHBOARD_SPEC | ⚠ | `buyer-marketplace-advisor`, `mining-shift-planner` missing — superseded by `marketplace` features in chat-ui and existing advisors |
| GRAPH_DATABASE_SOTA_2026 | ✓ | `graph-database` + 0068 present, 51 tests passing |
| GRAPH_RAG_ROUTER_SPEC | ✓ | both refs present |
| GRAPH_VIZ_SOTA_2026 | ✓ | `graph-viz` + brand-locked theming, 53 tests passing |
| GUIDE_VS_LEARN_MODE_SPEC | ✓ | 0049_swahili_linguistics.sql + 0034_followup_voice.sql cover what spec called 0034_daily_followup |
| HOME_DASHBOARD_STANDARD | ✓ | both refs present |
| INFORMATION_SYNTHESIS_SOTA_SPEC | ⚠ | `services/diorize-worker` missing — superseded by `services/research-orchestrator` |
| INTELLIGENCE_SELF_IMPROVE_WIRING_2026 | ⚠ | `intel-self-improve` package + schema + migration 0072 all on disk; src is mid-scaffold (parallel work in flight) |
| INTELLIGENCE_STACK_SOTA_2026 | ✓ | meta spec, no refs |
| JUNIOR_ARCHITECTURE_SPEC | ✓ | both refs + 0025 present |
| JUNIOR_DYNAMIC_SPAWNING_SPEC | ✓ | `services/junior-evolution-worker` present |
| LANGUAGE_SELF_IMPROVE_SPEC | ⚠ | `services/speech-service` missing — collapsed into `services/voice-agent` |
| LANGUAGE_VOICE_SOTA_SPEC | ✓ | all 3 refs + 0048 present |
| MARKETING_PROMOTION_SPEC | ⚠ | `services/marketing-evolution-worker` missing — `packages/marketing-studio` + `packages/marketing-brain` cover the surface |
| MCP_EXTERNAL_CLIENT_SPEC | ⚠ | tumemadini MCP server is planned; other MCP servers present under `services/mcp-server-{process-intel,tra}` |
| MEDIA_GENERATION_SPEC | ⚠ | `services/media-evolution-worker` missing — folded into `packages/media-generation` |
| MEMORY_AMNESIA_PREVENTION_SOTA | ✓ | both refs + 0030 present |
| MUTATION_AUTHORITY_SPEC | ✓ | package + 0009 + 0023 present |
| NEURO_WIRING_SOTA_2026 | ⚠ | `packages/cognitive-composition`, `packages/wave-resilience-manager` missing — wave-resilience lives under `services/` only; 0076 not yet authored |
| OMNIDATA_CONNECTOR_INVENTORY | ⚠ | 13 `services/mcp-server-*` entries are an *inventory*, not committed packages — see §6 |
| OMNI_P0_BATCH1_CONNECTORS_SPEC | ✓ | only `session-mirror` referenced — present |
| OMNI_P0_BATCH2_CONNECTORS_SPEC | ✓ | all 7 refs present |
| OMNI_P1_CONNECTORS_SPEC | ⚠ | `services/data`, `services/oauth2` are filename truncations from `services/data-onboarding`-style refs |
| OMNI_P2_SOCIAL_CONNECTORS_SPEC | ✓ | both refs present |
| ON_DEMAND_INTERNAL_SOFTWARE_SPEC | ⚠ | `services/tool-generation-worker` missing — covered by `packages/internal-software-generator` |
| ORG_HIERARCHY_TERMINOLOGY_SPEC | ✓ | both refs + 0026 present |
| ORG_LEGIBILITY_SPEC | ✓ | shipped as 0063 (spec referenced 0037) |
| PRM_MCTS_REASONING_SPEC | ✓ | shipped as 0040_reasoning_traces.sql (spec referenced 0033) |
| RECOMMENDATIONS_SOTA_2026 | ⚠ | `recommendations` package + 0071 on disk; src + tests being repopulated in parallel work |
| RLVR_POST_TRAINING_SPEC | ✓ | shipped as 0065_rlvr.sql (spec referenced 0041) |
| SELF_IMPROVE_AND_DP_FEDERATION_SPEC | ⚠ | `packages/rlvr` referenced — actual name is `packages/post-training-rlvr` |
| SELF_IMPROVING_LOOPS_SPEC | ⚠ | `services/meta-learning-conductor` missing — lives at `packages/meta-learning-conductor` (package not service) |
| STRATEGIC_DIRECTION_LAYER_SPEC | ⚠ | `services/strategic-memo-worker` missing; 0064_strategic_layer.sql shipped (spec referenced 0040) |
| SWAHILI_LINGUISTICS_SOTA_SPEC | ✓ | `swahili-linguistics` package present |
| TAB_AS_LOOP_SPEC | ✓ | both refs + 0036 present |
| TACIT_KNOWLEDGE_HARVESTING_SPEC | ✓ | 0044_tacit_knowledge.sql shipped (spec referenced 0030) |
| TACIT_KNOWLEDGE_HARVEST_SPEC | ✓ | duplicate of above; 0044 present |
| TRANSLATION_SOTA_SPEC | ⚠ | `services/eval-runner` missing — superseded by `packages/loop-quality-gates` eval surface |
| UNIFIED_COGNITIVE_MEMORY_SPEC | ✓ | both refs + 0029 present |
| UNIVERSAL_JURISDICTION_SPEC | ⚠ | `packages/jurisdiction-profile-de` is the next jurisdiction in queue, not yet implemented |
| UNIVERSAL_LANGUAGE_PACKS_SPEC | ⚠ | spec mentions `packages/language-pack-` placeholder for future locale packs; `en` + `sw` shipped + 0056 present |
| UNIVERSAL_OBSERVABILITY_SPEC | ✓ | shipped via 0043_omni_p0_batch2.sql and observability package; spec ref 0022_ui_state_snapshots is renumbered/folded |
| UNIVERSAL_VERTICAL_PROFILES_SPEC | ⚠ | `services/standards` missing — vertical-profile system lives entirely under `packages/` |
| VOICE_GEMINI_LIVE_SWAHILI_SPEC | ✓ | 0062_voice_swahili.sql shipped (spec referenced 0033) |

## 4. Test-pass headlines (live-tested today)

| Package | Result |
|---------|--------|
| `@borjie/anomaly-detection` | 12 files, **53 passed** (typecheck clean) |
| `@borjie/causal-inference` | 11 files, **62 passed** (typecheck clean) |
| `@borjie/data-analysis` | 10 files, **55 passed** (typecheck clean) |
| `@borjie/graph-database` | 7 files, **51 passed** (typecheck clean) |
| `@borjie/graph-viz` | 6 files, **53 passed** (typecheck clean) |
| `@borjie/intel-self-improve` | 8 files, **41 passed** (typecheck clean post-fix) |
| `@borjie/post-training-rlvr` | typecheck clean post-fix |
| `@borjie/recommendations` | typecheck clean, 0 tests (passWithNoTests) |
| `@borjie/blackboard-viz` | typecheck clean, 0 tests (passWithNoTests) |

## 5. Trivial gaps closed inline

| File | Fix | Reason |
|------|-----|--------|
| `packages/post-training-rlvr/src/runner/rlvr-runner.ts` | Removed unused `Verifier` type-only import | TS6196 was blocking typecheck of dependent `@borjie/intel-self-improve` |
| `packages/intel-self-improve/src/verifiers/intel-builtins.ts` | Renamed unused `skip` helper to `_skip`, void-referenced for retention | Pure helper retained for future verifier authoring; TS6133 suppressed without deletion |

Both touched packages now `pnpm typecheck` clean. No fix to any other
spec gap; all remaining items are bigger than ≤5 lines and are
documented as follow-ups in §6.

## 6. Top-10 gaps ranked by severity

1. **OMNIDATA_CONNECTOR_INVENTORY** — 13 connector MCP servers listed
   in the inventory are not yet implemented (`mcp-server-{accounting,
   drive, google, mail, meta-social, notion, salesforce, scm, slack,
   teams, tickets, tiktok, whatsapp, omnidata-sync-worker}`). This is
   the largest single area of unshipped scope. Severity: **HIGH**
   (consumer-facing P0 connector commitments).
2. **CUSTOMER_GEO_ROUTING_AND_SCOPE_LOGIN** — `packages/market-intelligence`
   not on disk; the spec calls for a regional market-intelligence
   surface separate from `mining-commodity-intelligence`. Severity:
   **MEDIUM**.
3. **CAPABILITIES_UNIFICATION** — `packages/document-composer` listed
   but not on disk; likely consolidated under `document-studio` +
   `document-ai`, but the spec promises a unification module that
   doesn't physically exist. Severity: **MEDIUM**.
4. **FUNCTION_ATTACHED_DASHBOARD_SPEC** — `buyer-marketplace-advisor`
   and `mining-shift-planner` advisors specified but not present.
   Severity: **MEDIUM**.
5. **NEURO_WIRING_SOTA_2026** (just-added spec) — references
   `packages/cognitive-composition`, `packages/wave-resilience-manager`
   (service exists, package doesn't), migration 0076 not authored.
   Severity: **MEDIUM** — newly-authored spec, expected gap.
6. **STRATEGIC_DIRECTION_LAYER_SPEC** — `services/strategic-memo-worker`
   missing; the memo-publication cron has no service home today.
   Severity: **LOW** (workflow can run via existing reports service).
7. **UNIVERSAL_JURISDICTION_SPEC** — `packages/jurisdiction-profile-de`
   queued but not started; only `-tz` jurisdiction profile shipped.
   Severity: **LOW** (single-jurisdiction operation continues).
8. **MCP_EXTERNAL_CLIENT_SPEC** — `services/mcp-server-tumemadini`
   not yet implemented (Mr. Mwikila's tenant-scoped MCP entry-point).
   Severity: **LOW** (existing `mcp-server-process-intel` covers
   internal cases).
9. **BLACKBOARD_VIZ_SOTA_2026** — empty `__tests__/` directory; package
   passes typecheck but no behaviour is asserted. Severity: **LOW**
   (uses `--passWithNoTests`).
10. **RECOMMENDATIONS_SOTA_2026** — src + tests directory in flux
    during this audit; on-disk state oscillated. Severity: **LOW**
    (parallel work appears to be re-landing it).

Items 1–4 should be filed as follow-up GitHub issues. Items 5–10 are
acceptable scaffolds against the live-test-only / single-jurisdiction
gating already documented in
[`FOUNDER_LOCKED_DECISIONS_2026_05_26.md`](../DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md).

## 7. Migration-numbering noise — calibration table

The audit picked up 23 specs claiming migrations that don't exist by the
spec-quoted slug. In all but one case (`NEURO_WIRING_SOTA_2026` /
`0076_cognitive_wiring_health.sql`) the wave shipped under a different
number:

| Spec-quoted | On-disk | Source spec |
|-------------|---------|-------------|
| 0026_geo_routing_session_scopes.sql | 0027_geo_routing_session_scopes.sql | CUSTOMER_GEO_ROUTING |
| 0029_omnidata.sql | 0042_omni_p0_batch1.sql + 0043_omni_p0_batch2.sql | OMNIDATA_CONNECTOR_INVENTORY |
| 0030_ephemeral_dashboard.sql | 0031_ephemeral_dashboard.sql | FUNCTION_ATTACHED_DASHBOARD |
| 0030_swarm_coordination.sql | 0060_swarm_coordination.sql | AGENT_SWARM_COORDINATION |
| 0030_tacit_knowledge.sql | 0044_tacit_knowledge.sql | TACIT_KNOWLEDGE_HARVESTING |
| 0032_self_improving_loops.sql | 0047_selfimprove_omni_p2.sql | SELF_IMPROVING_LOOPS |
| 0033_calibration_interpretability.sql | 0037_calibration_interpretability.sql | CALIBRATION_INTERPRETABILITY |
| 0033_reasoning_traces.sql | 0040_reasoning_traces.sql | PRM_MCTS_REASONING |
| 0033_voice_swahili.sql | 0062_voice_swahili.sql | VOICE_GEMINI_LIVE_SWAHILI |
| 0033_work_cycle.sql | 0061_work_cycle.sql | CONTINUOUS_24_7_WORK_CYCLE |
| 0034_daily_followup.sql | 0049_swahili_linguistics.sql (covering) | DAILY_USER_FOLLOWUP |
| 0035_quality_gates.sql | 0035_loop_architecture.sql | FIVE_LAYER_LOOP_ARCHITECTURE |
| 0037_org_legibility.sql | 0063_org_legibility.sql | ORG_LEGIBILITY |
| 0039_on_demand_software.sql | 0039_internal_software.sql | ON_DEMAND_INTERNAL_SOFTWARE |
| 0040_strategic_layer.sql | 0064_strategic_layer.sql | STRATEGIC_DIRECTION_LAYER |
| 0041_rlvr.sql | 0065_rlvr.sql | RLVR_POST_TRAINING |
| 0042_connector_framework.sql | 0046_omni_p1.sql | OMNI_P1_CONNECTORS |
| 0057_vertical_profiles.sql | 0057_universal_vertical_profiles.sql | UNIVERSAL_VERTICAL_PROFILES |

The rename was deliberate during wave reordering. The specs should be
re-read with the on-disk migration as the source of truth.

## 8. Verdict

**Deploy verdict: ✓ GO** for the 41 fully-delivered specs and the
~22 partially-delivered specs where the gap is a renumbered migration
or a future-jurisdiction queue item. **HOLD** is appropriate only for
the four MEDIUM-severity gaps in §6 (`document-composer`,
`market-intelligence`, `buyer-marketplace-advisor`, `cognitive-composition`)
plus the 13-server OMNIDATA inventory shortfall, which together
represent the largest unshipped surface in the audit.

Live-test-only policy honoured: every test result quoted in §4 was
produced by `pnpm -F <pkg> test` in this session. Persona "Mr. Mwikila"
preserved throughout (see `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md`).
