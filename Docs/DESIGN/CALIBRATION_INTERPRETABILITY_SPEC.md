# Calibration + Mechanistic Interpretability — Specification

> **Status**: design-locked
> **Wave**: 18BB-gap (P0 #5 closer)
> **Owner**: Mr. Mwikila platform team
> **Companion packages**: `@borjie/calibration-monitor`, `@borjie/sae-probe`
> **Companion migration**: `0037_calibration_interpretability.sql`
> **References**: Anthropic Constitutional AI, Anthropic SAE work
> ("Towards Monosemanticity"), Goodfire SAE probing toolkit,
> Niculescu-Mizil & Caruana — Brier/ECE foundations.

---

## 1. Why this exists

Mr. Mwikila (MD-tier autonomous reasoner) routinely tags outputs
with a self-declared `confidence` value — for example, when issuing
a mining-licence renewal recommendation, a buyer-credit decision,
or an ore-grade interpretation. Founders, regulators and downstream
governance systems consume that signal as if it were trustworthy.

The problem: **a self-declared confidence is worthless without a
feedback loop that measures whether it is actually right that often**.
A model that says "I am 0.9 confident" should be correct ~90% of the
time on outputs of that confidence bucket. If it is correct only 60%
of the time, the model is **mis-calibrated**: a known and serious
failure mode of every production LLM. Constitutional AI peers
(Anthropic, OpenAI, DeepMind) run continuous calibration monitoring
in production. Ours has been spec-only — this wave closes that gap.

A parallel gap exists on **interpretability**. When Mr. Mwikila
returns a result, governance has no way to read its hidden state
for early warning signals — deception, hallucination, bias,
sycophancy. Sparse autoencoders (SAEs) are the SOTA tool here:
Anthropic's "Towards Monosemanticity" line shows that single
high-firing SAE features reliably correspond to interpretable
concepts. We will not train SAEs in this wave (that is a Phase 2
GPU effort) but we **must** lay the runtime probe + storage so the
training output drops in without re-architecture.

The founder directive said it plainly: "No calibration or SAE-probe
interpretability layer — Constitutional AI is in production at peers,
ours is spec-only. Closes P0 #5."

This document specifies both layers. They are deliberately built as
two independent packages because they answer two different
questions: calibration asks *"is the model honest about its
uncertainty?"* and interpretability asks *"what is the model
actually thinking?"*.

---

## 2. Brier score & Expected Calibration Error — definitions

### 2.1 Brier score

For a binary outcome `y ∈ {0, 1}` and a predicted probability
`p ∈ [0, 1]`:

```
Brier(p, y) = (p − y)²
```

The mean Brier score over `N` observations is `(1/N) · Σ (pᵢ − yᵢ)²`.
Lower is better. A perfect oracle has `Brier = 0`. A maximally
uninformed model that always predicts `0.5` against a balanced
outcome has `Brier = 0.25`. A confidently-wrong model approaches
`Brier = 1.0`.

Brier rewards both **calibration** (the right probabilities) and
**resolution** (probabilities that separate positives from negatives).
It is **proper**: optimised in expectation only when the model
reports its true belief.

### 2.2 Expected Calibration Error (ECE)

ECE measures the gap between confidence and accuracy after binning.
Partition `[0, 1]` into `K` bins (default `K = 10`). For each bin
`b`, let `accᵦ` be the empirical accuracy of predictions whose
confidence falls in `b`, and `confᵦ` the mean confidence in `b`.
Let `|Bᵦ|` be the bin's sample count and `N` the total.

```
ECE = Σᵦ (|Bᵦ| / N) · |accᵦ − confᵦ|
```

A perfectly calibrated model has `ECE = 0`. A model that says "0.9
confident" but is only right 60% of the time contributes `0.3`
mass-weighted into that bin.

We compute **both** Brier and ECE in every weekly report because
Brier alone can hide systematic bias and ECE alone can hide poor
resolution.

### 2.3 Reliability diagram

A side artefact of ECE: a `K × 3` table of `(bin_lower, mean_conf,
mean_acc)` rows. Visualised as a diagonal scatter — a calibrated
model hugs `y = x`. The diagram is persisted alongside the report so
the founder can see *where* calibration fails (e.g. over-confident in
the 0.8–0.9 band).

---

## 3. Continuous calibration loop

The loop is **observe → resolve → aggregate**.

### 3.1 Observe (write-time)

Every Tier-1+ Mr. Mwikila output that carries a `confidence` value is
written into `calibration_observations` at decision time. Tier-1+
covers: mining licence recommendations, buyer credit decisions,
mutation proposals, regulatory filings, marketplace bids. The
observation record is **immutable** at this point — only the
resolution column is later mutated by the resolver (and the
mutation goes through the audit chain).

Schema:

| column                | type         | role |
|-----------------------|--------------|------|
| `id`                  | uuid PK      | row id |
| `tenant_id`           | text         | RLS scope |
| `prediction_kind`     | text         | e.g. `mining_licence_renewal` |
| `entity_id`           | text         | foreign id |
| `predicted_confidence`| numeric(4,3) | `p ∈ [0,1]` |
| `predicted_label`     | text         | what was predicted |
| `outcome_label`       | text         | resolved later |
| `outcome_value`       | numeric(1)   | 0 / 1 once resolved |
| `resolved_at`         | timestamptz  | nullable until resolved |
| `created_at`          | timestamptz  | now() |
| `audit_hash`          | text         | chain link |

### 3.2 Resolve (eventual)

A resolution arrives later from one of three sources:

1. **Owner approval / rejection** — the founder or designated
   approver clicks accept or reject in the approval matrix. Accept
   ⇒ `outcome_value = 1`, reject ⇒ `0`.
2. **Real-world outcome** — for time-bounded predictions, a worker
   reads the actual outcome (licence granted, payment cleared, ore
   shipment matched grade ± tolerance) and writes back.
3. **Manual ground-truth backfill** — analyst tooling for
   retrospective calibration analysis.

The `outcome-resolver` module is idempotent on
`(tenant_id, entity_id, prediction_kind)` and rejects any double
resolution attempt with a different value.

### 3.3 Aggregate (weekly)

Every Sunday `02:00 UTC` a cron triggers
`weekly-report-generator.generate()`. It reads all observations
resolved in the prior 7 days, computes Brier + ECE + reliability
diagram per `(tenant_id, prediction_kind)`, and writes one row to
`calibration_weekly_reports`. The report is then surfaced in the
founder digest with explicit numbers and a delta-vs-prior-week.

Operational rule: if `ECE > 0.10` for any production
`prediction_kind`, the corresponding action surface is **soft-paused**
(human-in-the-loop required) until the next weekly report shows
recovery. This is the closed loop that makes the layer real.

---

## 4. SAE probe — mechanistic interpretability

### 4.1 What an SAE is, in one paragraph

A sparse autoencoder is trained on the hidden activations of a model
(say, layer 24 of Mr. Mwikila's transformer backbone). It learns a
dictionary of features such that any activation can be reconstructed
as a sparse linear combination of those features. Each feature
typically corresponds to a single human-interpretable concept —
"deceptive evasion", "the user is being sycophantic", "mention of a
specific entity", "internal contradiction detected". Once trained,
the SAE is run *forward* over live activations as a probe: features
that fire above a threshold get logged, and downstream policy can
react.

### 4.2 In-scope for this wave

- The **runtime probe contract** (`feature-detector.ts`) — a pure
  function `(activation_vector, feature_dictionary) → fired_features[]`.
- The **threshold policy** — per-feature thresholds, decay,
  per-tenant overrides.
- The **storage layer** — `sae_probe_features` table to persist
  feature-firing events for audit + later analysis.
- An in-memory **placeholder feature dictionary** for tests so the
  package compiles, lints, and tests cleanly.

### 4.3 Out-of-scope (Phase 2)

- Actually **training** the SAE — this requires GPUs, a captured
  activation dataset, and an SAE training pipeline (anthropic-circuit-
  tracer or goodfire-ember style).
- Per-tenant SAEs — Phase 2 will train tenant-specific feature banks
  once we have enough capture data.
- Auto-react policies — once features fire, what to do (block,
  re-prompt, escalate) is a separate governance question routed
  through `@borjie/autonomy-governance`.

### 4.4 Sensitive feature categories (target inventory)

The Phase 2 SAE training will explicitly chase features in these
categories. Listed here so the dictionary contract is clear:

- `deception` — the model is suppressing internal disagreement
- `hallucination` — confabulated fact about a tenant entity
- `bias` — disparate-impact-style reasoning leak
- `sycophancy` — surface agreement masking internal disagreement
- `prompt_injection` — adversarial input recognition
- `self_reference` — model talking about its own role
- `confidentiality_leak` — about to emit cross-tenant data

---

## 5. Database schema (migration 0037)

Three tables, all RLS-tenant-scoped using the canonical
`app.tenant_id` GUC pattern from migration 0003. All writes go
through the audit chain.

### 5.1 `calibration_observations`

Append-only at create time; the resolution columns are filled in by
the `outcome-resolver`. Composite uniqueness on
`(tenant_id, prediction_kind, entity_id)` so a duplicate observe is
idempotent.

### 5.2 `calibration_weekly_reports`

One row per `(tenant_id, prediction_kind, report_period)`. Stores
`brier_score`, `ece`, `sample_size`, `reliability_diagram_json`
(jsonb), and `report_period_start`/`end`. Indexed by
`(tenant_id, prediction_kind, report_period_start DESC)`.

### 5.3 `sae_probe_features`

One row per fired feature per probe call. Stores `tenant_id`,
`session_id`, `turn_id`, `feature_id`, `feature_label`,
`activation_strength`, `threshold_at_time`, `detected_at`,
`audit_hash`. Indexed by `(tenant_id, feature_label, detected_at DESC)`
and `(tenant_id, session_id, detected_at)`.

---

## 6. Anti-patterns (explicitly forbidden)

1. **Self-resolution** — the model resolving its own predictions
   without an external signal. Always fails calibration in toy ways.
   The resolver MUST receive its outcome label from an external
   source (owner, sensor, deterministic worker).
2. **Bin-tuning** — choosing `K` after seeing the data to make ECE
   look small. `K = 10` is fixed in code and only overridable via
   a tenant feature flag with a written justification.
3. **Resolution backdoor** — overwriting an existing resolved row
   silently. The resolver must reject conflicting resolutions and
   raise an alert.
4. **Confidence floor** — capping the model's reported `confidence`
   at, say, `0.95` so it never gets penalised for being very wrong.
   Calibration depends on the model being free to say `0.99`.
5. **Cross-tenant features** — running an SAE feature trained on
   tenant A against tenant B. Phase 2 enforces a per-tenant feature
   bank; this wave's probe contract already namespaces by tenant.
6. **Auto-acting on a single fired feature** — features fire stochastically.
   Auto-action requires either repeated firing in a window or a
   composite of features (governed in `autonomy-governance`).

---

## 7. Phase 2 (deliberately deferred)

- Train the first SAE over captured layer-24 activations from one
  month of Mr. Mwikila traffic.
- Add a fine-tuning loop that uses calibration error as a training
  signal (temperature scaling first; only then full SFT).
- Train tenant-specific SAEs once each tenant accumulates ≥ 100k
  activation captures.
- Surface live SAE features in the agent observability dashboard.
- Wire the SAE probe → autonomy-governance pipeline so a fired
  `confidentiality_leak` feature soft-stops a turn.

---

## 8. Acceptance checklist (this wave)

- [x] `@borjie/calibration-monitor` package compiles with
      `strict: true`, zero `@ts-nocheck`, tests passing.
- [x] `@borjie/sae-probe` package compiles with `strict: true`,
      zero `@ts-nocheck`, tests passing.
- [x] Migration `0033_calibration_interpretability.sql` creates 3
      RLS-scoped tables.
- [x] Drizzle schema file exported from `@borjie/database` barrel.
- [x] No mutation of existing files outside the schema barrel.
- [x] Spec lives in `Docs/DESIGN/CALIBRATION_INTERPRETABILITY_SPEC.md`.

This wave is intentionally narrow: it lays the **substrate** so the
next wave can plug in the trained SAE and the temperature-scaling
fine-tune without changing any of the contracts described above.
