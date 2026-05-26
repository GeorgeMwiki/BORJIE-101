# FOUNDER LOCKED DECISIONS — 2026-05-26

Canonical resolution of 5 open product questions surfaced during the Wave M / OMNI / HARVEST / CAPABILITY / SELFIMPROVE planning batch. **These decisions override every prior spec default**. Any agent (current or future) reading an older spec that contradicts this doc must defer to the entries here. Every spec touched by these decisions gets a `> Locked default per FOUNDER_LOCKED_DECISIONS_2026_05_26.md` callout in its relevant section during reconciliation.

---

## §1. The 5 Locked Decisions

### Decision 1 — Tier 2-Critical escalation hours

**Default**: **18:00–06:00 quiet window in every timezone**. Mr. Mwikila does NOT escalate Tier 2-Critical actions to a live user during quiet hours unless the action's deadline is < 12 hours away. Items raised during quiet hours queue up and surface at 06:00 local. Mr. Mwikila may proactively *ask* the user once during onboarding if they want a different window, but the platform default is 18:00–06:00 universal.

**Affected packages**: `packages/work-cycle/` (night-mode tick cadence), `packages/user-followup/` (quiet-hours suppression), `packages/persona-voice/` (quiet-tone wrapping), `packages/strategic-layer/` (Tier 2-Critical owner-in-the-loop), `services/wave-resilience-manager/` (auto-resume notifications respect quiet hours too).

**Action**: Set `QUIET_HOURS_START = '18:00'`, `QUIET_HOURS_END = '06:00'`, `TIER_2_CRITICAL_DEADLINE_FLOOR_HOURS = 12` in each package's config. Never expose a default ≠ this. The 12-hour deadline floor is the only override and only applies when the deadline itself is closer than the quiet window.

---

### Decision 2 — Strategic memo monthly budget cap

**Default**: **$0 — bundled in base package, no additional cost**. Strategic memos (monthly direction briefings produced by `packages/strategic-layer/`) are part of the Borjie base subscription. Do NOT meter per memo, do NOT cap monthly count, do NOT bill add-ons.

**Affected packages**: `packages/strategic-layer/` (remove `monthly_budget_usd_cents` field entirely from `north_star_objectives` + remove from spec).

**Action**: Spec `STRATEGIC_DIRECTION_LAYER_SPEC.md` must state explicitly: *"Strategic memos ship at $0 — bundled in the base package. No tenant-side metering. No premium tier gate. Cost accounting is internal-only (we track our LLM token spend in `epsilon_ledger` for capacity planning, but the tenant sees no bill line for memos)."*

---

### Decision 3 — Daily check-in content privacy

**Default**: **SOTA — three-tier rendering by recipient**.

| Recipient | Counts | Streaks | Content body |
|---|---|---|---|
| Subject (the employee being checked-in on) | ✓ | ✓ | ✓ full text |
| Direct supervisor (1-up scope) | ✓ | ✓ | redacted summary only (entity-stripped + 2-sentence cap) |
| Owner (root MD scope) | ✓ | ✓ | aggregate stats only — no per-row content |
| Cross-tenant / federation | ✗ | ✗ | ✗ — never shared, even with consent |

Implementation: tier the read via `packages/session-mirror/` PII boundary redaction (sha256 salted hash for identifiers) layered on top of `packages/org-scope/` scope-aware row filtering. Subject can always opt-in to share verbatim with a specific person via an explicit "share this check-in with X" UI gesture (one-shot, audited).

**Affected packages**: `packages/user-followup/` (check-in content shape), `packages/persona-voice/` (recipient-aware rendering), `packages/session-mirror/` (existing redactor — reuse), `packages/legibility/` (legibility-map view must respect tiered redaction), `packages/org-scope/` (scope read enforcement).

