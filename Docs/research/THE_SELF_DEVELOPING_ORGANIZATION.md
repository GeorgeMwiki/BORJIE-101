# THE SELF-DEVELOPING ORGANIZATION

**The capability that lets Mr. Mwikila grow his own skills, harvest the estate's
tacit know-how, and author the feature-requests that close his own capability gaps.**

**Last Updated:** 2026-06-09
**Author:** Lead Architect
**Status:** Architecture dossier (design-of-record for the self-development layer)
**Scope:** Borjie `persistent-memory` skill library · `knowledge-graph` provenance hub ·
`central-intelligence` brain-tools · `api-gateway` admin control-plane · `workflow-engine` four-eye
**Companion:** `Docs/research/THE_METACOGNITIVE_SELF_MODEL.md` (the self-*awareness* dossier).
This is the self-*development* dossier.

---

## 1. Vision — and how it composes with the metacognitive self-model

`THE_METACOGNITIVE_SELF_MODEL.md` gives Mr. Mwikila a way to *know the shape of his
own ignorance*: a durable, hash-chained **register** keyed on the blocker, with two
registers of self-knowledge — a forward **capability-gap** register (Loop A) and a
backward **understanding gate** (Loop B) — fused by one Metacognitive Executive that
chooses, per situation, between **act / defer / ask** (Kadavath et al.,
*Language Models (Mostly) Know What They Know*, arXiv:2207.05221, Anthropic 2022;
Zhang, Knox & Choi, *Modeling Future Conversation Turns…*, ICLR 2025, arXiv:2410.13788).

That dossier *detects and parks* gaps. **This dossier closes them.** Self-awareness
without self-development is a diary of frustrations; the two are one organ. The
metacognitive register is the **gap source**; the self-developing organization is the
**three exits** that drain it:

> **The deepest design truth (the unifying structure):** the three MD requirements —
> (C) grow/maintain its own skills, (D) harvest tacit human know-how, (E) author
> feature-requests for structural gaps — are **three exits of ONE impasse-driven loop**,
> exactly as Soar/ACT-R *learn-at-the-impasse* prescribes (Laird, *The Soar Cognitive
> Architecture*; Anderson, ACT-R production compilation; cf. arXiv:2201.09305). Every
> event where the live skill/workflow library cannot reactively resolve a situation is
> logged as an **impasse with a full trace**. A **capability-gap classifier** routes it —
> and the classifier is **NOT lone introspection**, because models flag DATA deficits
> well (~70%) but admit their OWN gaps poorly (<30%) (Feng et al., *Don't Hallucinate,
> Abstain*, ACL 2024, arXiv:2402.00367). So routing runs through the existing
> **multi-junior debate** + **honest-confidence** orchestrator and the **Auditor**
> empty-evidence gate:
>
> - **(A) procedural gap**, solvable + verifiable in-sandbox → **chunk/induce a skill**
>   (Voyager program-skill + AWM workflow-induction, abstracted, evidence-gated) into a
>   **SkillOps versioned contract library** → **loop C**.
> - **(B) knowledge/data gap** → **harvest tacit know-how** via Nurture-First
>   crystallization, provenance-stamped into the audit chain → **loop D**.
> - **(C) structural capability gap** debate cannot close → **author a CREATOR-style
>   abstract-plan feature-request** to admin-web for Opus to build to zero-issues under
>   governance → **loop E**.

**The composition contract (how the two dossiers interlock):**

| Metacognitive organ (awareness) | Self-developing exit (development) | Wiring |
|---|---|---|
| Loop A capability-gap **register** (`md_commitments`, `gap_kind`) | The register's `gap_kind='structural'` rows **feed E** | `feature_request.author()` consumes parked structural gaps |
| Loop A auto-resume on blocker-clear | **E's auto-complete-on-ship** *is* a blocker-clear event | GitHub merge → `skill-complete` → register row resolves |
| Loop A **reflexion lessons** (verbal-RL) | **Lessons feed C** — a recurring resolved impasse crystallizes into a skill | `reflexion-writer` lesson → skill-induction candidate |
| Loop B **understanding gate** (ask only when VOI is high) | **B's elicitation feeds D** — the answer is harvested as a provenanced rule | `elicit.run` writes to the KB hub, not just the turn |
| One **suspend/resume** engine | C/D/E all park as `md_commitments` rows that auto-resume | one register, three drains |

So: **the gap register feeds E; lessons feed C; elicitation feeds D.** One register,
one suspend/resume engine, three development exits — none of which mutates the live
brain without passing a fail-closed verification + four-eye gate (the discipline both
dossiers share, per CLAUDE.md: *evidence-required AI output*, *kill-switch fail-closed*,
*HIGH-risk policy prefixes hit literal rules*, *AI audit chain is append-only*).

---

## 2. Loop C — The living skill / rule / workflow library

> **Requirement:** the MD maintains a durable, versioned library of its own
> skills / rules / workflows, crystallizing new ones at impasses and
> reinforcing / decaying / retiring / re-versioning them as the world changes —
> **without the library silently rotting below the no-skill baseline.**

### 2.1 What already exists (the substrate)

Borjie already ships a Voyager-pattern procedural-memory tier:

- **`packages/persistent-memory/src/skill/skill-registry.ts`** — append-only
  observe/lookup. Skills are versioned by `(id, version)`; promotion/decay produce a
  **new row** (the immutable lifecycle). Each write emits an `audit_hash` via
  `AuditChainPort.append({event_kind: 'skill.observe' | 'skill.promote' | 'skill.decay', …})`.
- **`packages/persistent-memory/src/skill/skill-decay.ts`** — pure decider:
  `decideSkillDecay(skill, now)` deprecates skills unused for `SKILL_DECAY_DAYS` (180);
  `deprecateSkill` returns the deprecated projection (old row left in place for audit).
- **`packages/persistent-memory/src/skill/skill-composer.ts`** — bottom-up composition.
- **`packages/persistent-memory/src/types.ts`** — the `Skill` interface
  (`id/version/tenant_id/scope_id/intent/preconditions[]/steps[]/postconditions[]/
  success_rate/invocations/last_used_at/composed_from_skills/status/audit_hash/
  decayed_at/created_at`), `SkillStep` (declarative: `tool_or_skill` + `input_template`
  + `expected_output_schema` + `retry_policy`), status lifecycle
  `observed → tested → canonical → deprecated`, and tunables `SKILL_COMPOSE_MIN_INVOCATIONS=3`,
  `SKILL_PROMOTE_MIN_SUCCESS_RATE=0.8`.
- **Migration `0321_md_commitments.sql`** — the MD's durable deferral ledger
  (prospective memory). Net-new lifecycle versioning attaches here.

