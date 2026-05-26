# Language Self-Improvement Loop — Specification

> Wave 19K. Companion package: `packages/language-self-improve/`.
> Companion migration: `packages/database/drizzle/0052_language_self_improve.sql`.
> Companion schema: `packages/database/src/schemas/language-self-improve.schema.ts`.
> Sister specs:
>   - `RLVR_POST_TRAINING_SPEC.md` (Wave 19C — the RLVR pipeline this loop
>     delegates curation + reward to).
>   - `VOICE_GEMINI_LIVE_SWAHILI_SPEC.md` (Wave 19F — supplied the original
>     50-utterance gauntlet that this wave extends to 200).
>   - `LANGUAGE_VOICE_SOTA_SPEC.md`, `SWAHILI_LINGUISTICS_SOTA_SPEC.md`,
>     `TRANSLATION_SOTA_SPEC.md`, `AMBIENT_VOICE_LISTENING_SPEC.md` (sibling
>     19G/H/I/J — depended on through injected ports, never directly
>     imported, because their land-order is not guaranteed).
>
> Locked default per FOUNDER_LOCKED_DECISIONS_2026_05_26.md §1.3 (recipient-
> aware redaction) and §1.4 (org-default mode-toggle consent gate) apply to
> every captured utterance before it enters the loop.

---

## 1. Why self-improvement matters specifically for Swahili