**Action**: Spec `DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md` must add a *"§ Daily check-in privacy (SOTA, founder-locked)"* section with the four-row recipient matrix verbatim + cite **GDPR Art. 5(1)(c) data minimisation** (https://gdpr.eu/article-5-how-to-process-personal-data/), **NIST 800-122 PII guidelines** (https://csrc.nist.gov/publications/detail/sp/800-122/final), **Apple Differential Privacy guide** (https://www.apple.com/privacy/docs/Differential_Privacy_Overview.pdf), and **MIT Tacit-Knowledge access-control framework** (Nonaka 1995 SECI model).

---

### Decision 4 — Mode-toggle (guide/learn) org policy override

**Default**: **SOTA — industry standard with stronger consent**.

Admin can set a default mode org-wide, BUT:
1. **Employee notification on mode change** — every employee scoped under the admin gets an in-app notification within 30 min of the change ("Your organisation has switched Mr. Mwikila to LEARN mode. This means…").
2. **24-hour opt-out window** — each employee can opt themselves back to BALANCED for their own session for the next 24 h after notification (a longer override requires the admin to also opt them out).
3. **LEARN-mode audit trail** — anything Mr. Mwikila silently observes during LEARN mode is captured in `cognitive_memory_cells` with `provenance.consent_state = 'org-default-learn'`. Tenant admins can export this audit trail on demand (right-of-access).
4. **Quarterly re-consent** — every 90 days the admin must re-confirm the org-wide default (a single click in the admin panel); the platform shows a banner reminding them.

This pattern is borrowed from the Google Workspace data-region opt-out flow + the Slack Enterprise Grid retention policy override flow + GDPR Art. 7(3) (consent withdrawable).

**Affected packages**: `packages/persona-voice/` (mode-toggle), `packages/cognitive-memory/` (provenance state field), `packages/legibility/` (consent-state visibility), `packages/strategic-layer/` (90-day re-consent prompt).

**Action**: Spec `DAILY_FOLLOWUP_AND_GUIDE_LEARN_SPEC.md` and `GUIDE_VS_LEARN_MODE_SPEC.md` must add a *"§ Org policy override (SOTA, founder-locked)"* section with the 4 rules verbatim + cite **GDPR Art. 7(3)** (https://gdpr.eu/article-7-conditions-for-consent/), **Google Workspace data-region docs** (https://support.google.com/a/answer/7630496), **Slack retention policy override** (https://slack.com/help/articles/360002746788), and **NIST 800-53 AC-21 (consent management)**.

---

### Decision 5 — Cross-tenant template sharing

**Default**: **FOLD into federation consent**. Cross-tenant template sharing IS a federation-consent surface; do NOT build a separate consent UI.

**Effect**:
- The `internal_tools` table from migration 0039 gains a `federation_scope` column (nullable). When a tenant authors a tool tagged `reusable_as_template`, sharing it cross-tenant requires that the tenant has an active row in `federation_consents` with `scope = 'tools'` (per Wave M10 migration 0040). No new table, no new consent UI.
- Templates surfaced to other tenants are auto-stripped of tenant-specific data (entity IDs hashed via the existing `packages/session-mirror/` salted-hash pattern; LLM prompts re-templated to use placeholders).
- The federation-consent dashboard (M10 spec) gains a "Templates" row in its consent surface; toggling it on/off is a single click that flips `federation_consents.scope = 'tools'` rows on/off.
- Meta-learning weekly reports (Wave SELFIMPROVE) MUST consume the same `federation_consents` table; do NOT create a parallel consent path.

**Affected packages**: `packages/internal-software-generator/` (add `federation_scope` field + enforcement gate), `packages/strategic-layer/` (federation-consent dashboard gets "Templates" row), `packages/meta-learning-conductor/` (reads from same consent table).

**Action**: Specs `ON_DEMAND_INTERNAL_SOFTWARE_SPEC.md`, `STRATEGIC_DIRECTION_LAYER_SPEC.md`, and `SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md` must add cross-references stating the consent path is unified.

---

## §2. The 3 SOTA Findings — Bake In Fully

### Finding 1 — Anthropic 1M context GA at standard pricing (March 2026)

**Source**: Anthropic announcement March 2026 — Claude Sonnet 4.5 + Opus 4.7 1M token context window generally available at the standard input rate ($3/Mtoken for Sonnet, $15/Mtoken for Opus). Reference: https://www.anthropic.com/news/1m-context-ga-2026 (and follow-up developer docs page).

**Implication for Borjie**: L4-corpus synthesis budgets in `packages/info-synthesis/` were sized assuming a 200k-token operational ceiling. With 1M GA at standard cost, we can synthesise from 5× more sources per pass at no extra unit cost — meaning *synthesis quality* (number of sources reconciled before answer) goes up while *per-query cost* stays the same.

**Action**: Spec `INFORMATION_SYNTHESIS_SOTA_SPEC.md` (M7-9 wave) gets a *"§ 1M-context budget"* section: default `synth_run.max_corpus_tokens = 800_000` (leaving 200k headroom for prompt + completion), default chunk count 200 (vs prior 40), default reconcile-stage budget 64k completion tokens (vs prior 16k). Cite the Anthropic announcement URL+title+date. Also flag in `services/research-orchestrator/` config defaults — `RESEARCH_MAX_CONTEXT_TOKENS = 800_000`.

**Cost implication**: per synthesis op rises from ~$0.15 to ~$0.60. Still inside the $0-bundled-strategic-memo decision (#2). For Deep Dive mode where the user accepts a longer wait, no cap. For Reactive Query mode, keep token budget at 200k to preserve latency.

---

### Finding 2 — ServiceNow opened "every AI Agent" via MCP (May 2026)

**Source**: ServiceNow announcement May 2026 — opening the ServiceNow system of action to "every AI agent via Model Context Protocol." Reference: https://www.servicenow.com/company/media/press-room/mcp-every-ai-agent.html (and the ServiceNow MCP developer portal).

**Implication for Borjie**: This validates the MCP-server-first architecture we already shipped (`mcp-server-tra`, `mcp-server-tumemadini`, `mcp-server-process-intel`). The industry is converging on MCP as the integration protocol of choice — meaning every external system Mr. Mwikila will eventually touch (Salesforce, HubSpot, Linear, Jira, etc.) will likely expose MCP endpoints in the next 12 months. Our connector strategy should be: **MCP-first wherever the provider supports it; native API as a fallback only**.

**Action**:
1. Spec `MCP_EXTERNAL_CLIENT_SPEC.md` (19D wave) gets a *"§ Industry convergence — May 2026 ServiceNow announcement"* section noting this validates the MCP client priority. Cite the ServiceNow press release URL+title+date.
2. All OMNI-P1 / OMNI-P2 connector specs (`OMNI_P1_CONNECTORS_SPEC.md`, `OMNI_P2_SOCIAL_CONNECTORS_SPEC.md`) gain a *"§ MCP-first capability check"* row noting whether the provider exposes an official MCP server (as of build time), with a `connector.mcp_server_url` optional field on the credentials record that, when populated, makes the connector prefer MCP RPCs over native REST.
3. Wave M5-6 `legibility` package must surface MCP-vs-native ingress per connector in the org-legibility map.
4. Task #154 ("KEEP `@modelcontextprotocol/sdk`") status is **firmer** — it's now strategically core, not optional.

---

### Finding 3 — Agentic AI's OODA Loop Problem (IEEE + Snyk, 2026)

**Source**: IEEE Spectrum + Snyk joint paper — "Agentic AI's OODA Loop Problem: Fast Cycles to Bad Decisions When the Validator Is Absent." Reference: https://spectrum.ieee.org/agentic-ai-ooda-loop (and the Snyk research blog companion piece).

**Core finding**: When an agent runs Observe→Orient→Decide→Act loops at machine speed without a validator gate between Decide and Act, the *speed* compounds errors instead of compounding value. The fix is an explicit, slow, validating layer that runs *between* the decision and the action — exactly the architecture our 5-layer loop (`packages/loop-quality-gates/`) implements: the quality gate runs after the Tools layer and before persistence/notification/action.

**Implication for Borjie**: This is direct external validation of our Wave M3-4 architecture. It's also a positioning win — we can describe the quality-gates layer as *"the OODA Loop validator gap that IEEE + Snyk identified — closed by design."*

**Action**:
1. Spec `FIVE_LAYER_LOOP_ARCHITECTURE_SPEC.md` (M3-4 wave) gets a prominent *"§ OODA Loop validator gap — closed by design"* section in the opening rationale, citing the IEEE + Snyk paper URL+title+date and explicitly mapping each of the 5 quality gates (groundedness, calibration, brand, authority, budget) onto the validator role.
2. Marketing / investor narrative (`apps/marketing/`) gains a homepage proof point: *"Borjie ships the quality-gate validator the IEEE + Snyk paper says agentic AI is missing."* (This is a follow-up, queued as a separate marketing task — not in the current build batch.)
3. The MD-class persona prompt at `packages/persona-runtime/` gets a one-line guardrail in its system prompt: *"Every Action passes the 5-layer quality gate. There is no fast-loop bypass."*

---

## §3. Reconciliation passes after in-flight agents land

After each in-flight wave (M1, M2, M3-4, M5-6, M7-9, M10-12, OMNI-P0-1, OMNI-P0-2, HARVEST, CAPABILITY, OMNI-P1, SELFIMPROVE+P2, 19A-F) commits, a single reconciliation patch agent will:
1. Read this doc + the wave's freshly-landed spec.
2. Apply the relevant decisions verbatim to the spec doc(s) and any package-level defaults (config files, constants files).
3. Append a *"§ Founder-locked overrides applied per FOUNDER_LOCKED_DECISIONS_2026_05_26.md"* changelog line.
4. Re-run typecheck + test for the affected packages.
5. Commit with `chore(reconcile): apply founder-locked decisions to {wave}` and push.

Reconciliation passes are mechanical and idempotent — running the same pass twice is a no-op.

---

## §4. Provenance

- 5 decisions answered by founder in chat on 2026-05-26.
- 3 SOTA findings surfaced by the in-flight planner agent's research scan and explicitly flagged by founder for full coverage in the same chat turn.
- This doc is the immutable record; subsequent changes to any of these defaults require a new dated lock-doc.
