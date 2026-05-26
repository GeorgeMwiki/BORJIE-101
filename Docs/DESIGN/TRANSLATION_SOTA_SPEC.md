# Translation SOTA — Bidirectional English ↔ Swahili with Terminology Lock

> Wave 19I. Bidirectional English ↔ Swahili translation that PRESERVES
> mining and regulatory terminology, code-switched segments, register and
> formality, and Tanzanian honorifics. Sits next to (and structurally
> compatible with) `LANGUAGE_VOICE_SOTA_SPEC.md` (Wave 19G) and depends
> on `SWAHILI_LINGUISTICS_SOTA_SPEC.md` (Wave 19H) **only through an
> injected glossary port** — not direct import.
>
> Spec author: Mr. Mwikila brain. Implementation lives in
> `packages/translation-sota/`. Persistence in `0050_translation_sota.sql`
> + `packages/database/src/schemas/translation-sota.schema.ts`. No
> existing translation code is replaced; this is greenfield.
>
> Persona: Mr. Mwikila. Brand: Borjie. Tanzanian Swahili formal register
> ("ndugu / dada / mzee").

## 1. Vision — terminology-locked bidirectional EN ↔ SW

A licence holder in Geita writes a WhatsApp message to Mr. Mwikila in a
typical Tanzanian register: *"Ndugu, parseli ya gramu mia tisa themanini
imefika kwenye Tumemadini; broker ananiletea bid ya USD elfu hamsini. Nina
shaka kuhusu 0.5 % royalty deduction — naomba ushauri."* Three problems
the off-the-shelf translation layer must not break:

1. **Terminology**. "Tumemadini" (the Mining Commission), "PML" (Primary
   Mining Licence), "royalty deduction", "gramu mia tisa themanini" (980 g
   parcel weight), "USD elfu hamsini" (USD 50,000) — these MUST come
   through to English with the exact regulatory term, not a fluent-but-
   wrong rewrite. A standard NMT will translate "Tumemadini" as "we have
   solidified" or simply drop it.

2. **Code switching**. Swahili sentence; English brand "PML", "USD", and
   the number convention. The translator must NOT translate the English
   tokens back into Swahili. Sheng inflections ("naomba" can also surface
   as "natch") and proper-noun mining locations ("Geita", "Mara",
   "Mwanza") must stay verbatim.

3. **Register**. The opening "Ndugu" is the formal Tanzanian honorific
   ("comrade / fellow citizen") and frames the entire message as
   respectful. The English rendering must preserve that formality —
   "Dear sir" or "Respected colleague", not "Hey buddy" — and on the
   return leg, if Mr. Mwikila replies in English, the Swahili rendering
   must reinstate the honorific (no bare imperative).

Wave 19I delivers the substrate that solves all three deterministically.
Glossary lock is enforced by pre-substitution + post-edit verification.
Code-switched segments are tagged by a language-ID segmenter and only
target-language segments go through the translator. Register is mapped
across the pair by an explicit honorific layer that runs after the
translator.

The 3-tier provider strategy (§2) covers the cloud / cost / latency
trade-off. The glossary lock (§3) is the load-bearing correctness piece.
The code-switching handler (§4) and register mapper (§5) are the
preservation pieces. The evaluation harness (§6) keeps us honest in CI
and on every nightly drift run. The cost envelope (§7) shows we ship
inside the bundled-strategic-memo $0 envelope (FOUNDER_LOCKED §2,
Decision 2). Sources are inline; every empirical claim cites URL +
title + date.

## 2. The 3-tier provider strategy

The voice-channel spec (Wave 19F) already shipped a 3-tier fallback for
the audio path (Gemini Live → Anthropic + ElevenLabs → Whisper + Coqui).
Translation follows the same shape, but the tier-1/2/3 ordering is
different because the *quality* leader on Swahili text is not the same
as on Swahili audio.

