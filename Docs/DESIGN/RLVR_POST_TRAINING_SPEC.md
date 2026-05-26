# RLVR Post-Training Pipeline — Specification

> Status: Wave 19C. Companion package: `packages/post-training-rlvr`.
> Companion migration: `packages/database/drizzle/0041_rlvr.sql`. Sister
> documents: `PRM_MCTS_REASONING_SPEC.md`, `MUTATION_AUTHORITY_SPEC.md`,
> `COGNITIVE_ENGINE_SPEC.md`, `DEEP_RESEARCH_SPEC.md`.

---

## 1. Background — RLVR and Why It Matters for Mining-Domain Reasoning

Reinforcement Learning from Verifiable Rewards (RLVR) trains language
models by rewarding outputs that can be *mechanically checked* — a
math answer that equals the ground-truth integer, a unit test that
passes, a SQL query whose execution returns the expected rows, a URL
that resolves and whose body actually contains the claim cited. The
verifier is not a model — it is a deterministic function (or a service
call that produces a deterministic verdict). This is the central
shift from RLHF, where the reward model is itself a noisy neural
approximation of human preference.

Three reference points anchor the design:

1. **DeepSeek-R1** ("DeepSeek-R1: Incentivizing Reasoning Capability in
   LLMs via Reinforcement Learning", arXiv 2501.12948, 22 Jan 2025,
   https://arxiv.org/abs/2501.12948) demonstrated that rule-based
   verifiable rewards (math correctness, code-compilation pass-rate)
   can train strong reasoning behaviour without a learned reward
   model — bypassing the reward-hacking failure mode of RLHF.
2. **OpenAI o1 system card** ("OpenAI o1 System Card", 12 Sep 2024,
   https://openai.com/index/openai-o1-system-card/) describes
   verifiable-reward RL during reasoning-style training, with safety
   evaluation against jailbreak / hallucination benchmarks.
3. **Tülu 3** ("Tülu 3: Pushing Frontiers in Open Language Model
   Post-Training", arXiv 2411.15124, 22 Nov 2024,
   https://arxiv.org/abs/2411.15124) shipped a full open recipe —
   SFT → DPO → RLVR — for instruction-following + math + precise
   IFEval verifiers; the verifier catalogue (math, IFEval, code
   execution) is the closest public analogue to what Borjie needs
   for the mining/legal domain.

Borjie is a Tanzanian mining estate-management AI OS. Mr. Mwikila —
the founder-facing persona — produces outputs whose correctness is
domain-specific and *frequently mechanically verifiable*: a TRA
(Tanzania Revenue Authority) filing either validates against the
schema or it does not; a royalty computation either reconciles to
the statutory rate × declared tonnage or it does not; a citation
either resolves and quotes the source faithfully or it does not; a
brand-lock pass either holds or trips the ESLint guardrail. The
RLVR framing fits the domain unusually well because mining
regulation is a *rules*-bound domain — there are explicit code
sections, explicit royalty schedules (Mining Act 2010 First Schedule),
explicit filing forms — and reward signals can be derived from those
artefacts rather than from human preference voting.

What this package is *not*: we are not training base weights. We
do not own a training cluster. What we own is the *orchestration
layer* — the data pipeline that captures Mr. Mwikila traces,
applies the verifier catalogue, shapes a scalar reward, redacts
tenant data, curates a training set, and hands a clean batch off
to whichever provider (Anthropic, OpenAI, Together) Mr. Mwikila
contracts for the actual gradient step. The split mirrors how
Tülu 3 separates the recipe from the trainer.

---

## 2. Verifier Catalogue — At Least Ten Verifiers Wired

A verifier is a pure(-ish) function:

```ts
type Verifier = (input: VerifierInput) => Promise<VerificationResult>;

interface VerificationResult {
  readonly verifierName: string;
  readonly verdict: 'pass' | 'fail' | 'partial' | 'skip';
  readonly reward: number;                // [0, 1]
  readonly evidence: Record<string, unknown>;
  readonly confidence: number;            // [0, 1]
}
```

The initial catalogue (Wave 19C ships six; the rest are sketched
for Wave 19D):

| # | Verifier               | Verdict source                                                 | Reward shape |
|---|------------------------|-----------------------------------------------------------------|--------------|
| 1 | `citation-resolves`    | HTTP GET on the cited URL; require 200 + text contains claim   | binary       |
| 2 | `tra-schema`           | Zod parse of declared TRA filing payload                       | binary       |
| 3 | `royalty-math`         | `abs(declared - tonnage * rate) <= epsilon`                    | shaped       |
| 4 | `brand-lock`           | Spawn brand-lock ESLint programmatically, no violations        | binary       |
| 5 | `calibration`          | Claimed confidence ∈ band matching verified outcome            | shaped       |
| 6 | `mutation-authority`   | Proposed tier ≤ subject's required tier (T0/T1/T2)             | binary       |
| 7 | `nemc-precondition`    | Output references NEMC EIA Cert before any extraction action   | binary       |
| 8 | `tumemadini-form-pick` | Correct mineral-rights form for licence class (PML/PL/SML/ML)  | binary       |
| 9 | `swahili-translation`  | Back-translation cosine ≥ τ; flags loss-of-meaning             | shaped       |
| 10| `regulatory-citation-freshness` | Cited regulation amendment date ≥ Borjie's known floor | binary       |

The reward is in `[0, 1]`. For binary verifiers a `fail` is `0`, a
`pass` is `1`, a `skip` (verifier not applicable to this trace) is
excluded from the aggregate. For shaped verifiers — royalty math,
calibration, translation — partial credit is supported.

Note the design choice: every Borjie verifier maps to an existing
runtime guardrail. The mutation-authority verifier consults the
Wave 18S T0/T1/T2 hierarchy; the brand-lock verifier invokes the
existing ESLint rules; the calibration verifier consumes the
`@borjie/cognitive-engine` confidence labels. We are *not* inventing
new judgement criteria — we are reusing the criteria the runtime
already enforces, and converting "did the runtime agree with this
trace?" into a training signal. This is the DeepSeek-R1 insight
applied at the application layer.

**Verifier contract details.** Every verifier exposes three pure
functions:

```ts
interface Verifier {
  readonly name: string;
  applies(trace: RlvrTrace): boolean;
  verify(trace: RlvrTrace): Promise<VerificationResult>;
}
```

`applies` is consulted *before* `verify` to short-circuit non-relevant
verifiers — for example, `royalty-math` skips traces that do not
declare a tonnage. The runner records a `skip` verdict in this case
so the audit chain still witnesses the verifier's presence.

**Per-verifier specifics.**

- *`citation-resolves`* — accepts an injected `Fetcher` port
  (default: `globalThis.fetch`). On 200, the body is searched for the
  literal claim substring; on a hit, `pass`. On 4xx/5xx, `fail` with
  status in `evidence`. On network error, `skip` with the error
  message. Test fixtures inject a deterministic fetcher; the
  production runner uses real HTTP (live-test discipline).
- *`tra-schema`* — wires a Zod parse against the canonical TRA
  filing schema (initially a stub; Wave 19D fills the real schema).
  Parse success → `pass`; parse failure → `fail` with `zodIssues`
  in `evidence`.
- *`royalty-math`* — pulls `tonnage` and `rate` from the trace
  declared payload, expects `declared = tonnage * rate` within ε.
  Reward is the linear distance from ε as described in §3.
- *`brand-lock`* — invokes the brand-lock ESLint rule programmatically
  on the candidate UI fragment. Zero violations → `pass`; any
  violation → `fail` with the rule IDs in `evidence`.
- *`calibration`* — reads claimed confidence label
  (`high | medium | low | uncertain`) from the trace metadata,
  cross-references the verified outcome of a sister verifier
  (typically `tra-schema` or `royalty-math`), emits Brier-style
  reward as in §3.
- *`mutation-authority`* — confirms the proposed authority tier is
  at least as restrictive as the subject's required tier. T0 →
  any; T1 → requires `owner`; T2 → requires `owner` + `second_authoriser`.
  A T2-Critical proposal asserted as T0 trips an immediate `fail`
  regardless of any other verifier passing — the §6.3 safety rule.

---

## 3. Reward Shaping — Binary First, Partial Where Warranted

Pure binary rewards (DeepSeek-R1 style) are sufficient when the
verifier is genuinely binary: the schema parsed or it did not; the
URL resolved with matching text or it did not. Pure binary is also
*safer* — there is no continuous gradient to game.

But three of our verifiers are intrinsically continuous:

1. **Royalty math** — a declaration that is `0.5%` off should not
   receive the same reward as one that is `50%` off. The shape is
   `reward = max(0, 1 - |declared - expected| / (epsilon * 100))`,
   clamped, with `epsilon` tenant-configurable (default `0.01`).
2. **Calibration** — Brier-style — if the claim was made with
   `~0.7` confidence and the outcome verified, the reward is the
   complement of the squared error. Coupling to
   `@borjie/calibration-monitor` is explicit: we read the band ECE
   over a recent window and use it as a multiplier so a trace from
   a poorly-calibrated tenant cannot rack up calibration credit by
   coincidence.
3. **Swahili translation quality** — sentence-embedding cosine on
   the back-translation. Threshold τ is tenant-configurable.

Aggregation across verifiers in a single trace uses a configurable
weighting vector (default uniform). The `RewardShape` interface
records the per-verifier rewards *and* the aggregate, so a downstream
training run can choose to ignore the aggregate and supervise on a
specific verifier.

A trace whose verifier set yields zero `pass` verdicts and at least
one `fail` is excluded from curation unless `includeFailures: true`
is passed (for DPO-style preference data, failures are signal too).

---

## 4. Data Pipeline — Capture → Verify → Reward → Curate → Redact → Handoff

The end-to-end shape (per run):

```
   Mr. Mwikila session
         │
         ▼
  trace-collector ───────► RlvrTrace (raw)
         │
         ▼
  verifier registry ─────► RlvrVerification[] (per-verifier verdicts)
         │
         ▼
  reward-shaper ─────────► RewardShape (aggregate + per-verifier)
         │
         ▼
  curator ───────────────► CuratedExample[] (filtered, deduped)
         │
         ▼
  redactor ──────────────► CuratedExample[] (tenant-redacted)
         │
         ▼
  batch handoff ────────► JSONL → provider (Anthropic/OpenAI/Together)
```

Each arrow is dependency-injected. The runner is the orchestrator;
the registry is the configuration; the verifiers are pure (or have a
single injected I/O port — `fetch` for citation-resolves). All
intermediate artefacts are persisted in the four 0041 tables with
audit-hash chaining (PO-14 pattern).

**Trace collection.** A trace is a tuple
`{ prompt, completion, tool_calls[], scope, autonomy_tier, timestamp }`.
Capture happens in two ways: (a) explicit — a session is flagged as
training-eligible and every turn is recorded; (b) implicit — every
verified mutation-authority proposal already carries enough metadata
to reconstruct the corresponding trace. We strictly prefer (a) for
RLVR runs because (b) is biased toward already-approved traces.

**Verification.** The registry is iterated; verifiers whose
`applies(trace)` returns false are `skip`ped. Verifiers that error
(network timeout, schema parse exception) are recorded as `skip` with
the error in `evidence` — they do not propagate a synthetic fail,
because a verifier outage must not corrupt the reward signal. This
mirrors the RewardBench discussion of verifier-failure handling
("RewardBench: Evaluating Reward Models for Language Modeling",
arXiv 2403.13787, 20 Mar 2024, https://arxiv.org/abs/2403.13787).

**Reward shaping.** Per-verifier rewards combine via weighted sum.
Weights live on the `RlvrRun.verifierSet` config; a tenant can
weight `tra-schema` at 2× because their highest-priority failure
mode is filing rejection.

**Curation.** Dedupe by `sha256(canonicalJson(prompt))` to avoid
training on near-identical traces. Exclude traces below a
configurable reward floor (default `0.5`). Exclude traces flagged
by mutation-authority as Tier-2-Critical without explicit founder
approval. Exclude traces whose scope is `district_md` if the run
config is `tenant_root` only. The `exclusion_reason` is persisted —
"why was this trace dropped" is itself audit-relevant.

**Redaction.** Every value in the trace is hashed via
`sha256(tenantId:fieldPath:value)` and the hash replaces the value.
This is the salted-hash pattern already used in Wave 18R deep
research. The salt — the tenant ID — means the same plaintext under
two tenants produces different hashes, defeating cross-tenant
correlation. Non-PII fields (regulatory section numbers, royalty
percentages, mineral kinds) are preserved as plaintext; an explicit
allow-list governs which fields stay clear. Anything not on the
allow-list is hashed by default — fail-closed.

**Handoff.** The redacted curated set is serialised to JSONL (one
trace per line), the audit hash of the run is stamped in the manifest,
and the file is uploaded to the provider's fine-tuning endpoint. The
JSONL never contains tenant_id directly — the audit hash links
back to the run, the run carries the tenant_id, the run is RLS-scoped.

**Live-test discipline.** No stage in this pipeline is permitted to
fabricate or persist synthetic traces and present them as real
Mr. Mwikila session data. Synthetic traces exist *only* in the unit
test suite, are explicitly tagged `synthetic: true` in their
metadata, and the production runner refuses to advance any trace
whose metadata carries that flag. This is the live-test discipline
inherited from the wider Borjie codebase: training data must be
captured from live runs of the real persona answering real founder
or operator queries; recorded fixtures are testing artefacts only,
not training inputs. The `synthetic: true` guard is asserted at the
trace-collector boundary and again at the curator boundary so two
independent gates have to be bypassed before a fixture could leak
into a real run.

---

## 5. Run Lifecycle

```
   pending → running → verifying → curating → redacting → ready_for_handoff
                                                                   │
                                                                   ▼
                                                            handed_off → completed
                                                                   ▲ │
                                                                   │ ▼
                                                              cancelled / failed
```

A `RlvrRun` is the unit of audit. It carries:

- `kind` — `tra_filings | royalty_audits | brand_compliance | mixed`,
- `verifierSet` — the array of verifier names to run plus weight vector,
- `tenantId`, `startedAt`, `endedAt`, `status`,
- `audit_hash` + `prev_hash` — the canonical PO-14 chain link.

Each `RlvrTrace`, `RlvrVerification`, `RlvrCuratedExample` row is
hash-chained to its parent. Verification is therefore *recompute-able*
months later by an auditor — they can pull the chain, walk the
verifiers, and confirm the rewards were not retroactively shaped.

**State transitions.** The runner enforces:

- `pending → running` on the first `verify()` call.
- `running → verifying` when all traces are captured and no further
  trace collection is permitted.
- `verifying → curating` when every trace has at least one
  verification record (which may include `skip`).
- `curating → redacting` when the curator has produced a final
  `included` decision for every trace.
- `redacting → ready_for_handoff` when every included example
  carries a redacted copy.
- `ready_for_handoff → handed_off` on successful provider upload.
- `handed_off → completed` on provider confirmation that the batch
  was ingested.
- Any state → `failed` on unrecoverable error, with the failure
  reason in `evidence`. Any state → `cancelled` on explicit
  founder cancellation.

Transitions are guarded by predicates in the repository so an invalid
transition (e.g. `pending → completed`) is impossible.

**Verifier-set versioning.** The `verifierSet` column on `rlvr_runs`
is a `text[]` of verifier names, but each verifier carries a `version`
in code. The audit hash incorporates both, so an auditor can detect
that a run was performed against `tra-schema@v1` even though
`tra-schema@v2` is now current.

---

## 6. Safety — No PII Leak + ε-Budget Aware

Three safety constraints govern the pipeline:

**6.1 No PII to external trainers.** The redactor is a *required*
stage; the runner refuses to advance to `ready_for_handoff` unless
every example has been redacted. The redactor is unit-tested with
synthetic traces containing fixture PII (a fake NIDA, a fake M-Pesa
number, a fake parcel coordinate) and asserts the plaintext does not
appear in the redacted output. Tests also confirm that the same
plaintext under two tenants produces different hashes.

**6.2 ε-budget awareness.** The cognitive-engine ships a privacy
ε budget per tenant (Wave 18T calibration tier). Each curated example
costs ε proportional to the number of unique-tenant-identifying
fields it could leak. The runner checks the budget pre-handoff and
refuses to ship a batch that would exceed it. The Tülu 3 paper notes
this as future work; we implement a minimal version: budget exhaustion
moves the run to `failed` with `exclusion_reason = 'epsilon_exhausted'`.

**6.3 Constitutional alignment.** Aligned outputs receive *no*
positive reward boost from being verifiable — but verifiably
*unaligned* outputs (e.g. citing a regulation incorrectly to advise a
mining operator to evade royalty) receive a verifier `fail` and are
excluded. We cite Anthropic's constitutional framing here
("Constitutional AI: Harmlessness from AI Feedback", arXiv 2212.08073,
15 Dec 2022, https://arxiv.org/abs/2212.08073) — the principle that
*verifiable harm* should outweigh *verifiable correctness* on any
individual trace. Practically: the `mutation-authority` verifier
emits `fail` regardless of other passes if the proposed tier is below
the subject's required tier.

**6.4 Reward-hacking defences.** A persistent failure mode of any
RL system is the policy learning to satisfy the verifier rather than
the underlying objective. We mitigate this three ways:

- *Verifier diversity.* The default verifier set is at least four
  verifiers wide, so a trace can only achieve maximum reward by
  satisfying genuinely different criteria — schema correctness,
  citation grounding, authority-tier compliance, and brand-lock all
  at once. A policy that learns to emit syntactically-valid TRA
  filings without resolving citations will score at most 1/4.
- *Cross-verifier conflict detection.* If `calibration` flags a
  trace as high-confidence and `citation-resolves` flags it as
  failed, the run records the conflict in `evidence` and downweights
  the aggregate — confident hallucinations cost more than humble
  failures.
- *Hold-out evaluation.* A configurable fraction of incoming traces
  (default 10%) is set aside as a hold-out set the verifiers do not
  see during curation. Post-training, the new model is evaluated
  against the hold-out — if its verifier-pass rate on training rises
  but on hold-out falls, the run is flagged for review. This is the
  RewardBench discipline applied to our domain.

**6.5 Audit recompute.** Every persisted artefact — run, trace,
verification, curated example — carries `audit_hash` + `prev_hash`
forming a PO-14 chain. An auditor with read access to the chain (and
the verifier registry version pinned at the time of the run) can
recompute every verification verdict from the redacted trace and
confirm no row was retroactively shaped. This is the same property
the mutation-authority chain provides for write operations.

---

## 7. Citations

1. **DeepSeek-R1**: "DeepSeek-R1: Incentivizing Reasoning Capability
   in LLMs via Reinforcement Learning", arXiv 2501.12948, 22 Jan
   2025, https://arxiv.org/abs/2501.12948.
2. **OpenAI o1 system card**: "OpenAI o1 System Card", 12 Sep 2024,
   https://openai.com/index/openai-o1-system-card/.
3. **Tülu 3**: "Tülu 3: Pushing Frontiers in Open Language Model
   Post-Training", arXiv 2411.15124, 22 Nov 2024,
   https://arxiv.org/abs/2411.15124.
4. **RewardBench**: "RewardBench: Evaluating Reward Models for
   Language Modeling", arXiv 2403.13787, 20 Mar 2024,
   https://arxiv.org/abs/2403.13787.
5. **Constitutional AI**: "Constitutional AI: Harmlessness from AI
   Feedback", arXiv 2212.08073, 15 Dec 2022,
   https://arxiv.org/abs/2212.08073.
6. **Math-Shepherd** (process reward background): "Math-Shepherd:
   Verify and Reinforce LLMs Step-by-step without Human
   Annotations", arXiv 2312.08935, 14 Dec 2023,
   https://arxiv.org/abs/2312.08935.
7. **PRM800K** (process-supervision dataset background): "Let's
   Verify Step by Step", arXiv 2305.20050, 31 May 2023,
   https://arxiv.org/abs/2305.20050.
8. **Borjie Wave 18S**: `Docs/DESIGN/MUTATION_AUTHORITY_SPEC.md` —
   T0/T1/T2 authority tiers.
9. **Borjie Wave 18T**: `Docs/DESIGN/COGNITIVE_ENGINE_SPEC.md` —
   confidence labels + ε budget.
10. **Borjie Wave 18R**: `Docs/DESIGN/DEEP_RESEARCH_SPEC.md` —
    salted-hash redaction pattern.

---

## § Universal-from-day-one note

Per `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md`: Borjie is built for the entire world. Tanzania is the launch beachhead, not the architectural boundary. Any reference in this spec to Tanzania, TZ, Swahili, TRA, Tumemadini, NEMC, BoT, TZS, +255, or Africa/Dar_es_Salaam is the launch-tenant default, sourced from `@borjie/jurisdiction-profile-tz` + `@borjie/language-pack-sw` + `@borjie/vertical-profile-mining-tz`. Adding a new jurisdiction = adding a new profile package, not editing this spec. Mr. Mwikila's reasoning, memory, calibration, quality gates, security, observability, audit chain, encryption, federation consent, and capability catalogue are language-agnostic and jurisdiction-agnostic.
