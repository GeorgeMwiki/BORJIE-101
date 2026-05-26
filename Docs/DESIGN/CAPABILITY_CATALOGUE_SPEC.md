# Capability Catalogue + Measurement — Design Specification

> Wave: **CAPABILITY** (Capability Catalogue + Measurement).
> Persona: **Mr. Mwikila** — Borjie's autonomous Managing Director for
> Tanzanian mining operators.
> Companion package: `@borjie/capability-catalogue`.
> Companion service: `@borjie/capability-measurement-worker`.
> Companion migration: `0045_capability_catalogue.sql`.
> Companion drizzle schema: `packages/database/src/schemas/capability-catalogue.schema.ts`.
> Sibling specs: [`COGNITIVE_ENGINE_SPEC.md`](./COGNITIVE_ENGINE_SPEC.md),
> [`CALIBRATION_INTERPRETABILITY_SPEC.md`](./CALIBRATION_INTERPRETABILITY_SPEC.md),
> [`DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md),
> [`SELF_IMPROVING_LOOPS_SPEC.md`](./SELF_IMPROVING_LOOPS_SPEC.md),
> [`JUNIOR_DYNAMIC_SPAWNING_SPEC.md`](./JUNIOR_DYNAMIC_SPAWNING_SPEC.md).

---

## 1. Why this exists

Mr. Mwikila has many things he can do — research a buyer, compose a
royalty filing tab, draft a board pack, produce a regulator-ready
PDF, generate a media artefact, run a hedging campaign. Each of
those is a *capability*. As the platform grows, junior agents spawn
new capabilities at runtime; tenants author tenant-specific
capabilities; the meta-dispatcher composes existing capabilities
into new ones. Without a single, authoritative, versioned, measured
registry, the surface area becomes opaque, governance impossible,
and self-improvement loops have nothing to optimise.

This document specifies the **Capability Catalogue**: the canonical
registry of every capability the platform exposes, the lifecycle
state machine that gates promotion of new capabilities into
production, and the **Measurement Worker** that scores every
capability on three independent axes — **competence**,
**calibration**, **utility** — over rolling windows. Together they
form the operational substrate for evolution: any capability that
fails its thresholds is demoted; any capability that exceeds them
is promoted; any composite capability whose dependencies regress is
auto-flagged.

The thesis: *capabilities are first-class objects, versioned and
measurable, not implementation details*. This mirrors how
[OpenAI Evals (GitHub openai/evals, 2024-)](https://github.com/openai/evals),
[Anthropic Model Cards (e.g. Claude 4.6 Model Card, October 2025)](https://www.anthropic.com/news/claude-3-5-sonnet),
[RAGAS — Retrieval Augmented Generation Assessment (Es et al., 2023; ragas.io)](https://github.com/explodinggradients/ragas),
[ARC-AGI benchmark (Chollet et al., 2024)](https://arcprize.org/),
[AgentBench (Liu et al., ICLR 2024)](https://arxiv.org/abs/2308.03688),
and [LangSmith Evaluations (LangChain, 2024)](https://docs.smith.langchain.com/evaluation)
treat capabilities — not models — as the unit of measurement. We
adopt the same primitive but bind it to lifecycle promotion gates
so the catalogue is not merely descriptive but operationally load-
bearing.

---

## 2. Catalogue shape

Every capability is a typed, versioned record. The Drizzle schema
under `capability-catalogue.schema.ts` and migration 0045 mirror
the TypeScript surface exposed by `@borjie/capability-catalogue/src/types.ts`.

```ts
export type CapabilityKind = 'atomic' | 'meta' | 'tenant';

export type Lifecycle =
  | 'draft'        // authored, not yet exercised
  | 'shadow'       // runs in parallel; output discarded
  | 'live'         // serves production traffic
  | 'locked'       // promotion frozen pending review
  | 'deprecated';  // removed from dispatch; historical only

export type ProvenanceClass = 'seed' | 'spawned' | 'tenant_authored';

export interface Capability {
  readonly id: string;                          // UUID v4
  readonly tenant_id: string | null;            // null = platform-wide seed
  readonly name: string;                        // e.g. 'research_v1'
  readonly version: string;                     // semver-ish, e.g. '1.0.0'
  readonly kind: CapabilityKind;
  readonly owner: string;                       // 'platform' | 'tenant:<id>'
  readonly lifecycle_state: Lifecycle;
  readonly dependencies: ReadonlyArray<string>; // other capability ids
  readonly contract: CapabilityContract;        // zod-validated shape
  readonly provenance_class: ProvenanceClass;
  readonly created_at: string;                  // ISO 8601 UTC
  readonly audit_hash: string;
  readonly prev_hash: string | null;
}

export interface CapabilityContract {
  readonly inputSchema: unknown;                // zod JSON repr
  readonly outputSchema: unknown;
  readonly costClass: 'free' | 'tier_1' | 'tier_2' | 'tier_3';
  readonly latencyBudgetMs: number;
}
```

The catalogue invariant: `(tenant_id, name, version)` is unique. A
seed capability (`tenant_id = null`) is platform-wide; a tenant
capability is private to the tenant. Versioning is monotonic; a
new version is a new row, never an in-place edit. Mutations append
to the per-tenant audit chain — `audit_hash` and `prev_hash`
provide tamper evidence equivalent to [Certificate Transparency's
Merkle log](https://transparency.dev) and the existing Borjie
`ai_audit_chain` table (see migration 0003).

---

## 3. The five atomic capabilities

The platform ships five seed atomic capabilities. Each is a leaf
node — its dependencies array is empty — and each maps to one
underlying engine in the existing repo.

### 3.1 `research_v1`

- **What:** answer a question by retrieving + grounding evidence.
- **Engine:** `services/research-orchestrator` (Reactive Query mode).
- **Input contract:** `{ query: string, mode?: 'reactive'|'anticipatory'|'briefing'|'deep'|'watch', maxCostCents?: number }`.
- **Output contract:** `{ answer: string, citations: SpanCitation[], confidence: 'high'|'medium'|'low'|'refused' }`.
- **Cost class:** `tier_1` (default <$0.10).
- **Latency budget:** 8 000 ms (P95).

### 3.2 `compose_tab_v1`

- **What:** compose a function-attached dashboard tab.
- **Engine:** `packages/ephemeral-ui`.
- **Input contract:** `{ intent: string, dataJoinRefs: DataJoinRef[], replayKey?: string }`.
- **Output contract:** `{ tabRecipe: TabRecipe, replayKey: string }`.
- **Cost class:** `tier_1`. **Latency:** 6 000 ms P95.

### 3.3 `compose_doc_v1`

- **What:** compose a structured document (PDF/DOCX).
- **Engine:** `services/document-intelligence` + `packages/document-analysis`.
- **Input contract:** `{ templateKind: 'tumemadini'|'board_pack'|'royalty'|..., scope: ScopeRef, format: 'pdf'|'docx' }`.
- **Output contract:** `{ storageKey: string, sha256: string, citations: SpanCitation[] }`.
- **Cost class:** `tier_2`. **Latency:** 30 000 ms P95.

### 3.4 `compose_media_v1`

- **What:** generate marketing/operational media artefacts.
- **Engine:** `packages/content-studio` + media-generation modules.
- **Input contract:** `{ brief: string, channel: 'whatsapp'|'sms'|'social'|'print', constraints?: MediaConstraints }`.
- **Output contract:** `{ assetRefs: AssetRef[], approvedForChannel: boolean }`.
- **Cost class:** `tier_2`. **Latency:** 45 000 ms P95.

### 3.5 `compose_campaign_v1`

- **What:** compose + schedule a multi-step outreach campaign.
- **Engine:** `packages/marketing-brain`.
- **Input contract:** `{ objective: string, audience: AudienceFilter, channelMix: ChannelMix, scheduleWindow: { from, to } }`.
- **Output contract:** `{ campaignId: string, steps: CampaignStep[], expectedReach: number }`.
- **Cost class:** `tier_3`. **Latency:** 60 000 ms P95.

Each ships in `src/seeds/atomic-capabilities.ts` with a full
zod-encoded contract.

---

## 4. The meta-dispatcher: `compose_anything_v1`

Beyond the atomic five, Mr. Mwikila exposes a **meta-capability**
that accepts a free-form user intent and dispatches to the right
atomic capability (or composes several). Conceptually this is the
[ReAct-style dispatcher (Yao et al., 2023)](https://arxiv.org/abs/2210.03629)
augmented with the [Toolformer pattern (Schick et al., 2023)](https://arxiv.org/abs/2302.04761)
and our cognitive-engine's grounding discipline.

```ts
compose_anything_v1({
  intent: "Draft this month's Tumemadini return and brief the owner",
  scope: { siteId, accountingMonth },
})
```

The dispatcher must:

1. Resolve the *intent class* (research / tab / doc / media / campaign / composite).
2. Plan a DAG of atomic-capability invocations. The DAG nodes are
   `Capability` ids; the edges are data dependencies.
3. Invoke each atomic capability through its contract.
4. Aggregate outputs and emit a single `CompositeResult`.
5. Forward every step's invocation + outcome to the measurement
   stream so the meta-capability's own competence/calibration/utility
   are measurable end-to-end.

The dispatcher's `dependencies` array contains the five atomic
capability ids. A composite plan that calls undeclared capabilities
fails the contract.

---

## 5. The three measurement axes

The measurement worker computes three independent scalars per
capability per rolling window. All three are bounded in `[0, 1]`
and aggregate over `n_observations`.

### 5.1 Competence — does it succeed?

```
competence_rate = successes / invocations
```

where `success = true` iff the invocation returned without throwing
*and* the outcome resolver did not stamp `disconfirmed`. This is
the operational success rate familiar from [SRE error-budget
practice (Google SRE Workbook, 2018)](https://sre.google/workbook/error-budget-policy/)
and [OpenAI Evals' pass-rate metric](https://github.com/openai/evals).

### 5.2 Calibration — is its claimed confidence right?

The capability stamps a `claimed_confidence` (`[0, 1]`) at output
time. The outcome resolver later records the `observed_outcome`
(`confirmed | disconfirmed | partial | unknown`). We translate
`observed_outcome` to a `[0, 1]` truth value (`confirmed → 1`,
`disconfirmed → 0`, `partial → 0.5`, `unknown → drop`) and compute
the [Brier score (Brier, 1950)](https://journals.ametsoc.org/view/journals/mwre/78/1/1520-0493_1950_078_0001_vofeit_2_0_co_2.xml)
plus the [Expected Calibration Error (Guo et al., 2017)](https://arxiv.org/abs/1706.04599):

```
brier(p, y) = (p - y)²
ECE         = Σ (|bin_i| / N) · |conf_bin_i - acc_bin_i|
```

We report `calibration_error` as the equally-weighted mean of
normalised Brier (range-mapped to `[0, 1]` with `0 = perfect`) and
ECE with 10 bins. Same definitions as
`@borjie/calibration-monitor`'s primitives — we re-use those modules.

### 5.3 Utility — do users follow through with the output?

```
utility_rate = (accepted + 0.5 · modified) / (accepted + modified + rejected + ignored)
```

This is the operational analogue of [LangSmith's "feedback runs"
(LangChain Docs, 2024)](https://docs.smith.langchain.com/evaluation/concepts/#feedback)
and the [Anthropic Evals harness (`anthropic/evals` GitHub, 2024)](https://github.com/anthropics/evals).
A capability whose output is technically correct but ignored has
zero economic value. We collapse the four followthrough states into
a single scalar, weighting `modified` at 0.5 because a modified
output still saved the user the cold-start cost.

### 5.4 Windowed aggregation

The worker computes (competence, calibration, utility) for each
of three windows — **7 d / 28 d / 91 d** — to capture both
short-term regression detection (7 d) and long-term ground truth
(91 d). The window choice mirrors `@borjie/calibration-monitor`'s
weekly report cadence and the [ARC-AGI rolling leaderboard's
multi-window evaluation pattern (arcprize.org, 2024)](https://arcprize.org/).

`n_observations < 30` flags the measurement as *low-confidence*;
the lifecycle manager will not promote on low-confidence data.

---

## 6. Lifecycle promotion rules

The lifecycle state machine is the operational gate between
"someone authored this" and "production traffic flows here". A
capability moves between states only when the measurement worker
posts a verdict.

```
draft → shadow      manual or spawned-by-junior
shadow → live       7d:competence ≥ 0.85 AND calibration_error ≤ 0.20 AND n ≥ 30
live → locked       any 7d axis drops below half its promotion threshold
locked → live       91d snapshot recovers; manual unlock
live → deprecated   superseded by a newer version OR 28d utility ≤ 0.10
deprecated → (terminal — historical only)
```

Promotion *requires* all three axes; demotion requires *only one*.
This is intentionally asymmetric: promoting on a single good metric
creates over-fit; demoting on any single regression creates safety.

The lifecycle manager (`src/lifecycle/lifecycle-manager.ts`)
evaluates the rule set against the most recent measurement row per
capability, in a single pure-function pass. The worker decides;
the registry persists the new state and appends to the audit chain.

For composite capabilities, the lifecycle manager also propagates
**dependency failure**: if any of `dependencies` lives outside
`{ live }`, the composite cannot promote past `shadow`.

---

## 7. Tenant-authored capability authoring API

Tenants (via `apps/owner-dashboard`) can author capabilities
through a controlled API:

```ts
registry.author({
  tenant_id: 'mining-ltd-01',
  name: 'compose_buyer_brief',
  version: '0.1.0',
  kind: 'tenant',
  contract: {
    inputSchema: z.object({ buyerId: z.string() }),
    outputSchema: z.object({ brief: z.string(), riskScore: z.number() }),
    costClass: 'tier_1',
    latencyBudgetMs: 10_000,
  },
  dependencies: ['<research_v1.id>', '<compose_doc_v1.id>'],
})
```

The authoring path always lands in `lifecycle_state = 'draft'`. The
tenant can then exercise the capability in `shadow` mode — the
worker collects measurements; once thresholds are crossed, the
lifecycle manager promotes to `live` automatically.

Tenant-authored capabilities are *never* cross-tenant visible. The
registry's queries always filter by `tenant_id OR tenant_id IS NULL`.
Seed capabilities (`null`) are visible to all tenants; tenant
capabilities are private. Cross-tenant capability benchmarking
(e.g. *"your peers' `compose_doc_v1` is 30 % faster"*) is performed
**only** through differential-privacy aggregates, per the
federation rules in `SELF_IMPROVING_LOOPS_SPEC.md`.

Provenance is tracked through `provenance_class`:
- `seed` — the five atomics + meta-dispatcher.
- `spawned` — created by a junior-evolution-worker pass.
- `tenant_authored` — user-authored via the dashboard.

This mirrors the [agentbench capability-cards practice (Liu et al.,
ICLR 2024)](https://arxiv.org/abs/2308.03688) and the
[OpenAI Evals registry pattern (openai/evals#registry, 2024)](https://github.com/openai/evals/tree/main/evals/registry)
where every eval has a clear authoring lineage.

---

## 8. Persistence + RLS

Four tables in migration 0045:

| Table                       | Purpose                                                                          |
| --------------------------- | -------------------------------------------------------------------------------- |
| `capabilities`              | The registry itself.                                                             |
| `capability_invocations`    | One row per call. Powers competence.                                             |
| `capability_outcomes`       | One row per resolved outcome (FK to invocation). Powers calibration + utility.   |
| `capability_measurements`   | One row per (capability, window) per measurement tick. Powers lifecycle.         |

All four tables are tenant-scoped via the canonical
`current_setting('app.tenant_id', true)` RLS policy from migration
0003. Seed capabilities use a sentinel tenant id (`'__seed__'`) and
a permissive RLS policy is added to make them visible cross-tenant
on `SELECT` only.

Every mutation appends a row whose `audit_hash` chains to
`prev_hash` of the prior mutation on the same capability — same
pattern as `ai_audit_chain`.

---

## 9. Worker shape

`services/capability-measurement-worker/` is a long-running pod:

- Health server on `PORT` (default **4017**), `GET /health`.
- Cron tick every **5 minutes** (`CAPABILITY_MEASUREMENT_TICK_MS = 300_000`).
- Each tick walks `tenants × live capabilities`, queries the
  invocation + outcome streams over the three windows, computes the
  three axes, writes `capability_measurements`, and (optionally)
  runs the lifecycle manager.

The worker is degradable — missing `DATABASE_URL` collapses to
no-op log+exit, exactly like `junior-evolution-worker/config.ts`.

---

## 10. Anti-patterns

Mr. Mwikila MUST NOT:

1. **Promote a capability on competence alone.** All three axes must clear thresholds together.
2. **Reuse measurements across tenants.** Each tenant has its own measurement stream; cross-tenant signals are differential-privacy aggregates only.
3. **Mutate a capability row in place.** A new version is a new row; the audit chain captures lineage.
4. **Skip the audit hash chain.** Every catalogue mutation appends `(audit_hash, prev_hash)`.
5. **Run `compose_anything_v1` without declaring its sub-capabilities in `dependencies`.** The contract validator rejects mis-declared composites.
6. **Persist a measurement with `n_observations < 1`.** Empty windows are skipped, not zero-stamped.
7. **Allow tenant-authored capabilities to have `kind = 'atomic'`.** Atomic capabilities are seed-only.

---

## 11. Cross-spec integration

- **Cognitive engine** (`packages/cognitive-engine`): every capability invocation routes through a cognitive turn first; the turn's `confidence` label becomes the capability's `claimed_confidence`. Calibration measurement reuses `@borjie/calibration-monitor` primitives unchanged.
- **Junior dynamic spawning** (`Docs/DESIGN/JUNIOR_DYNAMIC_SPAWNING_SPEC.md`): when a junior spawns a new behaviour, it registers a `Capability` with `provenance_class = 'spawned'` and `lifecycle = 'draft'`. Lifecycle promotion follows the rules in §6.
- **Self-improving loops** (`Docs/DESIGN/SELF_IMPROVING_LOOPS_SPEC.md`): the meta-loop reads `capability_measurements` to identify the weakest capability per tenant and target it for improvement.
- **Research orchestrator** (`services/research-orchestrator`): backs `research_v1` end-to-end; the orchestrator's existing scorer feeds the calibration channel.
- **Anticipatory UX**: a capability must be in `lifecycle = 'live'` to be pre-stageable.

---

## 12. References

- [OpenAI Evals — openai/evals GitHub (Jan 2024–)](https://github.com/openai/evals) — capability-first eval registry.
- [Anthropic Claude Model Card line — anthropic.com (2024–)](https://www.anthropic.com/news/claude-3-5-sonnet) — per-capability scores published per model release.
- [RAGAS — Retrieval Augmented Generation Assessment, ragas.io (2023)](https://github.com/explodinggradients/ragas) — context recall / faithfulness as capability metrics.
- [ARC-AGI Benchmark — arcprize.org (Chollet, 2024)](https://arcprize.org/) — capability-not-model evaluation.
- [AgentBench — Liu et al., ICLR 2024](https://arxiv.org/abs/2308.03688) — multi-environment agent capability cards.
- [LangSmith Evaluations — LangChain Docs (2024)](https://docs.smith.langchain.com/evaluation) — production feedback loops.
- [ReAct — Yao et al., 2023](https://arxiv.org/abs/2210.03629) — meta-dispatcher pattern.
- [Toolformer — Schick et al., 2023](https://arxiv.org/abs/2302.04761) — tool dispatch.
- [Brier score — Brier, MWR 1950](https://journals.ametsoc.org/view/journals/mwre/78/1/1520-0493_1950_078_0001_vofeit_2_0_co_2.xml) — calibration foundation.
- [Expected Calibration Error — Guo et al., ICML 2017](https://arxiv.org/abs/1706.04599) — ECE definition.
- [Google SRE Workbook — Error Budget Policy (2018)](https://sre.google/workbook/error-budget-policy/) — competence threshold practice.
- [Certificate Transparency — transparency.dev](https://transparency.dev) — Merkle-log audit pattern.

The catalogue is the **operational instrument** that turns
capability rhetoric into engineering reality: every capability is
named, versioned, owned, lifecycle-gated, and measured on three
axes over three windows. Mr. Mwikila's growing surface area
becomes legible — and so improvable — for the first time.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