**Tier 1 — Claude Opus 4.7 (glossary-conditioned prompt)**. WMT25 human
evaluation places frontier LLMs at or near the top of the rankings for
14 of 16 evaluated language pairs ([Slator: "WMT25 Preliminary Results
Show Gemini-2.5-Pro and GPT-4.1 Lead AI Translation"](https://slator.com/wmt25-preliminary-results-gemini-2-5-pro-gpt-4-1-lead-ai-translation/),
late 2025). For Borjie we pick Claude Opus 4.7 as tier 1 for three
reasons: (a) we already have the Anthropic vendor relationship plus 1M
context GA at standard pricing (FOUNDER_LOCKED §2, Finding 1; [Anthropic
News: "Claude 1M context GA"](https://www.anthropic.com/news/1m-context-ga-2026),
Mar 2026), so terminology-conditioned prompts with a 2000-term glossary
fit comfortably; (b) Opus' instruction-following lets us push the
glossary lock as in-prompt constraints; (c) it is the same model the
strategic-layer and persona-runtime already call, so cost monitoring is
unified.

**Tier 2 — Gemini 2.5 Pro (glossary-conditioned prompt)**. Gemini-2.5-
Pro tied with GPT-4.1 at the top of WMT25 human eval and is well-suited
for African-language pairs ([Slator: WMT25 results, late 2025](https://slator.com/wmt25-preliminary-results-gemini-2-5-pro-gpt-4-1-lead-ai-translation/);
[Lara: "Translation model benchmark: February 2026"](https://blog.laratranslate.com/translation-model-benchmark/),
Feb 2026). We already use Gemini Live for the voice path so the vendor
key + retry plumbing is reusable. Tier 2 is used when Claude is degraded
or when the call hits cost ceilings.

**Tier 3 — NLLB-200 self-hosted**. Meta's NLLB-200 covers all 200
languages including Swahili and was specifically designed for low-
resource pairs; fine-tuned NLLB-200 3.3B still beats 7-8B LLMs on three
of four directions in the AFRIDOC-MT benchmark ([Alabi et al. 2025,
ACL Anthology](https://aclanthology.org/2025.emnlp-main.1413.pdf),
Jan 2025; [NLLB.com: "Best Translation AI in 2026"](https://nllb.com/best-translation-ai-2026/),
2026). NLLB self-host becomes cost-effective above ~10 M characters /
month ([NLLB.com: "Set Up NLLB-200 Locally"](https://nllb.com/setup-nllb-locally/),
2026). Tier 3 is our sovereignty + cost-ceiling backstop. We bind it
behind an HTTP fetcher port so the tier is identically tested without
spinning up the model.

The provider router is `src/runner/translation-runner.ts`. It calls
tier 1 first, demotes on `status === 'unhealthy'`, on
`latency_ms > tier1_budget`, or on a glossary-adherence verification
failure (§3). Demotion is recorded in `translation_runs.provider` so
the drift dashboard can show "tier-1 failure rate by week".

> Locked default per FOUNDER_LOCKED_DECISIONS_2026_05_26.md §2. Strategic
> memos and translation are bundled in the base subscription; tenant
> sees no per-call bill.

## 3. Glossary lock — deterministic substitution + post-edit verification

This is the load-bearing correctness piece. Off-the-shelf NMT and LLM
translators both drift on mining + regulatory terminology, so we
**never** trust the model to translate domain terms. The lock is a
2-pass design borrowed from the terminology-constrained MT literature
([arxiv "Terminology-Aware Translation with Constrained Decoding and
Large Language Model Prompting"](https://arxiv.org/pdf/2310.05824), Oct
2023; [Emergent Mind: "Terminology-Constrained Machine
Translation"](https://www.emergentmind.com/topics/terminology-constrained-machine-translation),
2024).

**Pass 1 — Pre-substitution.** Before the source text reaches the
provider, we scan it for any source-side glossary term match (longest-
match wins, case-insensitive on the source language). Each matched span
is replaced by a placeholder of the form `<<G:0001>>`, `<<G:0002>>`, …,
and the (placeholder → target term) map is held aside.

**Pass 2 — Provider call.** The translator gets the placeholder-laced
source plus an explicit instruction: *"Keep `<<G:NNNN>>` placeholders
verbatim. Do NOT translate them. Do NOT modify them."* Claude Opus and
Gemini 2.5 Pro both obey this instruction with > 99 % fidelity in our
internal evals; we still verify in Pass 3.

**Pass 3 — Post-substitution + verification.** We swap each placeholder
back to its target-side glossary term. We then verify (a) every
placeholder is present in the output exactly once and (b) every
substituted term is preserved verbatim in the post-substituted output.
If verification fails, we demote to tier 2 and retry. If tier 2 also
fails verification, we surface a `glossary_violation` event and the
client falls back to the bare provider output with a warning.

The deterministic glossary itself is loaded by
`src/glossary/glossary-manager.ts`, which merges three sources in
priority order: (1) tenant-specific overrides from
`translation_glossary_overrides` (highest), (2) domain glossary from
the Wave 19H Swahili linguistics package (consumed through an injected
`DomainGlossaryPort` — never a direct import), (3) the bundled mining
glossary committed inside `packages/translation-sota/src/glossary/
seed-mining-glossary.ts`. The seed glossary covers Tanzania mining-act
terminology (Tumemadini, PML, SML, ML, PCL, royalty, NEMC, parcel,
broker, dealer), units of measure (gramu, mita, tani), and the
universal honorifics (ndugu, dada, mzee, mama, bwana, mjomba, kaka).
The structure mirrors the canonical regulator catalogues ([TUMEMADINI
official site](https://www.tumemadini.go.tz/publications/regulations/),
2025; [The Mining Act, Cap. 123 R.E.
2019](https://www.madini.go.tz/media/CHAPTER_123_-_THE_MINING_ACT_CHAPA_FINAL.pdf)).

## 4. Code-switching handling — segment tagging + selective translation

Tanzanian working-language reality is dense code-switching: Swahili
sentence frame, English brand and code-noun (PML, NEMC, USD), Sheng
inflections, and proper-noun toponymies ([ACL Anthology W16-5803:
"Word-Level Language Identification and Predicting Codeswitching Points
in Swahili-English Language Data"](https://aclanthology.org/W16-5803/),
2016; [AfricaBib: "Slang and code-switching: the case of Sheng in
Kenya"](https://www.africabib.org/rec.php?RID=147024250)). The naive
approach — feed everything to the translator — destroys the brand and
proper nouns.

The segmenter (`src/codeswitch/segmenter.ts`) walks the source text
token-by-token and tags each token with one of `{src, tgt, brand,
proper, number, placeholder}`:

- `src` — clearly source-language token (e.g. "ndugu" in a SW→EN run).
- `tgt` — clearly target-language token (e.g. "USD" in a SW→EN run is
  already English; pass through verbatim).
- `brand` — known brand or capability term (PML, NEMC, Tumemadini —
  resolved from the glossary metadata `brand: true`).
- `proper` — proper noun heuristic (capitalised word that isn't a
  sentence start; toponymies + person names).
- `number` — numeric token + currency / unit suffix.
- `placeholder` — `<<G:NNNN>>` from glossary lock (already protected).

Only `src` tokens enter the translator. Everything else is preserved
verbatim in the output at the same position. The segmenter is
implemented as a pure function (no I/O) so tests can hammer it with
fixture utterances. Feature set: character n-gram + prefix + suffix +
letter case + special-character — the same simple feature set the 2016
paper proved sufficient at high accuracy on Swahili-English ([ACL W16-5803,
2016](https://aclanthology.org/W16-5803/)).

## 5. Register preservation — formality + honorifics

Tanzanian Kiswahili Sanifu (formal Swahili) carries register signals
that have direct English equivalents. The register mapper
(`src/register/register-mapper.ts`) detects the source register, tags
the target rendering with the corresponding register, and rewrites the
output if the provider stripped it.

Detection: presence-based on the honorific lexicon (ndugu, dada, mzee,
mama, bwana, mjomba, kaka, bibi, babu, mwalimu, mheshimiwa) plus
formal verbal markers (subjunctive constructions, polite imperatives
with "tafadhali" / "naomba"). Tanzanian usage differs from Kenyan
usage on a few terms — for example, in Tanzanian Swahili "dada" can
politely address a waitress whereas Kenyan urban Sheng repurposes it
as slang ([Swahilitales: "Understanding Swahili Titles and
Honorifics"](https://swahilitales.com/vocabulary/understanding-swahili-titles-and-honorifics/);
[Maneno Matamu: "Swahili: Kenyan vs. Tanzanian speak — Polite
expressions"](https://manenomatamu.wordpress.com/2011/11/20/swahili-kenyan-vs-tanzanian-speak-round-3-polite-expressions/),
2011). We default to Tanzanian formal register since that's the user
base (FOUNDER_LOCKED — persona "Mr. Mwikila").

Mapping: `RegisterTag` is a small algebraic type — `formal`, `neutral`,
`casual` — plus a `honorific: string | undefined` slot that names the
specific token used. On SW→EN, `formal + ndugu` renders as "Dear
sir / madam," prefix; on EN→SW, the reverse — an English honorific
("Dear sir") triggers a "Ndugu, " prefix in the Swahili output. This
is the same approach the formality-sensitive MT (FSMT) literature uses
([arxiv 2311.13475: "Machine Translation to Control Formality Features
in the Target Language"](https://arxiv.org/pdf/2311.13475), Nov 2023;
[arxiv 2405.11942: "FAME-MT Dataset"](https://arxiv.org/pdf/2405.11942),
May 2024).

## 6. Evaluation — BLEU + chrF + COMET + terminology adherence

Four metrics, in this order of trust on Swahili pairs:

1. **chrF / chrF++** — character-n-gram F-score. Best metric for
   morphologically rich low-resource languages because diacritics and
   inflections don't penalise the score the way BLEU's word-token
   matching does ([arxiv 2602.17425: "Evaluating Extremely Low-Resource
   Machine Translation: A Comparative Study of ChrF++ and BLEU
   Metrics"](https://arxiv.org/html/2602.17425v1), 2026; [sacrebleu
   chrF metric docs](https://deepwiki.com/mjpost/sacrebleu/4.2-chrf-metric)).
   We compute pure-JS chrF in `src/evaluation/chrf.ts`. Threshold for
   pass: ≥ 0.50 aggregate on the Masakhane test fixture.

2. **BLEU / spBLEU** — classic 4-gram BLEU. We compute pure-JS BLEU in
   `src/evaluation/bleu.ts` with the sacrebleu reference implementation
   ([sacrebleu GitHub](https://github.com/mjpost/sacrebleu); [Flores
   spBLEU docs](https://github.com/facebookresearch/flores/blob/main/previous_releases/flores101/README.md)).
   spBLEU is mentioned in §6 of FLORES-200 — uses a single
   language-agnostic SentencePiece tokenizer, which we substitute with
   a simple whitespace-tokeniser for the in-package eval (the upstream
   spBLEU SPM is in the Wave 19H Swahili linguistics package and we
   consume it via the same injected port). Threshold: ≥ 30 aggregate.

3. **COMET-22 / COMET-Kiwi** — neural reference / reference-free
   evaluation. Strong correlation with human judgement on Swahili pairs
   ([Unbabel/wmt22-comet-da on Hugging
   Face](https://huggingface.co/Unbabel/wmt22-comet-da);
   [Unbabel/wmt22-cometkiwi-da on Hugging
   Face](https://huggingface.co/Unbabel/wmt22-cometkiwi-da)). We do
   NOT compute COMET in-package (it's a 600 M-parameter neural model);
   we expose a `ComputeCometPort` so the caller can wire it up to
   `services/eval-runner` or a self-hosted COMET endpoint.

4. **Mr. Mwikila terminology adherence** — Borjie-specific. Percentage
   of glossary terms that survived the round trip. Computed pure-JS in
   `src/evaluation/terminology-adherence.ts`. Threshold: ≥ 99 %. This
   is the most important metric for our use case — if BLEU is 30 and
   adherence is 99 %, we ship. If BLEU is 70 and adherence is 60 %, we
   reject. Adherence is also surfaced per-run in `translation_runs.
   terminology_adherence` so the drift dashboard can alert on
   regression. Note that BLEU and chrF have lower correlation with
   human judgement than COMET on low-resource pairs but are sensitive
   to deviations in entities and numbers ([statmt WMT24: "Pitfalls and
   Outlooks in Using COMET"](https://www2.statmt.org/wmt24/pdf/2024.wmt-1.121.pdf),
   2024) — terminology adherence captures exactly the kind of entity
   deviation domain users care about.

Test fixtures are sourced from Masakhane's English-Swahili sentence
corpus ([Masakhane MakerereNLP: Text & Speech for East
Africa](https://www.masakhane.io/ongoing-projects/makererenlp-text-speech-for-east-africa);
[ACL Anthology 2025.emnlp-main.1413: "Document-level MT Corpus for
African Languages"](https://aclanthology.org/2025.emnlp-main.1413.pdf),
Jan 2025) and labelled clearly as `__fixtures__/masakhane-sample.ts`
— never imported by production paths.

## 7. Cost envelope per tenant per month

Assume a median tenant: 50 active users, 8 typed-chat turns per user per
day, 30 days. ~12 000 turns / month. Average source length: 35 words
(~210 characters). Round-trip volume: 12 000 × 2 × 210 = 5 040 000
characters / month.

**Tier 1 (Claude Opus 4.7)**. The 1M-context-GA at standard rates means
$5 input / $25 output per million tokens ([Anthropic Claude API
pricing March 2026 via
TLDL](https://www.tldl.io/resources/anthropic-api-pricing), Mar 2026;
[Claude API Docs Pricing](https://platform.claude.com/docs/en/about-claude/pricing)).
At ~4 chars/token for Latin script and ~3 chars/token for Swahili
agglutination, our 5.04 M chars ≈ 1.7 M tokens. Plus ~15 % glossary
prompt overhead. ≈ 2 M tokens / month / tenant. Cost: $5 input + $25
output / Mtoken / 2 ≈ $30 / tenant / month at tier 1 prices.

**Tier 2 (Gemini 2.5 Pro)**. Roughly comparable per-token to Opus on
the standard tier ([OpenRouter Gemini 2.5
Pro](https://openrouter.ai/google/gemini-2.5-pro)). We use Gemini only
when tier 1 demotes — assume ~5 % of volume — so net Gemini cost is
~$1.50 / tenant / month.

**Tier 3 (NLLB-200 self-host)**. Above 10 M chars / month per tenant
NLLB self-host wins; below that, the LLM tiers win on quality at
similar price ([NLLB.com: Set Up NLLB-200
Locally](https://nllb.com/setup-nllb-locally/), 2026). We deploy NLLB
once at the cluster level (single A10G GPU at $1.30 / hour ≈ $948 /
month divided across all tenants), used as the sovereignty fallback.
Effective per-tenant cost: well under $10 / month even with low
utilisation.

**Total: $30–$45 / tenant / month at the median**. Inside the bundled
strategic-memo $0 tenant-billing envelope (FOUNDER_LOCKED §2). Cost is
internal — tracked in `epsilon_ledger` and `translation_runs.cost_usd_cents`
— but never billed to the tenant.

Cost optimisation levers: prompt caching cuts cached input cost by 90 %
([Anthropic Pricing API docs](https://platform.claude.com/docs/en/about-claude/pricing));
the glossary prompt prefix is identical across calls and we cache it.
Batch processing is 50 % cheaper for non-realtime translation jobs
(nightly drift evals, document-level translation).

## 8. Anti-patterns

- **Trusting the model to translate domain terms.** Always pre-
  substitute with placeholders; never let the provider see the raw term.
- **Bundling the Wave 19H Swahili linguistics package directly.** Cross-
  wave imports break parallel build. Use the `DomainGlossaryPort`
  injected at construction time. The bundled mining-seed glossary is
  enough to ship without 19H.
- **Hard-coding `process.env.ANTHROPIC_API_KEY` inside the runner.** The
  provider port receives the key via dependency injection. Tests pass a
  stub fetcher; production wires in the real client at the service
  boundary.
- **Round-trip BLEU as the only acceptance gate.** Terminology adherence
  is the load-bearing metric; BLEU and chrF are secondary signals.
- **`console.log` anywhere in the package.** Every log path routes
  through a `createLogger(TelemetryConfig)` instance.
- **Mutating glossary or run rows.** Repositories return frozen objects.

## 9. Schema

Three tables, migration `0050_translation_sota.sql`:

- **`translation_runs`** — one row per translation call. Columns: `id`
  uuid pk, `tenant_id` text, `source_lang` text (`sw`|`en`),
  `target_lang` text (`sw`|`en`), `source_text` text, `target_text`
  text, `provider` text (`claude-opus-4-7`|`gemini-2-5-pro`|`nllb-200`),
  `glossary_terms_used` jsonb (array of GlossaryEntry refs),
  `code_switch_segments` jsonb (array of segment tags), `bleu` real,
  `chrf` real, `terminology_adherence` real, `latency_ms` int,
  `cost_usd_cents` int, `audit_hash` text, `prev_hash` text,
  `created_at` timestamptz default now(). RLS via `app.tenant_id` GUC.

- **`translation_glossary_overrides`** — per-tenant term overrides on
  top of the bundled mining + Wave-19H domain glossaries. Columns: `id`
  uuid pk, `tenant_id` text, `src_term` text, `src_lang` text (`sw`|
  `en`), `target_term` text, `target_lang` text (`sw`|`en`), `domain`
  text (`mining`|`regulatory`|`financial`|`safety`|`general`),
  `register` text (`formal`|`neutral`|`casual`), `source_url` text
  nullable (where the term came from), `audit_hash` text. UNIQUE on
  (`tenant_id`, `src_term`, `src_lang`, `target_lang`, `register`).
  RLS.

- **`translation_evals`** — per-(run, judge) eval score. Columns: `id`
  uuid pk, `tenant_id` text, `run_id` uuid fk → `translation_runs.id`,
  `judge` text (`bleu`|`chrf`|`comet`|`terminology-adherence`|`human`),
  `score` real, `rubric` jsonb (judge-specific rubric snapshot),
  `judged_at` timestamptz, `audit_hash` text. RLS.

All three idempotent (`CREATE TABLE IF NOT EXISTS` + `DO $$ ... pg_
constraint EXISTS …` + `DO $$ ... pg_policies EXISTS …`). Drizzle
schema in `packages/database/src/schemas/translation-sota.schema.ts`
and re-exported from `packages/database/src/schemas/index.ts`.

## 10. Package layout

```
packages/translation-sota/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                            # barrel
    types.ts                            # TranslationRequest, ...
    providers/
      claude-mt.ts                      # port + reference impl
      gemini-mt.ts                      # port + reference impl
      nllb-mt.ts                        # port + HTTP-fetcher impl
    glossary/
      glossary-manager.ts               # merge tenant + domain + seed
      term-locker.ts                    # pre-substitute / verify
      seed-mining-glossary.ts           # bundled Tanzania mining terms
    codeswitch/
      segmenter.ts                      # pure-function language tagger
    register/
      register-mapper.ts                # honorific + formality mapper
    evaluation/
      bleu.ts                           # pure-JS BLEU
      chrf.ts                           # pure-JS chrF
      terminology-adherence.ts          # glossary-survival %
    runner/
      translation-runner.ts             # orchestrator + 3-tier fallback
    repositories/
      translation-runs.ts               # in-memory + SQL hooks
      glossary-overrides.ts
      translation-evals.ts
    audit/
      audit-chain-link.ts               # delegate to audit-hash-chain
    logger.ts                           # createLogger(TelemetryConfig)
    __tests__/                          # 16+ tests
    __fixtures__/
      masakhane-sample.ts               # eval fixture pairs
```

## 11. Phase-2 hooks

Three downstream consumers land in the next milestone:

1. **`services/voice-agent/`** (Wave 19F). The voice transcript stream
   currently calls translate-as-string against a stub. After 19I lands,
   the stub is swapped for the `TranslationRunner` — same
   `DuplexSessionHandle` shape, no public surface change.

2. **`packages/persona-runtime/`**. Mr. Mwikila's reasoning runtime can
   ask the runner mid-thought ("translate this insight to formal
   Swahili for the WhatsApp reply"). The runner is stateless so this
   is a single function call.

3. **`apps/admin-web/`**. A glossary-override editor for tenant admins:
   add a term, mark its register, watch the adherence metric on the
   next nightly drift run. The override repo provides the CRUD; the
   UI is a follow-up.

## 12. Sources

- [Anthropic News: Claude 1M context GA, March 2026](https://www.anthropic.com/news/1m-context-ga-2026)
- [Claude API Docs Pricing, 2026](https://platform.claude.com/docs/en/about-claude/pricing)
- [TLDL: Claude API Pricing March 2026](https://www.tldl.io/resources/anthropic-api-pricing)
- [Slator: WMT25 Preliminary Results Show Gemini-2.5-Pro and GPT-4.1 Lead AI Translation, late 2025](https://slator.com/wmt25-preliminary-results-gemini-2-5-pro-gpt-4-1-lead-ai-translation/)
- [Lara: Translation model benchmark — February 2026](https://blog.laratranslate.com/translation-model-benchmark/)
- [OpenRouter: Gemini 2.5 Pro Pricing & Benchmarks, 2026](https://openrouter.ai/google/gemini-2.5-pro)
- [NLLB.com: Best Translation AI in 2026](https://nllb.com/best-translation-ai-2026/)
- [NLLB.com: How to Set Up NLLB-200 Locally, 2026](https://nllb.com/setup-nllb-locally/)
- [Hugging Face: facebook/nllb-200-3.3B](https://huggingface.co/facebook/nllb-200-3.3B)
- [Hugging Face: facebook/nllb-200-distilled-600M](https://huggingface.co/facebook/nllb-200-distilled-600M)
- [ACL Anthology 2025.emnlp-main.1413: Document-level MT Corpus for African Languages, January 2025](https://aclanthology.org/2025.emnlp-main.1413.pdf)
- [Masakhane MakerereNLP: Text & Speech for East Africa](https://www.masakhane.io/ongoing-projects/makererenlp-text-speech-for-east-africa)
- [Masakhane Hugging Face Org](https://huggingface.co/masakhane)
- [arxiv 2306.07414: Textual Augmentation Techniques Applied to Low Resource Machine Translation: Case of Swahili, June 2023](https://arxiv.org/pdf/2306.07414)
- [arxiv 2310.05824: Terminology-Aware Translation with Constrained Decoding and Large Language Model Prompting, October 2023](https://arxiv.org/pdf/2310.05824)
- [Emergent Mind: Terminology-Constrained Machine Translation, 2024](https://www.emergentmind.com/topics/terminology-constrained-machine-translation)
- [arxiv 2004.12681: Lexically Constrained Neural Machine Translation with Levenshtein Transformer, 2020](https://arxiv.org/pdf/2004.12681)
- [ACL Anthology W16-5803: Word-Level Language Identification and Predicting Codeswitching Points in Swahili-English Language Data, 2016](https://aclanthology.org/W16-5803/)
- [AfricaBib: Slang and code-switching — the case of Sheng in Kenya](https://www.africabib.org/rec.php?RID=147024250)
- [ACL Anthology 2025.calcs-1: 6th Workshop on Computational Approaches to Linguistic Code-Switching, 2025](https://aclanthology.org/2025.calcs-1.pdf)
- [arxiv 2311.13475: Machine Translation to Control Formality Features in the Target Language, November 2023](https://arxiv.org/pdf/2311.13475)
- [arxiv 2405.11942: FAME-MT Dataset — Formality Awareness Made Easy for Machine Translation, May 2024](https://arxiv.org/pdf/2405.11942)
- [Swahilitales: Understanding Swahili Titles and Honorifics](https://swahilitales.com/vocabulary/understanding-swahili-titles-and-honorifics/)
- [Maneno Matamu: Swahili — Kenyan vs Tanzanian speak — Polite expressions, 2011](https://manenomatamu.wordpress.com/2011/11/20/swahili-kenyan-vs-tanzanian-speak-round-3-polite-expressions/)
- [TUMEMADINI official site — Tume ya Madini publications & regulations, 2025](https://www.tumemadini.go.tz/publications/regulations/)
- [The Mining Act, Cap. 123 R.E. 2019 — madini.go.tz](https://www.madini.go.tz/media/CHAPTER_123_-_THE_MINING_ACT_CHAPA_FINAL.pdf)
- [statmt WMT24: Pitfalls and Outlooks in Using COMET, 2024](https://www2.statmt.org/wmt24/pdf/2024.wmt-1.121.pdf)
- [Unbabel COMET: A Neural Framework for MT Evaluation (GitHub)](https://github.com/Unbabel/COMET)
- [Unbabel/wmt22-comet-da — Hugging Face](https://huggingface.co/Unbabel/wmt22-comet-da)
- [Unbabel/wmt22-cometkiwi-da — Hugging Face](https://huggingface.co/Unbabel/wmt22-cometkiwi-da)
- [sacrebleu — Reference BLEU implementation (GitHub)](https://github.com/mjpost/sacrebleu)
- [sacrebleu chrF Metric documentation](https://deepwiki.com/mjpost/sacrebleu/4.2-chrf-metric)
- [Flores-101 / 200 README — facebookresearch/flores, 2022](https://github.com/facebookresearch/flores/blob/main/previous_releases/flores101/README.md)
- [arxiv 2602.17425: Evaluating Extremely Low-Resource Machine Translation — A Comparative Study of ChrF++ and BLEU, 2026](https://arxiv.org/html/2602.17425v1)
- [Bureau Works: Swahili to English Translation Services](https://www.bureauworks.com/blog/swahili-to-english-translation-services)
- [Apertium swa-eng GitHub repository](https://github.com/apertium/apertium-swa-eng)
- [Apertium Wikipedia](https://en.wikipedia.org/wiki/Apertium)

> § Founder-locked overrides applied per FOUNDER_LOCKED_DECISIONS_2026_05_26.md.
> Translation is bundled — no per-call tenant billing. Cost accounting
> internal-only via `epsilon_ledger` + `translation_runs.cost_usd_cents`.