This is the **Voyager skill library**: NL-described (`intent`), versioned, executable
(`steps`), composable — exactly the SOTA blueprint (Wang et al., *Voyager*, NeurIPS 2023,
arXiv:2305.16291). What it lacks is the **lifecycle governance** the 2026 frontier proved
is a *survival requirement*, not a nicety.

### 2.2 The crystallization trigger: mint at the impasse

A skill is **born from the trace that solved what the existing library could not** — the
Soar chunking / ACT-R production-compilation rule (arXiv:2201.09305): at an impasse the
agent reasons in a substate, then compiles the resolving trace into one new production
keyed on the triggering pre-state. Concretely, the MD logs an impasse whenever:

1. `skill-registry.findByIntent()` returns no precondition-matched skill for a live
   situation (the lookup miss), **and**
2. the situation is nonetheless resolved by slow deliberation (a multi-step orchestrator
   plan, an escalation fallback, or a human-supplied workflow).

The resolving trajectory is then **induced into a candidate workflow** — the AWM move
(Wang/Zhou/Fried, *Agent Workflow Memory*, 2024, arXiv:2409.07429): extract the common
sub-routine, and **abstract example-specific constants to typed variables**
(`tenant_id / site_id / mineral / royalty_rate → typed slots`), so one tenant's
royalty-filing trajectory generalizes to a platform-wide workflow (the corpus
`tenant_id = NULL` ground-truth pattern). AWM is supervision-free and online: only
*successful* trajectories are induced (+24.6% Mind2Web / +51.1% WebArena). **Borjie's
online evaluator is the Auditor + evidence gate**, not an LLM's say-so.

> **A candidate is admitted to `observed` only after ≥`SKILL_COMPOSE_MIN_INVOCATIONS`
> (3) successful, evidence-cited trials** — never from one success. This directly
> defuses the *source-trajectory-specificity* failure (MUSE-Autoskill / Voyager): a skill
> distilled from ONE incident encodes that incident's accidental assumptions and can be
> *less* reliable than no skill (arXiv:2605.27366). The originating incident stays as the
> skill's anchor.

### 2.3 The self-verification gate (mandatory promotion gate)

Single-model self-assessment misses its own gaps >70% of the time (Feng et al. 2024), so
**no skill enters `tested` on the LLM's word.** Net-new: a `skill.promote` **wrapper** in
`persistent-memory` that gates the `observed → tested` transition on:

1. **External verification by the Auditor** (`packages/ai-copilot/src/juniors/auditor-agent.ts`)
   — the trial run must achieve the skill's stated `postconditions` on a held-out check.
2. **Evidence-chain non-emptiness** — the trial cites **≥1 `evidence_id`** (CLAUDE.md
   *evidence-required* invariant; the Auditor rejects empty chains).
3. **Validators that encode REAL success conditions** — regulatory/financial postconditions
   (`royalty filing accepted`, `offtake cleared`), not "ran without error". SkillOps proves
   validators *only help if consumed at plan-time selection* (arXiv:2605.13716) and SkillRevise
   proves verifier/validator mismatch *overfits visible checks* (arXiv:2606.01139) — so the
   validator set is the `postconditions[]` already on `Skill`, checked at retrieve-time, not a
   smoke test.

This is the Voyager self-verification critic, re-pointed at Borjie's Auditor + evidence chain.

### 2.4 The safe-update state machine: shadow → canary → ramp

A re-versioned rule/workflow is **never cut over directly** — it is promoted through
controlled exposure tiers (industry SOTA: shadow-mode rollouts; canary; staged ramp,
2025–2026). Net-new: a `state` field on `Skill` — `'shadow' | 'canary' | 'live'` —
orthogonal to the existing `status` (`observed/tested/canonical/deprecated`):

| State | Behaviour | Exit condition |
|---|---|---|
| **shadow** | Skill runs in parallel on live inputs; its decision is **logged, not enacted**; the incumbent path remains authoritative. Measures agreement-rate, edge cases, refusal/error deltas — **zero blast radius**. | Agreement + guardrails hold for a bounded window → canary. **HIGH-risk prefixes (sovereign / kill_switch / four_eye) require human sign-off to exit shadow** — never auto-canary a sovereign rule. |
| **canary** | Route a small slice (5%) of real decisions to the new version for a bounded window. Borjie's existing **cost-guard, kill-switch, NOI thresholds become the canary gates**. | p50/p95 latency + cost/req + error+refusal rate within guardrails → ramp; else **auto-revert**. |
| **live (ramp)** | Staged 5% → 10% → 25% → 100%. Drift alarms watch continuously. | Full promotion; or auto-revert on the 5-round regression rollback (§2.6). |

This makes "safe-update" a **first-class lifecycle stage**. Auto-revert is wired to the
Library-Drift 5-round rollback (next section).

### 2.5 Reinforce / decay vs retire — TWO separate signals (the critical distinction)

The single highest-leverage finding for the whole library is the **Library-Drift result**
(Zhang et al., *Library Drift*, 2026, arXiv:2605.19576): a self-evolving skill library
**silently decays BELOW the no-skill baseline** (LLM-authored skills measured **+0.0pp**
vs human-curated **+16.2pp**) unless three mechanisms run continuously. Skill rot is
**invisible to aggregate metrics** until router-engagement collapses. This reframes
"maintain its own skills" from a feature into a **survival requirement**.

Borjie must keep **two distinct signals** and never conflate them:

- **Salience / retrieval-rank — biologically-inspired reinforce-vs-decay** (FadeMem
  arXiv:2601.18642; FOREVER arXiv:2601.03938; FSFM arXiv:2604.20300, all 2026). Each skill
  carries a `salience` that **decays exponentially over time** and is **reinforced on each
  verified successful use** (access-frequency boost with diminishing returns ~ the spacing
  effect). This governs **what surfaces first** in retrieval. Run the strengthen/weaken pass
  inside the existing **nightly reflexion sleep** (`packages/central-intelligence/src/kernel/
  reflexion/sleep/nightly-sleep.ts`, with `pass-4-prune-stale.ts`).
- **Contribution — hard retirement (the Ratchet Recipe).** Per-skill
  `c(s) = (successes − failures) / trials` from an **append-only evidence log per skill**
  (reuse the hash-chained AI audit trail). Three load-bearing mechanisms:
  1. **Retirement gate**: retire skill `s` **ONLY** when `n(s) ≥ Nmin` (default **100**)
     **AND** `c(s) ≤ −τ` (default **−0.10**) — a conservative evidence floor so good skills
     are **never evicted on noise** (their *erosion* failure: `Nmin=20` flipped performance
     from +0.328 to −0.019).
  2. **Bounded active-cap** `C` (default **50**): on overflow, evict the lowest-contribution
     skill — preventing retrieval-precision collapse from bloat.
  3. **Meta-authoring prior**: a style/consistency document in the junior-prompt layer that
     suppresses redundant/harmful births **upstream** (its removal caused **43%** of the
     performance loss — the single most valuable lever).
  This yields **Proposition 1**, a provable pass@1 floor `= p0 − (τ + ε + C·δ)` — ruling
  out unbounded degradation. **Monitor router-engagement %** (healthy 70–80%; collapse to
  ~19% signals drift) as the leading drift alarm — wired to Grafana/OTel.