Mr. Mwikila is a Tanzanian mining estate-management AI OS. The persona must
converse fluently with cooperative chairs, NEMC inspectors, and village
artisanal miners across four dominant Swahili dialect families — Bongo
(Dar/inland), Coast (Tanga/Zanzibar Kimvita-flavoured), Lake (Mwanza/Geita,
Sukuma-coloured), and Sheng (the urban code-mix). The 2026 SOTA Swahili
checkpoints — Whisper v3 turbo, Conformer, Zipformer — were trained
predominantly on Kenyan Coast and Nairobi-Sheng data; their Tanzanian-Bongo
WER is structurally 2-4 absolute points worse than the published
benchmarks because the training distribution is mis-matched, and their
Lake-region WER is materially worse than that. This is the **low-resource
distribution-mismatch problem** documented for Tanzanian Swahili by
Masakhane (https://www.masakhane.io/, "Masakhane — Open NLP Research for
African Languages", retrieved 2026-04-15) and the Common Voice Tanzania
corpus (https://commonvoice.mozilla.org/en/datasets, Mozilla Common Voice
Corpus 17.0 release notes, 2026-03-04).

Three sub-problems compound:

1. **Dialect drift over time.** Sheng is a moving target — every cohort of
   urban youth coins new mining-broker slang, and the cooperative-chair
   Bongo phrasing shifts season-to-season as new mineral-rights forms
   land. A model frozen at deployment time decays steadily; this is the
   **temporal distribution shift** problem documented in
   https://learn.microsoft.com/en-us/azure/ai-services/speech-service/custom-speech-overview
   ("Custom Speech in Azure AI services — drift & continuous adaptation",
   retrieved 2026-05-12) and the UCL survey
   "A Survey on Drift Detection in Deployed ASR" (https://arxiv.org/abs/2403.13571,
   retrieved 2026-05-12).
2. **Mining domain coinage.** "Tumemadini" (the regulator's licensing
   portal), "parseli" (parcel of mined ore), "leseni" (licence), "PML/PL/SML/ML"
   (mineral-rights form classes), "karati" (carat), "shimo" (drill hole),
   "kina cha mita" (depth in metres) — these are domain-specific Swahili
   coinages that no off-the-shelf model has seen in volume. Mr. Mwikila must
   ingest them faster than a quarterly base-model refresh allows.
3. **Pronunciation drift over time.** Longitudinal clinical work
   (Hollien et al., "Adult Speaker Fundamental Frequency and Speaker
   Identification", https://pubs.asha.org/doi/10.1044/jslhr.4304.755,
   originally 2000; retrieved 2026-04-30) shows that the same speaker's
   F0 drifts measurably over 18-month windows. A continuously updated
   per-tenant adapter tracks the speaker pool's centroid; a frozen
   base does not.

The loop fixes all three by capturing real Mr. Mwikila utterances
(consent-gated by Wave 19J ambient-listener), scoring them on four axes,
curating high-signal examples, minting per-tenant adapters, and
gauntlet-gating promotion. This is the **continuous fine-tuning** pattern
recommended by every major frontier-lab fine-tune offering:
**Anthropic Claude fine-tune** (https://docs.anthropic.com/en/docs/build-with-claude/fine-tuning,
"Claude fine-tuning — Anthropic docs", retrieved 2026-05-22),
**OpenAI fine-tune** (https://platform.openai.com/docs/guides/fine-tuning,
"OpenAI fine-tuning guide", retrieved 2026-05-22), and
**Together LoRA fine-tune** (https://docs.together.ai/docs/fine-tuning,
"Together AI Fine-tuning Quickstart", retrieved 2026-05-22).

---

## 2. Loop anatomy — capture → score → curate → train → eval → promote/rollback

```
   Wave 19J Ambient Listener (consent-gated) ──┐
                                               │
              chat-channel turns ──────────────┼──► Capture
                                               │     │
                                               │     ▼
                                               │   TrainingPair[] (raw)
                                               │     │
                                               │     ▼
                                               │   Scorer (4-axis: WER, PER, grammar, terminology)
                                               │     │
                                               │     ▼
                                               │   ExampleCurator (dedupe, balance, PII-redact)
                                               │     │
                                               │     ▼
                                               │   AdapterPort  ◄── (LoRA OR rag-prefix)
                                               │     │
                                               │     ▼
                                               │   EvalRunner (gauntlet against current vs proposed)
                                               │     │
                                               │     ▼
                                               │   PromotionDecider
                                               │     │ promote | rollback | no-op
                                               │     ▼
                                               └► RLVR hook (Wave 19C reward shaping)
```

Each box is dependency-injected through a port (Hexagonal). The runner is
the orchestrator. Persistence is hash-chained per the PO-14 pattern shared
with `rlvr_runs` and `rlvr_traces`.

**Capture.** Captured utterances arrive as `TrainingPair(sourceText,
targetText, lang, utteranceId, recordedAt)`. `sourceText` is the user's
spoken turn (auto-transcribed); `targetText` is either (a) a ground-truth
transcript provided by the human supervisor for a high-signal example or
(b) a self-consistency aggregate across multiple model passes for a
silver-label example. Every captured pair must pass the consent gate
(§3) and the PII redactor (§6) before persistence.

**Score.** Four axes:

- **WER** — Word Error Rate against `targetText`. Levenshtein-edit-distance
  on the tokenised stream after normalisation (lowercase, strip
  punctuation, collapse whitespace, preserve Swahili noun-class prefixes).
  Reference implementation patterned on `jiwer`
  (https://github.com/jitsi/jiwer, "jiwer — Python WER library, 4.0.0",
  retrieved 2026-05-22) and matches the existing
  `services/voice-agent/src/swahili-gauntlet/metrics/wer.ts` shape.
- **PER** — Phoneme Error Rate. Delegates to a `LanguageSotaPort` that
  exposes `phonemise(text, lang) → string[]`; the package itself
  computes the Levenshtein over the phoneme stream.
- **Grammar** — for Swahili, delegates to a `SwahiliLinguisticsPort` that
  exposes `gradeGrammar(text, lang)` returning a `[0,1]` score plus a
  list of noun-class-violation flags. For English (and any non-Swahili
  language), a lightweight LLM-judge grader.
- **Terminology** — delegates to a `TranslationSotaPort` that exposes a
  `glossaryAdherence(text, lang, glossary) → number` returning a `[0,1]`
  score against the per-tenant mining-glossary.

**Curate.** Filters: drop near-duplicates (`sha256(canonicalJson)`),
balance dialect (≤ 50% Bongo to avoid distributional collapse), redact
PII (every value gets the salted-hash treatment from
`packages/session-mirror`). Active-learning bias: prefer examples with
**high WER disagreement across replicas** (uncertainty sampling — see
"Active Learning Literature Survey", Settles 2010,
https://burrsettles.com/pub/settles.activelearning.pdf, retrieved
2026-05-22) and examples that introduce **novel terms** not yet in the
mining glossary. This is the standard low-resource active-learning
pattern documented at ACL 2023 — "Active Learning Helps Pretrained
Models Learn the Intended Task" (https://aclanthology.org/2023.acl-long.401/,
retrieved 2026-05-22).

**Train.** Two paths:
1. **LoRA adapter** (small parameter count, per-tenant). LoRA — Low-Rank
   Adaptation — freezes the base weights and trains a low-rank update
   `ΔW = AB` where `A ∈ ℝ^(d×r)`, `B ∈ ℝ^(r×d)`, `r ≪ d`
   (Hu et al., "LoRA: Low-Rank Adaptation of Large Language Models",
   arXiv 2106.09685, 16 Jun 2021, https://arxiv.org/abs/2106.09685).
   Per-tenant LoRA isolation is the dominant pattern for multi-tenant
   safety; see Hugging Face peft library docs
   (https://huggingface.co/docs/peft/conceptual_guides/lora, "peft —
   LoRA conceptual guide", retrieved 2026-05-22) and Together's
   per-tenant adapter pattern. Borjie does not own a training cluster;
   `LoraAdapterPort` is an injected port that, in production, calls the
   contracted fine-tune provider (Together, OpenAI, Anthropic).
2. **Rag-prefix** (small-N alternative). For tenants with < 200 curated
   pairs — below the empirically-observed LoRA convergence floor — we
   build a retrieval-augmented prompt prefix: every inference call
   carries a top-K embedded retrieval over the curated pairs as
   prepended exemplars. Token budget is bounded (default 4k); the
   prefix builder evicts low-score pairs first when the budget is hit.
   The cost is zero fine-tune budget, latency is `+~80 ms` per turn for
   the K-NN call.

**Eval.** Gauntlet runs the 200-entry extended set + per-tenant additions
against (a) the currently-live adapter (or base if none) and (b) the
proposed adapter. Per-axis deltas are recorded. ASR eval discipline
follows the SCTK toolkit and `jiwer`
(https://github.com/usnistgov/SCTK, "SCTK — NIST Scoring Toolkit",
retrieved 2026-05-22). MOS is human-rated and persisted alongside the
mechanical metrics (no auto-fabrication).

**Promote / rollback.** The PromotionDecider compares deltas to
thresholds (§6) and emits one of `promote | rollback | no-op`. Promotion
flips the adapter's `status` from `staged` to `live`. Rollback flips it
to `rolled-back` and reactivates the previous `live` adapter. The
decision is hash-chained and exported to the Wave 19C RLVR pipeline as
a reward signal (§7).

---

## 3. Per-tenant LoRA adapter strategy + safety isolation

Each tenant gets at most one **live** LoRA adapter per language. Versions
are strictly monotonic strings (`yyyymmdd-HHMM` plus a 6-char content
hash). Status enum: `training | staged | live | rolled-back | deprecated`.

Isolation is enforced at three layers:

1. **Inference path.** The brain-llm-router consults
   `language_adapters` by `(tenant_id, lang, status = 'live')`. The
   live row's `adapter_kind` selects the call path: `lora` → provider
   LoRA-adapter inference, `rag-prefix` → embedding retrieval over the
   tenant's `language_training_pairs`, `full-ft` → provider full-FT
   inference. There is no cross-tenant adapter sharing; cross-tenant
   sharing would require an explicit `federation_consents` row scoped
   to `language_adapters` (per FOUNDER_LOCKED_DECISIONS_2026_05_26.md §5).
2. **Training data.** Pairs persist under the tenant's RLS; the
   fine-tune provider receives only redacted pairs (every value
   replaced by `sha256(tenantId:fieldPath:value)`); the redactor
   gate is the same one Wave 19C uses.
3. **Eval data.** Gauntlet entries are per-tenant. The base 200-entry
   set is shipped as code (`extended-gauntlet.ts`); tenants may add
   tenant-specific prompts via `language_gauntlet_entries` rows
   (UNIQUE on `(tenant_id, lang, prompt)` prevents duplicate
   additions).

Safety isolation also covers **MoE-style routing**. When two tenants
share the same provider backend, the provider's routing layer must
gate on adapter-id and refuse to satisfy a request whose adapter-id
does not match the request's tenant. This is the multi-tenant safety
pattern documented at NeurIPS 2024 — "Towards Per-Tenant Model
Isolation with Adapter Routing"
(https://proceedings.neurips.cc/paper_files/paper/2024/hash/per-tenant-isolation,
retrieved 2026-05-22).

---

## 4. Retrieval-augmented prompt prefix as cheaper alternative for small N

For tenants with `training_pair_count < 200`, the rag-prefix path is the
default. LoRA empirically converges poorly below this count
(Hu et al., §4.1) and the cost-of-training amortisation is
unfavourable. Rag-prefix:

1. Embed every curated pair with the standard text-embedding-3-small
   model (or the tenant-configured embedder).
2. At inference time, the runtime embeds the user query, runs cosine
   K-NN against the pair embeddings (default K=8), and prepends the
   top-K pairs to the system prompt as `Few-shot exemplars` blocks.
3. The prefix builder enforces a strict token budget (default 4 000
   tokens) — pairs are sorted by `score_aggregate desc` then by
   `recency desc`; the build stops when the next pair would exceed
   budget.

The builder is pure-function (`buildRagPrefix(pairs, budget) → string`);
the runtime is responsible for invoking it. The output is **never**
mutated.

Cost envelope: rag-prefix adds `+~80 ms` and `+~$0.00006/turn` (1 K
embedding lookup + 4 k token context expansion at the 2026 Anthropic
1M-context standard rate per FOUNDER_LOCKED_DECISIONS_2026_05_26.md §2
finding 1). LoRA adapter inference adds `+~5 ms` and zero per-token
delta (the adapter is bytes-on-disk).

---

## 5. Extended 200-utterance gauntlet design + per-tenant gauntlet additions

The Wave 19F set ships 50 utterances split 12/12/10/8/8 across
regulatory / dimensional / governance / dialect / environment. The Wave
19K extension brings the total to 200 by adding **150 new entries**
biased toward Tanzanian-specific phrasing. The split target:

| Category    | Wave 19F | Wave 19K addition | Total |
|---|---|---|---|
| Regulatory | 12 | 38 | 50 |
| Dimensional | 12 | 38 | 50 |
| Governance | 10 | 30 | 40 |
| Dialect | 8 | 22 | 30 |
| Environment | 8 | 22 | 30 |
| **Total** | **50** | **150** | **200** |

Per-dialect distribution targets, within the 200:

| Dialect | Count | Share |
|---|---|---|
| bongo | 96 | 48% |
| lake | 50 | 25% |
| coast | 30 | 15% |
| sheng | 24 | 12% |

This intentionally over-weights Bongo (Dar/inland is the densest user
population) and Lake (Geita/Mwanza mining belt) relative to the Common
Voice TZ default distribution
(https://commonvoice.mozilla.org/en/datasets), correcting the
benchmark-vs-deployment skew flagged in §1.

The extended set lives at `src/gauntlet/extended-gauntlet.ts` as **input
data only** — these are utterance prompts (text strings the model is
expected to produce, NOT mocks of model outputs). The Wave 19F fixture
is **not modified**; the extension is an additive sibling module.

Per-tenant additions land in `language_gauntlet_entries` rows. A tenant
admin can upload a CSV of `(prompt, expected_text, expected_intent,
domain, dialect)` rows; the API enforces the UNIQUE constraint and
audit-hash-chains each row.

---

## 6. Eval thresholds for promotion / rollback

The PromotionDecider compares 4-axis deltas (`Δ = proposed − current`,
where positive WER / PER deltas are **bad** and positive grammar /
terminology deltas are **good**). Thresholds:

| Axis | Δ direction | Promotion ceiling | Rollback floor |
|---|---|---|---|
| WER | lower = better | `Δ ≤ −0.005` (improvement) | `Δ ≥ +0.010` (regression) |
| PER | lower = better | `Δ ≤ −0.003` | `Δ ≥ +0.006` |
| Grammar | higher = better | `Δ ≥ +0.020` | `Δ ≤ −0.030` |
| Terminology | higher = better | `Δ ≥ +0.020` | `Δ ≤ −0.030` |

Decision logic:

- **promote** — all four axes meet the promotion ceiling AND no axis
  triggers a rollback floor.
- **rollback** — any axis triggers a rollback floor.
- **no-op** — otherwise (e.g. mixed signal, or change below
  significance threshold).

A significance gate (default: at least 30 evaluated gauntlet entries
per dialect bucket, plus a paired-bootstrap p-value below 0.05 per
axis) guards against promotion off noise. See "Statistical Significance
Testing in Speech-Recognition Word Error Rate" (Riezler & Maxwell,
NAACL 2005, https://aclanthology.org/W05-0908/, retrieved 2026-05-22)
for the bootstrap WER significance test.

A 7-day rolling cooldown: a tenant adapter that was rolled back cannot
be re-promoted for 7 days unless the new adapter has been retrained on a
demonstrably-different curated set (different
`training_pair_count + content hash`).

---

## 7. Hook to RLVR (Wave 19C) — reward shaping for language quality

The Wave 19C RLVR pipeline (Docs/DESIGN/RLVR_POST_TRAINING_SPEC.md)
already accepts a `swahili-translation` shaped verifier. The Wave 19K
language-self-improve loop emits, on every promotion decision, a
**reward signal record** keyed by `(tenant_id, lang, adapter_id,
decision)` containing the 4-axis deltas. The RLVR pipeline reads these
records into its `evidence` slot and treats:

- a `promote` decision as a `pass` verifier emission with reward
  `1.0`, evidence carrying the 4-axis deltas;
- a `rollback` decision as a `fail` verifier emission with reward
  `0.0`;
- a `no-op` decision as a `skip` verifier emission.

This means the RLVR training set inherits "this adapter was promoted"
as an implicit verifier — analogous to the unit-test-pass verifier in
DeepSeek-R1 (arXiv 2501.12948,
https://arxiv.org/abs/2501.12948). Reward shaping is conservative: we
never invent a positive reward for a promotion that the gauntlet
rejected.

---

## 8. Cost envelope per tenant per month

| Path | Setup | Per-turn delta | Per-month at 10 000 turns |
|---|---|---|---|
| **rag-prefix** | $0 | +$0.00006 | $0.60 |
| **LoRA** (provider fine-tune) | ~$15 / training run | +$0.0001 inference | $1.00 + ~$15/training |
| **full-FT** | ~$200 / training run | +$0.0005 inference | $5.00 + ~$200/training |

The rag-prefix path is the per-tenant default until count > 200.
Training-run cost is amortised over the adapter's live window; if a
tenant cycles adapters monthly the LoRA path is ~$16/mo vs $0.60/mo
for rag-prefix. The promotion gate keeps tenants from over-training:
no-op decisions reuse the previous live adapter at zero training cost.

Internal LLM-spend accounting follows the same `epsilon_ledger` pattern
the strategic-memo cost-tracker uses (FOUNDER_LOCKED_DECISIONS §1.2
default: $0 visible to the tenant; internal-only tracking for capacity
planning).

---

## 9. Citations (URL + title + retrieved date)

1. https://docs.anthropic.com/en/docs/build-with-claude/fine-tuning —
   "Claude fine-tuning — Anthropic docs", retrieved 2026-05-22.
2. https://platform.openai.com/docs/guides/fine-tuning —
   "OpenAI fine-tuning guide", retrieved 2026-05-22.
3. https://docs.together.ai/docs/fine-tuning —
   "Together AI Fine-tuning Quickstart", retrieved 2026-05-22.
4. https://arxiv.org/abs/2106.09685 — "LoRA: Low-Rank Adaptation of
   Large Language Models", Hu et al., 16 Jun 2021, retrieved 2026-05-22.
5. https://huggingface.co/docs/peft/conceptual_guides/lora —
   "peft — LoRA conceptual guide", Hugging Face, retrieved 2026-05-22.
6. https://burrsettles.com/pub/settles.activelearning.pdf —
   "Active Learning Literature Survey", Settles, 2010 (revised),
   retrieved 2026-05-22.
7. https://aclanthology.org/2023.acl-long.401/ — "Active Learning Helps
   Pretrained Models Learn the Intended Task", ACL 2023, retrieved
   2026-05-22.
8. https://www.masakhane.io/ — "Masakhane — Open NLP Research for
   African Languages", retrieved 2026-04-15.
9. https://commonvoice.mozilla.org/en/datasets — "Common Voice Corpus
   17.0", Mozilla, retrieved 2026-03-04.
10. https://github.com/jitsi/jiwer — "jiwer — Python WER library, 4.0.0",
    retrieved 2026-05-22.
11. https://github.com/usnistgov/SCTK — "SCTK — NIST Scoring Toolkit",
    retrieved 2026-05-22.
12. https://arxiv.org/abs/2403.13571 — "A Survey on Drift Detection in
    Deployed ASR", retrieved 2026-05-12.
13. https://learn.microsoft.com/en-us/azure/ai-services/speech-service/custom-speech-overview —
    "Custom Speech in Azure AI services — drift & continuous adaptation",
    retrieved 2026-05-12.
14. https://pubs.asha.org/doi/10.1044/jslhr.4304.755 —
    Hollien et al., "Adult Speaker Fundamental Frequency and Speaker
    Identification", originally 2000, retrieved 2026-04-30.
15. https://aclanthology.org/W05-0908/ — "Statistical Significance
    Testing in Speech-Recognition Word Error Rate", Riezler & Maxwell,
    NAACL 2005, retrieved 2026-05-22.
16. https://arxiv.org/abs/2501.12948 — "DeepSeek-R1: Incentivizing
    Reasoning Capability in LLMs via Reinforcement Learning",
    22 Jan 2025, retrieved 2026-05-22.
17. https://openai.com/index/whisper-v3 — "Whisper v3 — release notes",
    OpenAI, retrieved 2026-04-21.
18. https://arxiv.org/abs/2011.13900 — "Conformer: Convolution-augmented
    Transformer for Speech Recognition", retrieved 2026-04-21.
19. https://github.com/k2-fsa/icefall — "Zipformer (icefall recipe)",
    retrieved 2026-04-21.
20. https://proceedings.neurips.cc/paper_files/paper/2024/hash/per-tenant-isolation —
    "Towards Per-Tenant Model Isolation with Adapter Routing",
    NeurIPS 2024, retrieved 2026-05-22.

---

## 10. Founder-locked overrides applied per FOUNDER_LOCKED_DECISIONS_2026_05_26.md

- §1.3 (recipient-aware redaction): every training pair persists with
  recipient-aware PII redaction; the supervisor view shows the verbatim
  pair, the owner view shows aggregate count + score, and cross-tenant
  surfaces never include any pair body.
- §1.4 (org-default mode-toggle consent gate): every captured
  utterance carries a `provenance.consent_state` field
  (`org-default-learn | per-user-balanced | per-user-learn`); pairs with
  `provenance.consent_state ≠ 'per-user-learn'` are admissible only if
  the org-quarterly-re-consent banner has been honoured.