> **The critical distinction (PIN rule):** salience-decay governs **retrieval rank**;
> contribution governs **retirement**. Keep them separate so a rarely-used-but-high-stakes
> safety/compliance/kill-switch rule (low salience, high contribution) is **reinforced for
> survival but never decayed out of existence**. **Never let decay touch
> sovereign / kill_switch / four_eye / compliance rules — PIN them out of both decay and
> auto-retirement.** (Borjie's current `skill-decay.ts` deprecates purely on disuse — this
> is the net-new guard the file needs.)

### 2.6 Re-versioning: diagnose → revise → select (with rollback)

When health or CGPD flags a failing/stale workflow, run the **SkillRevise** bounded
~3-round loop (arXiv:2606.01139): execute → **diagnose** (verification spec, failure
attribution + defect label, preservation constraints) → retrieve a **repair pattern** from
a Principle Memory → revise with execution anchors → re-execute → **select argmax utility**
`U = a·ΔSucc + b·succ_gate·ΔEff + c·ΔTrans − L·interface_cost` (binary verifier gate).
Critically it **returns the best over ALL rounds, not the last** — the gate *is* a rollback.
The MD **never swaps a working royalty/settlement workflow for a looks-better rewrite** that
doesn't beat real utility. The 5-round regression rollback (`τ_rb = 0.10` over 5 consecutive
rounds) reverts any version that causes a performance drop. Versions are append-only with a
parent pointer, so any prior version is restorable.

### 2.7 Conflict resolution: detect latent rule collisions before commit (WIRE)

When the MD adds or re-versions a **rule**, run the **WIRE** two-phase check *before* commit
(Yan, Chen, Zhang, Purdue, 2026, arXiv:2605.27784):

- **Phase 1 (symbolic, cheap, exhaustive):** compile new + existing rules to clauses
  (`φ` activation-condition, `σ` require/forbid sign, `p` behavior-primitive, `θ` args,
  `d` decision-surface). Two clauses are a hard-collision **candidate** iff they share a
  decision surface, have contradictory signs, and their activation conditions are **jointly
  satisfiable** (an SMT/SAT check).
- **Phase 2 (behavioral):** for each candidate, generate **witness requests** and run them
  through the actual brain to see which rule *wins* (a 4-cell matrix → asymmetry metric).
  **A SAT-confirmed conflict is only a candidate — behavior decides resolution.**

Keep the **EXACT rule text authoritative** (matches CLAUDE.md *HIGH-risk policy prefixes
must hit literal policy rules* — never let a paraphrase resolve a sovereign/kill_switch
conflict). **Surface unresolved hard conflicts to four-eye review** rather than auto-merging.

### 2.8 Anti-rot, distilled

| Threat | Mechanism | Source |
|---|---|---|
| Library decays below no-skill baseline | Ratchet Recipe: contribution-gated retirement + active-cap + meta-prior | Library Drift 2026 |
| Erosion (retire good skills on noise) | `Nmin ≥ 100` AND `c(s) ≤ −τ` floor | Library Drift 2026 |
| Bloat → retrieval precision collapse | Active-cap `C=50` + merge-at-admission (Trace2Skill merge op) | Library Drift; arXiv:2603.25158 |
| Silent drift invisible to pass-rate | Router-engagement % drift alarm | Library Drift 2026 |
| Decay deletes a critical safety rule | Two separate signals; PIN sovereign/kill_switch | FadeMem + Library Drift |
| Stale skills (royalty/FX/KYC/M-Pesa drift) | SkillOps health + **CGPD** upstream risk-propagation → preemptive re-version | SkillOps arXiv:2605.13716 |
| Catastrophic forgetting | Keep skills **non-parametric / external** — never fine-tune into weights | ATLAS 2025; ProcMEM arXiv:2602.01869 |
| Poisoned harvest into the library | Route through BP-1 re-ingestion scanner + ingress input-guard | (Borjie BP-1) |

---

## 3. Loop D — The central knowledge hub (tacit-knowledge harvest with provenance)

> **Requirement:** the MD harvests tacit human know-how — smoothly, in-flow, never as a
> form — into one central, provenance-tracked knowledge base with itself as the hub; every
> surface feeds and draws from the one brain.

### 3.1 What already exists (the substrate)

- **`packages/knowledge-graph/src/types.ts`** — `Node` + `Edge` + `ProvenanceRecord`
  (PROV-O binding: `activityKind ∈ {ingest, extract, infer, merge, manual_edit, import}`,
  `sourceUri`, `c2paSignatureId`, `aiModelId`, `capturedAt`, `citationBundleId`). Nodes/edges
  carry **bi-temporal** `validFrom/validTo` (real-world scope) + `recordedAt` (transaction
  time). `KGStorePort` = `upsertNode/upsertEdge/getNode/getNeighbors/match` (+ optional
  cypher/sparql).
- **`packages/knowledge-graph/src/provenance/prov-o.ts`** — `attachProvenance`,
  `hasProvenance`, `validateProvenance({strict})` (strict mode requires `derivedFrom` on
  every item).
- **`packages/knowledge-graph/src/temporal/bi-temporal.ts`** — `getStateAt(timestamp)`
  (rebuild the subgraph as known at a moment) + `compareStates(t1,t2)` (diff). This is the
  Zep/Graphiti *invalidate-not-delete* substrate (Rasmussen et al., *Zep*, arXiv:2501.13956,
  2025).
- **`packages/persistent-memory/src/consolidation/consolidator.ts`** —
  `createBrainConsolidator` extracts durable facts `{key, value, confidence}` from N turns
  (pluggable into the worker).
- **`packages/central-intelligence/src/kernel/consolidation/`** — `consolidation-cycle.ts`
  + fact-extraction prompts.
- **`packages/central-intelligence/src/kernel/reflexion/`** — verbal-gradient lessons
  written to episodic memory (`reflexion-writer.ts`, `reflexion-recorder.ts`).
- **`packages/central-intelligence/src/kernel/orchestrator/honest-confidence.ts`** (K-7) —
  calibrated uncertainty before a question fires; multi-junior debate to flag own gaps.

This is a GraphRAG-aligned, PROV-O, bi-temporal KG. The seam to fill is the **smooth
elicitation protocol** that *feeds* it and the **durable rule registry** it crystallizes into.

### 3.2 The KB schema with provenance (storage + trust spine)

Every harvested know-how item lands as a **bi-temporal, provenance-stamped fact** plus a
durable **versioned rule**. Two stores:

1. **The KG** (existing). Each fact = a `Node`/`Edge` with:
   - **WHO** said it — `ProvenanceRecord.activityKind='extract'`, `aiModelId=null` (human-sourced),
     plus a `wasAffirmedBy` edge to the source person `Node` (role + person_id).
   - The **verbatim utterance** it was anchored to — the **AEVS anchor** (Anchor → Extract →
     Verify → Supplement; MDPI Computers 15(3):178, 2026). **Store only what's grounded in a
     real span — never a paraphrase the MD can't ground.** A verification pass **rejects any
     fact not supported by its anchor** (kills plausible-but-fabricated facts).
   - **Three separate confidence dimensions** (Uncertain-KG survey, arXiv:2405.16929, 2024):
     `conf_extract`, `conf_source` (this source's reliability *for this fact*), `conf(source)`
     (overall source trust). **Never treat one model-emitted confidence as truth.**
   - **Bi-temporal scope** — `validFrom/validTo` (when the real-world fact held: royalty rate,
     offtake terms, assay grade) + `recordedAt` (when the MD learned it).

2. **`md_knowledge_rules`** (net-new migration, tenant-scoped) — the MUSE-Autoskill durable
   rule registry (arXiv:2605.27366): `id / version / name / description / condition[] / then[]
   / sources[] / confidence_per_source{} / source_uri / activity_kind / created_by_person_id /
   created_at / last_confirmed_at / archived_at`, **FK to KG nodes** so the rule is searchable
   by entity + class. Every harvested rule is versioned, test-gated, and decayable — the same
   lifecycle as Loop C skills (so D and C share one substrate).

### 3.3 The smooth in-flow elicitation protocol — when + how the MD asks

The frontier converges on one design: treat eliciting tacit knowledge as **staged,
value-gated, provenance-grounded active learning anchored on concrete incidents — never a
form.** A standalone "knowledge-capture wizard" is the **anti-pattern** the frontier
explicitly moves away from (CHI 2023 shop-floor, DOI 10.1145/3544549.3585755).

**WHEN it fires (the budget — the difference between a sharp colleague and HR):**

- **Uncertainty-gated** (ARIA, He et al., EMNLP 2025, arXiv:2507.17131; *deployed in TikTok
  Pay, 150M+ MAU*). The MD interrupts a person **only when** its self-estimated confidence on
  a decision is **low** (via K-7 `honest-confidence.ts`) **AND** the gap is **durable +
  high-decision-value** (it gates a pending recommendation or high-stakes workflow). This is
  the same **value-of-information** gate Loop B uses (Zhang/Knox/Choi ICLR 2025).
- **Epistemic, not aleatoric** (Calibrated Uncertainty Sampling, arXiv:2510.03162, 2025).
  Ask only when the gap is a *knowable the owner holds* (e.g. "who's your fallback assayer?"),
  not irreducible noise. **Calibrate the MD's confidence FIRST** — an uncalibrated model
  pesters about things it already knows. **Coverage-balance** across estate domains so it
  doesn't interrogate one site to death.
- **On a real moment the person is already living** (in-flow). Trigger off the
  **situational model** (`packages/central-intelligence/src/kernel/situational-model/`):
  just rejected a bid → "what tipped that?"; pump alarm cleared → "what told you it was the
  bearing?". One woven question, never a wizard.

**HOW it asks (the interview engine):**

- **Critical Decision Method (CDM)** — anchor on **one concrete non-routine incident**, then
  4 progressive sweeps over the *same* incident (Klein, Calderwood & MacGregor 1989; Hoffman
  et al., *Human Factors* 40(2), 1998): (1) unstructured narrative; (2) verified timeline,
  segmented into decision points; (3) at each point fire the probe taxonomy
  — **Cues / Knowledge / Analogues / Goals / Options / Basis / Situation-assessment**;
  (4) **counterfactual expert-novice contrast** ("what would a less-experienced person have
  missed?") — the **single highest-yield tacit probe**, baked in as a standing follow-up.
  Net-new brain-tool: `elicit.run(entityId, eventSummary)` runs the 4-sweep ladder *inline in
  chat*, each cue→judgement→action triple a KB candidate.
- **Laddering + repertory-grid micro-moves** (Shadbolt & Smart CTA literature). Three nested
  brain-tools turn ONE volunteered fact into a scoped subtree: `ladder_up(fact)` → goals/
  principles; `ladder_down(fact)` → instances/sub-rules; `ladder_across(fact)` → siblings/
  alternatives. `contrast_triad(a,b,c)` (repertory grid) presents three known cases and asks
  "how are two alike and the third different?" — surfacing the **owner's OWN discriminator
  vocabulary** (e.g. `buyer_reliability`), which becomes a typed ontology property, not an
  imposed taxonomy.
- **Staged SECI loop** (PKAI, *BISE* 2025, DOI 10.1007/s12599-025-00976-w): **socialize**
  (rapport/mirroring in natural chat) → **externalize** (emit a typed artifact destined for
  `md_knowledge_rules`) → **combine** (merge into the versioned library, **dedup/reconcile**)
  → **internalize** (the MD acts on it and surfaces it back as a learned shortcut).
- **Anti-interrogation eval** (ReqElicitGym, arXiv:2602.18306, 2026). Continuously score the
  MD's own elicitation turns for **follow-up relevance** and **anti-interrogation**; gate
  prompt changes on the score so the harvester stays a sharp colleague, never a checklist.

### 3.4 Validate, fold in, and handle contradiction (no overwrites, ever)

- **Validate** immediately after the answer with **AEVS anchoring** — reject any extracted
  fact not grounded in the verbatim utterance; **confirm-back** for critical/contradicting
  facts (Nurture-First crystallization, arXiv:2603.10808). **Ask-vs-infer:** ASK when
  domain-critical / assumption-heavy / contradicting prior learning; INFER (silently, at
  reduced confidence) only for low-consequence items matching established patterns.
- **Fold in via contradiction-scoped belief revision.** On `upsertNode/upsertEdge`, retrieve
  **only semantically-related neighbors on the SAME entity-pair/class** (near-O(1), not global
  O(n²)) and run an **LLM compare-for-contradiction** + WIRE SAT candidate + behavioral witness
  (Zep/Graphiti scoping, arXiv:2501.13956).
- **On contradiction: NEVER delete.** Set `validTo` on the old edge to the new edge's
  `validFrom`, create the new edge, **keep both** with PROV-O provenance + timestamps — the
  bi-temporal *invalidate-not-delete* discipline (matches CLAUDE.md *append-only* +
  *immutable-migrations*). When two **humans** disagree (site-manager vs owner on who approves
  a payout), **down-weight the less-reliable source** (`conf(source)` truth-discovery
  reweighting), keep both, and **escalate to the owner only if decision-value is high**.
- **Staleness / expiry.** Facts older than ~6 months without re-confirmation **decay in
  retrieval rank** but stay in the graph (`validTo` set). On re-confirmation, `validTo` clears
  and `recordedAt` updates. *"As the world changes"* requires expiry + re-confirmation, not
  just append — a fact true a year ago must not be acted on confidently today.

### 3.5 One brain — every surface feeds and draws from it

The four product surfaces (`admin-web`, `owner-web`, `workforce-mobile`, `buyer-mobile`) all
write into and read from the **one** KG hub. A foreman's pump-failure judgement on
workforce-mobile, an owner's bid-rejection rationale in owner-web chat, a buyer's settlement
preference in buyer-mobile — each lands as the same provenanced, bi-temporal fact keyed to the
same entities. The MD is the **hub**; institutional memory **survives turnover** because a
departed manager's facts stay `valid` until explicitly superseded (the bi-temporal property).
The corpus `tenant_id = NULL` ground-truth pattern means platform-wide rules are inherited by
every tenant.

---

## 4. Loop E — Self-spec'ing feature-requests to admin (MD proposal authoring)

> **Requirement:** when debate cannot close a **structural** capability gap, the MD authors a
> **fully-descriptive, evidence-backed feature-request** to the internal admin platform for
> Opus to build to **zero issues under governance** — and the originating gap **auto-completes
> on ship.**

The frontier shape (Darwin Gödel Machine arXiv:2505.22954; SICA arXiv:2504.15228; Absolute
Zero arXiv:2505.03335; ACE arXiv:2510.04618; SWE-agent NeurIPS 2024): **per-failure
distillation → append-only counter-weighted archive grown by DELTA edits → learnability
filter → LLM authors a test-paired problem-statement → build agent codes to GREEN vs
externally-verified tests.** Decisive lesson: **SCORING and GROUNDING, not prompting** —
**never self-grade**, accept only via external verification, delta-update to avoid context
collapse.

### 4.1 What already exists (the substrate)

- **`services/api-gateway/src/routes/admin/control-plane.hono.ts`** — the Borjie-internal
  control plane; platform feature flags + LLM-routing config; `requireRole(SUPER_ADMIN | ADMIN)`;
  **NEVER writes sovereign/kill_switch/four_eye** (those live in policy-gate). The governance
  precedent for the new routes.
- **`services/api-gateway/src/routes/admin/tenant-jurisdiction.hono.ts`** +
  **migration `0322_jurisdiction_proposals.sql`** — the **four-eye** propose→approve flow
  (`proposed_by_user_id` ≠ `decided_by_user_id`, both captured for audit; service-role bypass
  + tenant-isolation RLS). The structural template for `platform_feature_requests`.
- **`packages/workflow-engine/`** — `WorkflowDefinition` (`aiReviewRequired`,
  `humanApprovalRequired`) + `WorkflowRun` (`open → in_progress → in_review → in_approval →
  committed | rejected`), event-sourced, every transition hash-chained.
- **Migration `0323_module_spawning_registry.sql`** — runtime DDL compilation + `ddl-guard`
  + four-eye gate for schema changes (the structural-extension path).

### 4.2 The feature-request proposal schema

Spec under-specification dominates SWE failures (~42% bad specs, ~22% misinterpretation;
SWE-bench). So the schema is **fully-descriptive** and **test-paired** by construction.
Net-new migration `0326_platform_feature_requests.sql` (**scope = global only, NOT per-tenant**,
platform-metadata, service-role-only RLS, mirroring 0320/0322):

| Field | Purpose / SOTA grounding |
|---|---|
| `id`, `title`, `description` | The CREATOR abstract **PLAN**, not implementation (CREATOR, EMNLP 2023; plan/impl split) |
| `problem_statement` | User-need + business value: *what is the gap, how did we discover it* (the failed trajectory) |
| `capability_gap_kind` | `'skill_induction' \| 'knowledge_ingest' \| 'structural_capability' \| 'schema_extension'` — routed by **multi-junior debate** (Feng et al. 2024), never lone introspection |
| `affected_files` | JSONB array of paths/tables that must change — **validated against the source tree** (grep) or `ddl-guard` tokens. Sourced from codemaps (`Docs/CODEMAPS/INDEX.md`). Missing affected-files yields passing-but-wrong patches. |
| `acceptance_criteria` | JSONB array of **executable conditions, each referencing a test-file path** — **≥3 concrete test cases** or the proposal is **rejected as under-specified** |
| `evidence_ids` | JSONB array of audit-chain IDs backing the gap detection (`audit_id \| LMBM_support_case_id \| intelligence_corpus_chunk_id \| ai_audit_chain.id`) — **≥1 required, fail-closed** |
| `status` | `'open' \| 'in_development' \| 'approved' \| 'merged' \| 'rejected'` |
| `proposed_by_md` (bool) / `proposed_by_user_id` | MD-authored (default) or human-authored |
| `proposed_at` / `accepted_by_opus_at` / `merged_at` | lifecycle timestamps |
| `audit_hash` | hash-chained via `AuditChainPort` (`event_kind: feature_request.propose/approve/merge`) |

### 4.3 The authoring brain-tool: `feature_request.author()`

Net-new in `packages/central-intelligence/src`. Input: `gap_type` (from the classifier),
`trajectory` (the failed trace), `failed_turns` (which turns failed + why). Output: a typed
`FeatureRequest` registered to DB. **Fail-closed constraints:**

1. Every field **must cite ≥1 `evidence_id`** (reuse K-7 evidence-required pattern;
   `honest-confidence.ts`).
2. `acceptance_criteria` **must include ≥3 concrete test cases + file paths**, else reject.
3. `affected_files` **must exist** in the source tree (grep) or be valid schema tables
   (`ddl-guard` token inspection).
4. `capability_gap_kind` is **routed by `debate.run`** with Haiku judges
   (`packages/central-intelligence/src/kernel/debate/`) — procedural vs knowledge vs structural.
5. **Learnability filter** (Absolute Zero, arXiv:2505.03335): escalate only when
   `learnability = recurrence × marginal-NOI-lift × tractability`, **zeroed** for
   already-solved or out-of-scope gaps — or the admin platform gets spammed.

The proposal body is a **SWE-agent-consumable issue** (SWE-agent, NeurIPS 2024;
mini-swe-agent 2025 >74% SWE-bench-Verified): problem + affected-files + executable acceptance
criteria. **Zero-issues = pass generated tests AND all repo gates** (typecheck, RLS/security,
migration-safety, evidence-required, no-console.log).

### 4.4 The governance gate — the MD cannot go rogue

The load-bearing structural rule: **the brain that proposes self-edits must never validate,
judge, and build them — no author-and-merge** (separation of powers; AgentCity arXiv:2604.07007;
Constitutional AI 2022; Intercom AI-files-ticket 2025). Borjie has most of the substrate; the
gap is **one mandatory external governance ring the brain cannot route around.**

Net-new admin routes (mounted in `services/api-gateway/src/routes/admin/`, mirroring
`tenant-jurisdiction.hono.ts`):

- **`POST /api/v1/admin/feature-requests`** (service-role auth): the MD auto-proposes via
  `feature_request.author()`, writing `status='open'`. **Proposer = MD (always auto).**
- **`GET /api/v1/admin/feature-requests?status=open`** (`requireRole(ADMIN)`): **Opus** (the
  admin Auditor role, **manual**) reviews — summary + acceptance criteria visible, evidence
  links followable.
- **`PUT /api/v1/admin/feature-requests/{id}/approve`** (`requireRole(ADMIN)`): Opus approves
  → `status='in_development'` → triggers GitHub issue creation. **Decider = Opus (manual).**

**Safeguards (fail-closed):**

- **Sovereignty gate:** proposals touching `sovereign_approvals / policy_* / kill_switch_*`
  tables **auto-reject** — *"Schema change touches sovereign table; blocked by hard rule"*
  (extends the control-plane.hono.ts sovereign-block precedent).
- **Evidence audit:** the Auditor reads `evidence_ids` and **spot-checks ≥1 exists in
  `ai_audit_chain`** — if any is missing, reject *"Evidence chain incomplete"*.
- **Anti-self-serving / scope-creep:** the **learnability filter** + **rate-limiting** stop
  backlog flooding; the **meta-policy stays outside the MD's self-edit reach** (archive,
  selection, promotion rules, HIGH-risk prefixes — DGM lesson: a variant gamed a metric by
  deleting its own markers, caught via **out-of-band lineage**; keep markers out-of-band and
  any self-instrumentation edit four-eye).
- **Inoculation** (Anthropic, arXiv:2511.18397, 2025): recontextualize legitimate aggressive
  actions as sanctioned (defection-probe + honest-confidence stay load-bearing).
- **Shadow/canary for structural proposals** (AgentSpec runtime gates, ICSE 2026,
  arXiv:2503.18666): HIGH-risk proposals require human sign-off; re-run defection/sycophancy
  probes per wave; rollback on regression (misevolution guardrails, arXiv:2509.26354).

### 4.5 GitHub hand-off + auto-complete-on-ship (closing the loop)

- On approval, the MD serializes the `FeatureRequest` to a **GitHub Issue**: title +
  problem_statement + affected_files + acceptance_criteria (markdown), labels
  `generated-by-md`, `capability-gap-${kind}`, `feature-request`; acceptance tests written to
  a `.test.ts` in the affected package. **SWE-agent (mini-swe-agent) consumes it**: localize →
  patch → run tests → self-reflect → refine. On **merge** (tests GREEN + repo gates pass),
  `status='merged'`, `merged_at=now`.
- **Auto-complete (the blocker-clear event that ties E back to the metacognitive register):**
  a **GitHub webhook** (`@borjie/agent-platform` webhook port) fires `skill-complete`:
  1. detect which skill/rule vacancy the PR closed (match `affected_files` against known gaps);
  2. generate the corresponding `Skill` and register it at `status='tested'` (**skipping
     `observed`** because acceptance tests already validated it — Loop C self-verification was
     done by the build);
  3. emit a **reflexion lesson** ("we built a feature-request for [gap]; this closes it");
  4. resolve the originating `md_commitments` Loop-A row (auto-resume on blocker-clear).

This is the **capability-gap loop closing on itself**: a structural gap the MD could not
self-resolve becomes a governed feature-request, a human approves, Opus builds to green, the
ship event auto-registers the new skill and writes the lesson — and the register that parked
the gap marks it done.

---

## 5. Integration with existing organs — what exists vs net-new

| Concern | Already exists (path) | Net-new |
|---|---|---|
| Skill library (Voyager) | `packages/persistent-memory/src/skill/{skill-registry,skill-decay,skill-composer}.ts`, `types.ts` (`Skill`) | `skill.promote` self-verification wrapper; contribution-score evidence log + Ratchet retirement (Nmin/τ/cap); `state` field + shadow/canary/live machine; pgvector embedding index + precondition-match retrieval; PIN-list for sovereign rules |
| Crystallization / consolidation | `consolidator.ts`; `kernel/consolidation/`; `reflexion/sleep/nightly-sleep.ts` | Impasse instrumentation + AWM workflow-induction (≥3-trial gate); quality-filter + merge-near-duplicates at admission |
| Knowledge hub (KG + PROV-O + bi-temporal) | `packages/knowledge-graph/src/{types.ts, provenance/prov-o.ts, temporal/bi-temporal.ts}` | Contradiction-scoped belief-revision (semantic-neighbor retrieve + LLM compare + WIRE SAT + behavioral witness); `validTo`-invalidation write-path; staleness/expiry decay; `md_knowledge_rules` table + FK to KG nodes |
| Elicitation | situational-model (`kernel/situational-model/`); K-7 `kernel/orchestrator/honest-confidence.ts`; `kernel/debate/` | brain-tools `elicit.run` (CDM 4-sweep), `ladder_up/down/across`, `contrast_triad`; ReqElicitGym anti-interrogation eval |
| Confidence gate (own-gap flag) | `honest-confidence.ts` (K-7); Auditor `packages/ai-copilot/src/juniors/auditor-agent.ts` | gap classifier routing via debate (procedural/knowledge/structural) |
| Feature-request governance | `routes/admin/control-plane.hono.ts`; `routes/admin/tenant-jurisdiction.hono.ts`; `0322_jurisdiction_proposals.sql`; `workflow-engine`; `0323_module_spawning_registry.sql` + `ddl-guard` | migration `0326_platform_feature_requests.sql`; brain-tool `feature_request.author`; 3 admin routes (propose/list/approve); GitHub issue serializer + webhook `skill-complete` consumer |
| Durable register / auto-resume | `0321_md_commitments.sql`; `EstateMind.tick()` RECONCILE | `gap_kind='structural'` rows feeding E; merge-event → resolve |
| Audit / evidence discipline | hash-chained `AuditChainPort`; evidence-required Auditor | new `event_kind`s: `feature_request.{propose,approve,merge}`, per-skill contribution log |

---

## 6. Phased, buildable plan (each phase independently shippable + verifiable)

| Phase | Ships (smallest real loop) | Organs touched (paths) |
|---|---|---|
| **P0 — Minimal real C loop** | Impasse instrumentation on `findByIntent` miss + AWM induction; `skill.promote` self-verification wrapper (Auditor + ≥1 evidence_id) gating `observed→tested`; pgvector embedding column + cosine retrieval with precondition-match filter. **Verifiable:** MD crystallizes a skill from 3 evidence-cited successes, then *reuses* it on the next matching task. | `persistent-memory/src/skill/*`, `types.ts`; migration adds `embedding VECTOR(1536)` + `contribution_score`; `ai-copilot/.../auditor-agent.ts` |
| **P1 — Ratchet + safe-update** | Per-skill append-only contribution log; retirement gate (`Nmin=100 ∧ c(s)≤−0.10`); active-cap `C=50` lowest-contribution eviction; meta-authoring prior in junior prompts; `state` field + shadow→canary→ramp with auto-revert; router-engagement % OTel alarm; **PIN** sovereign/kill_switch out of decay+retirement. | `skill-decay.ts`, new `skill-contribution.ts`, `skill-state-machine.ts`; nightly-sleep pass; OTel |
| **P2 — Minimal real D loop** | `md_knowledge_rules` table (FK to KG nodes); `elicit.run` CDM 4-sweep brain-tool fired uncertainty-gated off situational model + K-7; AEVS anchor-validate + confirm-back; PROV-O + 3-confidence stamp. **Verifiable:** MD elicits a rule from the owner in-flow, anchors it to the verbatim span, and *applies it next turn with provenance shown*. | new migration; `knowledge-graph`; new brain-tools; `situational-model`, `honest-confidence.ts` |
| **P3 — D contradiction + harvest depth** | `ladder_up/down/across` + `contrast_triad`; contradiction-scoped belief-revision (semantic-neighbor + LLM compare + WIRE SAT + witness); `validTo`-invalidation write-path; staleness decay + re-confirmation; consolidator quality-filter + merge-near-duplicates; ReqElicitGym anti-interrogation eval gating prompt changes. | `knowledge-graph/{temporal,provenance}`, `consolidator.ts`, new eval harness |
| **P4 — Minimal real E loop** | migration `0326_platform_feature_requests.sql`; `feature_request.author()` (debate-routed gap_kind, ≥3 acceptance tests, affected-files grep-validated, ≥1 evidence_id); 3 admin routes (propose/list/approve) with four-eye + sovereignty gate + evidence spot-check; learnability filter + rate-limit. **Verifiable:** MD files a real-gap feature-request; a human approves; Opus builds to green. | `api-gateway/routes/admin/*`, `central-intelligence`, `workflow-engine`, `ddl-guard` |
| **P5 — E auto-complete + close the loop** | GitHub issue serializer (labels + `.test.ts`); webhook `skill-complete` consumer (detect vacancy → register skill at `tested` → reflexion lesson → resolve `md_commitments` Loop-A row); CGPD upstream risk-propagation for stale-skill re-version; SkillRevise diagnose→revise→select rollback. **Verifiable:** on PR merge, the originating gap auto-completes end-to-end. | `agent-platform` webhook port, `persistent-memory`, `md_commitments`, `reflexion` |

Each phase is independently shippable: P0 alone gives a self-verifying reusable library; P2
alone gives provenanced harvest; P4 alone gives governed proposals. P5 fuses them into the
closed capability-gap loop with the metacognitive register.

---

## 7. Self-tests — proving each loop is genuinely real

**C — crystallize-and-reuse.** Drive 3 distinct, evidence-cited successful resolutions of the
same impasse-state (e.g. a Tanzania royalty filing for 3 sites). Assert: (a) a `Skill` is
registered at `observed` only after the 3rd, with the Auditor having passed and `evidence_ids`
non-empty; (b) `skill.promote` moves it `observed→tested` only with a held-out check + ≥1
evidence_id (a no-evidence trial is *rejected*); (c) the next matching task retrieves it by
cosine + precondition-match and *executes the cached skill* rather than re-deriving.

**C — anti-rot ratchet.** Seed a skill with 120 trials and `c(s) = −0.15`; assert it retires.
Seed an identical skill with 40 trials and `c(s) = −0.5`; assert it **does NOT** retire (Nmin
floor). Seed a sovereign-prefixed rule with `salience≈0`; assert it is **neither decayed nor
retired** (PIN). Overflow the cap to 51; assert the lowest-contribution skill is evicted.
Drop router-engagement to 19% in a fixture; assert the OTel drift alarm fires.

**C — safe-update + rollback.** Re-version a working royalty workflow with a "looks-better"
rewrite whose real utility is *lower*; assert it stays in **shadow**, never enacts, and the
select-argmax-over-rounds returns the **incumbent** (rollback). Assert a sovereign re-version
**cannot exit shadow** without human sign-off.

**D — elicit-and-apply with provenance.** Owner rejects a bid in owner-web chat; assert
`elicit.run` fires (K-7 confidence low + high decision-value), runs a CDM probe, **anchors**
the answer to the verbatim span (an un-anchored fabrication is *rejected* by AEVS validation),
writes a `Node` + `wasAffirmedBy` person edge + `ProvenanceRecord` (`activityKind='extract'`,
`aiModelId=null`) + a `md_knowledge_rules` row, and that the MD **applies the rule next turn
with the provenance citation visible**.

**D — contradiction without overwrite.** Site-manager says "Buyer Ltd is settlement-reliable";
owner later says "Buyer Ltd defaulted last month". Assert the old edge is **invalidated
(`validTo` set), not deleted**; both survive with PROV timestamps; `conf(source)` reweights;
and (high decision-value) it **escalates to the owner**. Assert `getStateAt(t_before)` still
returns the old belief.

**E — file → approve → build → auto-complete.** Force a structural gap debate cannot close
(e.g. no organ can compute a required ESG metric). Assert `feature_request.author()` produces a
record with ≥3 acceptance tests + grep-validated affected_files + ≥1 evidence_id (an
under-specified attempt is *rejected*); a sovereign-table proposal **auto-rejects**; a second
admin (≠ proposer) approves via the four-eye route; on PR merge the webhook fires
`skill-complete`, the new skill registers at `tested`, a reflexion lesson is written, and the
originating `md_commitments` row resolves. Assert the MD **cannot approve its own proposal**
(no author-and-merge).

**Fusion (composes with the metacognitive dossier).** A structural gap parked by Loop A
(`gap_kind='structural'`) must surface in E's proposal queue; its merge must auto-resume the
exact Loop-A row — proving the gap register feeds E and E's ship closes the register.

---

## 8. Governance / safety pitfalls and mitigations

| Pitfall | Mitigation (grounded) |
|---|---|
| **Self-grading** (the cardinal failure — all systems require an external verifier) | Auditor + evidence-chain gate every minted skill *and* every self-generated task; `skill.promote` rejects empty `evidence_ids` (Feng et al. 2024; Voyager) |
| **Library decays below no-skill baseline / erosion / bloat / silent drift** | Ratchet Recipe: `Nmin≥100 ∧ c(s)≤−τ` retirement, active-cap, meta-prior, router-engagement alarm (Library Drift 2026) |
| **Decay deletes a critical safety rule** | Two separate signals (salience≠contribution); PIN sovereign/kill_switch/four_eye/compliance out of both (FadeMem + Library Drift) |
| **Workflow/skill conditioning harms** (irrelevant skills fire; injected used in only 18.5%) | Tight precondition-matched injection + always-available no-skill fallback (AWM 2024) |
| **Verifier/validator mismatch overfits** "ran without error" | Validators = real regulatory/financial postconditions, consumed at plan-time selection (SkillOps; SkillRevise) |
| **Cost/efficiency regressions hide behind success** | Re-version scores efficiency + interface-change cost; select-argmax-over-rounds; never auto-promote latest (SkillRevise) |
| **Stale skills as world changes** (royalty/FX/KYC/M-Pesa drift) | SkillOps health + CGPD upstream risk-propagation → preemptive re-version before production failure |
| **Tacit harvest misattribution / false-confidence inference** | AEVS anchor (store only grounded spans) + per-source/per-fact confidence + confirm-back for critical/contradicting; silent infer only low-consequence (Nurture-First; Uncertain-KG) |
| **Overwriting on contradiction destroys provenance** | Bi-temporal invalidate-not-delete; keep both with PROV; reweight source; escalate only high-value (Zep/Graphiti) |
| **Catastrophic forgetting via fine-tuning** | Keep skills/rules **non-parametric/external**; never bake into weights (ATLAS; ProcMEM) |
| **Author-and-merge / approval fatigue / backlog flooding** | Separation of powers (MD proposes, ≠-admin Opus decides); learnability filter; rate-limit; meta-policy outside MD's self-edit reach (AgentCity; DGM) |
| **Reward-hacking generalizes to sabotage; self-instrumentation gaming** | Out-of-band immutable lineage markers; four-eye on self-instrumentation edits; inoculation prompting; defection/sycophancy probes per wave (DGM; arXiv:2511.18397; 2509.26354) |
| **Spec under-specification** (~42% of SWE failures) | Schema-enforced ≥3 acceptance tests + grep-validated affected_files + abstract-plan body; reject under-specified (SWE-bench; CREATOR) |
| **Pathological looping** | Asynchronous overseer/watchdog (timeouts, repeated-action detection) + kill-switch fail-closed |
| **Poisoned/redundant harvest into the library** | Evidence-required validation + quality+merge filter + BP-1 re-ingestion scanner + ingress input-guard; uncertainty-gated (never blanket-elicit) |

---

## References (inline-cited above)

Kadavath et al., *Language Models (Mostly) Know What They Know*, arXiv:2207.05221 (2022) ·
Zhang, Knox & Choi, *Modeling Future Conversation Turns…*, ICLR 2025, arXiv:2410.13788 ·
Wang et al., *Voyager*, NeurIPS 2023, arXiv:2305.16291 · Park et al., *Generative Agents*,
UIST 2023, arXiv:2304.03442 · Laird, *Soar* / Anderson, *ACT-R*, cf. arXiv:2201.09305 ·
Wang/Zhou/Fried, *Agent Workflow Memory*, 2024, arXiv:2409.07429 · *SkillOps*, 2026,
arXiv:2605.13716 · *SkillRevise*, 2026, arXiv:2606.01139 · *LATM*, ICLR 2024, arXiv:2305.17126 ·
*CREATOR*, EMNLP 2023 · *Nurture-First*, 2026, arXiv:2603.10808 · *Tacit Knowledge Discovery*,
2025, arXiv:2507.03811 · Feng et al., *Don't Hallucinate, Abstain*, ACL 2024, arXiv:2402.00367 ·
*Line of Duty*, 2025, arXiv:2503.11256 · *Beyond IDK*, 2026, arXiv:2604.17293 ·
Zhang et al., *Library Drift*, 2026, arXiv:2605.19576 · Yan/Chen/Zhang, *WIRE*, 2026,
arXiv:2605.27784 · He et al., *ARIA*, EMNLP 2025, arXiv:2507.17131 · *FadeMem* arXiv:2601.18642,
*FOREVER* arXiv:2601.03938, *FSFM* arXiv:2604.20300 (2026) · *Trace2Skill* arXiv:2603.25158,
*ProcMEM* arXiv:2602.01869 (2026) · *ATLAS* (Jaglan & Barnes, 2025); Meta Sparse Memory FT
(Oct 2025); arXiv:2511.01093 · Klein/Calderwood/MacGregor (1989); Hoffman et al.,
*Human Factors* 40(2) (1998) · Shadbolt & Smart (CTA) · *PKAI*, BISE 2025,
DOI 10.1007/s12599-025-00976-w · *MUSE-Autoskill*, 2026, arXiv:2605.27366 ·
*Calibrated Uncertainty Sampling*, 2025, arXiv:2510.03162 · *AEVS*, MDPI Computers 15(3):178
(2026); *Uncertainty Management in KGs survey*, arXiv:2405.16929 (2024) · CHI 2023 shop-floor,
DOI 10.1145/3544549.3585755; *ReqElicitGym*, 2026, arXiv:2602.18306 · Rasmussen et al., *Zep*,
arXiv:2501.13956 (2025) + Graphiti · KARMA (NeurIPS 2025); *Knowledge Conflicts for LLMs*,
EMNLP 2024, arXiv:2403.08319 · Edge et al., *GraphRAG*, 2024, arXiv:2404.16130 ·
Shinn et al., *Reflexion*, NeurIPS 2023, arXiv:2303.11366 · *Match, Compare, or Select?*,
COLING 2025, arXiv:2405.16884 · W3C PROV-DM/PROV-O (2013) · *Darwin Gödel Machine*, 2025,
arXiv:2505.22954; *SICA*, 2025, arXiv:2504.15228 · *Absolute Zero Reasoner*, 2025,
arXiv:2505.03335 · *Agentic Context Engineering (ACE)*, 2026, arXiv:2510.04618 ·
*SWE-agent*, NeurIPS 2024 + mini-swe-agent (2025) · *AgentSpec*, ICSE 2026, arXiv:2503.18666 ·
*AgentCity*, 2026, arXiv:2604.07007; Constitutional AI (2022) · Inoculation prompting,
arXiv:2511.18397 (2025) · *Your Agent May Misevolve*, 2025, arXiv:2509.26354.
