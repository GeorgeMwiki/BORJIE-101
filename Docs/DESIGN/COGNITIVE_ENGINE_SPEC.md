# Cognitive Engine — Design Specification

> Wave 18T / cross-layer framing — the canonical contract for "the MD
> **thinks before he speaks**, cites everything, asks before guessing,
> ingests on demand." This spec defines the **foundation layer** that
> sits UNDERNEATH all five atomic capabilities in
> [`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md). Every
> capability invocation routes through this layer first.

Status: design-spec. Phase 2 ships `packages/cognitive-engine/` +
migration `0024_cognitive_engine.sql` + three api-gateway routes + three
persona-kernel tools. Reuses (does NOT duplicate) existing span-citation
contract, source-quality scorer, intent recogniser, file-ingest adapters,
audio-capture STT, document-analysis extractors, audit-hash-chain, and
the `@borjie/brain-llm-router` cost-cascade.
Brand: Borjie. Persona: Mr. Mwikila (Managing Director).
Charter: [`Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md`](../MASTER_BRAIN_AUTONOMY_MANIFESTO.md).

Sibling specs:

- Universal-creator contract: [`Docs/DESIGN/CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md) (Wave 18Q).
- READ side: [`Docs/DESIGN/UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md) (Wave 18R).
- WRITE side: [`Docs/DESIGN/MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md) (Wave 18S).
- Deep research: [`Docs/DESIGN/DEEP_RESEARCH_SPEC.md`](./DEEP_RESEARCH_SPEC.md) (Wave 17C / 18D / 18E).
- Anticipatory UX: [`Docs/DESIGN/ANTICIPATORY_UX_SPEC.md`](./ANTICIPATORY_UX_SPEC.md) (Wave 17B / 18B / 18F).
- Document composition: [`Docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md`](./DOCUMENT_COMPOSITION_SPEC.md) (Wave 17D / 18C / 18G).
- Media generation: [`Docs/DESIGN/MEDIA_GENERATION_SPEC.md`](./MEDIA_GENERATION_SPEC.md) (Wave 18N).
- Marketing & promotion: [`Docs/DESIGN/MARKETING_PROMOTION_SPEC.md`](./MARKETING_PROMOTION_SPEC.md) (Wave 18P).

---

## 1. Vision

Founder, verbatim:

> "Don't forget deep thinking, analysis and insights needs to be default
> for the MD always — critical and thoughtful, never hallucinating,
> bullshitting etc. Full intelligence — if user is new and wants report
> or image on something, Borjie can talk to them, understand their needs,
> request data, query and table the data accordingly, identify and use
> only relevant data pieces to context from silos given say Excel or CSV
> files etc."

The Cognitive Engine is what makes Mr. Mwikila feel like a real senior
advisor instead of a chatbot. It is the **reasoning + grounding +
interactive layer** that sits UNDERNEATH all five atomic capabilities
(`research_v1`, `compose_tab_v1`, `compose_doc_v1`, `compose_media_v1`,
`compose_campaign_v1`) and the WRITE-side mutations from
`MUTATION_AUTHORITY_SPEC`. Every capability invocation routes through
this layer first. The output of every turn — regardless of which
capability fires — is:

- **Reasoned** — explicit deliberation phase before action, not pattern matching.
- **Grounded** — every factual claim carries a span-level citation; uncited claims are rejected by a pre-output validator.
- **Calibrated** — `high | medium | low | refused` confidence label is computed (not assumed) from source quality + cross-source agreement + corpus consistency + recency.
- **Scoped** — only the data joins, corpus rules, and research results actually relevant to THIS turn are attached to context; the rest of the tenant is excluded.
- **Interactive when needed** — for ambiguous intents, the MD asks 2-3 minimally-invasive clarifying questions before invoking any expensive capability.
- **Adaptive-ingestion-aware** — the owner can drop an Excel, CSV, PDF, image, or audio file mid-conversation; the kernel parses on the fly, PII-redacts at the boundary, type-infers columns, picks the rows relevant to the intent, and stamps the parsed payload as a session-scoped `DataJoinRef` available to all five capabilities for the rest of the session.

A new owner can drop in an Excel file, say *"give me a board pack from
this"*, and the MD asks 2-3 clarifying questions, parses the data, picks
ONLY the relevant rows, composes the doc with citations, and surfaces
uncertainty where evidence is thin. **That** is what this spec
guarantees.

---

## 2. The Six Cognitive Disciplines

Each discipline is a named, separately-testable contract inside the
engine. The 6 disciplines compose into the **Cognitive Loop** (§3).

### Discipline 1 — Deliberate Reasoning by Default

Every turn includes an explicit `<reasoning>` phase before action. The
engine uses Anthropic Claude's extended thinking parameter (`thinking:
{ budgetTokens }` on `BrainLLMRequest`) with a per-turn budget: 2000
tokens for simple turns, 8000 for compose-heavy turns, 32000 for
deep-dive research. The reasoning trace contains: intent classification,
evidence inventory, sufficiency check, plan steps, expected confidence.

The trace is private to the kernel by default and NOT surfaced in chat.
It IS captured in the audit-chain entry and surfaced in the
"explain reasoning" toggle in the audit panel. When the reasoning surfaces
an "I should ask the user first" insight, the kernel acts on it (it asks
the question) rather than ignoring its own conclusion.

Invocation: `deliberateReasoner({ utterance, contextDigest, isNewUser }) → ReasoningTrace`.

### Discipline 2 — Cite or Stay Silent

Every factual claim in every output carries a span-level `citation_id`
referencing corpus, research results, data joins, or owner uploads. The
**cite-validator** scans the candidate output for factual-claim
sentences (numbers, dates, names, regulator references, statistics) via
a Haiku 4.5 classifier and then deterministically confirms each claim
sentence has a `citation_id` whose source artifact exists.

Failure modes:

1. **Uncited claim sentence** → rewrite to `"[unverified — please confirm]"` OR remove the sentence and reduce confidence by one tier.
2. **Citation `citation_id` points to a non-existent source** → reject the entire output (citation faking is the loudest signal of hallucination).
3. **>20% of sentences in the output failed validation** → reject the output, surface "I don't have enough verified evidence yet — please provide X" + an explicit `DataRequest`.

This applies uniformly to text, doc sections, image captions, video
voiceovers, marketing copy, KPI claims — every form of output.

### Discipline 3 — Calibrated Uncertainty

Every output carries a confidence label computed from a deterministic
formula (§8). Confidence is never assumed; it is derived from the
sources actually used. Low-confidence outputs surface a yellow "verify
before relying" badge in the UI and include uncertainty notes
("Source A and Source B disagree on the rate — recommend confirming
with TRA before committing"). Below a hard floor (score ≤ 0.4), the MD
**refuses** to produce the output and proposes a research step instead.

### Discipline 4 — Interactive Scoping

When the owner's intent is ambiguous (especially for new users in their
first 14 days), the MD asks 2-3 clarifying questions BEFORE invoking any
expensive capability. Questions are minimally invasive — `"Which mine
site is this for?"` not `"Tell me everything about your operation"`.
After 3 questions max, the MD commits to a best-guess interpretation and
produces the artifact with explicit `"I assumed X, Y, Z — correct me"`
framing.

Triggers for scoping:

- `intent_confidence < 0.7` → ask 1-2 questions.
- `evidence_inventory` shows a critical data join is missing → ask for upload OR a query.
- New user (< 14 days since first sign-in) AND broad intent (`"make me a report"`) → 3-question scoping conversation.
- Recent owner override (`"just do it"`, `"I trust you, decide"`) → bypass scoping; document assumptions in the output.

### Discipline 5 — Relevance Pruning

The MD's context window for any given turn includes ONLY the data joins,
corpus rules, research results, and Tier-II/III UI-state snapshots
actually needed for THIS turn — not the whole tenant. A relevance
scorer (LLM-driven or vector-similarity-based) ranks candidate context
items and includes the top-N within token budget. Irrelevant data is
excluded. This is what makes the MD scalable across tenants with
millions of rows.

The scorer reuses `@borjie/research-tools` source-quality scoring for
external evidence and adds a tenant-internal similarity scorer that
ranks tables, fields, recent UI events, and corpus chunks against the
intent + utterance embedding.

### Discipline 6 — Adaptive Ingestion

The owner can drop a file (Excel, CSV, PDF, image, audio) into chat at
any moment. The kernel parses it on the fly:

- **Excel / CSV** → SheetJS (`xlsx`) / fast-csv to parse → column type inference → PII detection at boundary (email, phone, KRA-PIN, NIDA) → tenant-scoped Supabase Storage write → register as a `DataJoinRef` in the cognitive turn's context.
- **PDF** → existing `@borjie/document-analysis` pipeline → text + image + table extraction; for image-heavy PDFs, Anthropic Haiku 4.5 vision extracts charts and diagrams → same DataJoinRef contract.
- **Image** → Anthropic Haiku 4.5 vision → caption + OCR → structured payload → DataJoinRef.
- **Audio** → existing `@borjie/audio-capture` Whisper STT → transcription → DataJoinRef.

Every ingest carries a default **14-day TTL**; the owner can pin a
longer retention from the chip menu. PII is redacted at the boundary by
the existing `file-ingest/schema-sniff/pii-redactor.ts` patterns.

---

## 3. The Cognitive Loop

The canonical request flow per turn:

```
+-------------------------------------------------------------+
|  Owner intent (chat / voice / passive capture / upload)      |
+-----------------------------+-------------------------------+
                              v
   +-------------------------------------------------+
   |  D1: Deliberate Reasoning                        |
   |  - Intent classification                         |
   |  - Evidence inventory: corpus / data / research  |
   |  - Sufficiency check: act, or must I ask?        |
   +--+-------------------------------------------+--+
      | sufficient                                | insufficient
      |                                            v
      |                       +------------------------------------+
      |                       |  D4: Interactive Scoping            |
      |                       |  - 2-3 clarifying questions         |
      |                       |  - OR request file upload           |
      |                       +-----------------+-------------------+
      |                                         v
      |                       +------------------------------------+
      |                       |  D6: Adaptive Ingestion             |
      |                       |  - Parse Excel / CSV / PDF / img    |
      |                       |  - Type-infer, PII-redact           |
      |                       |  - Stamp as DataJoinRef             |
      |                       +-----------------+-------------------+
      |                                         |
      v                                         v
   +-------------------------------------------------+
   |  D5: Relevance Pruning                           |
   |  - Score candidate context items                 |
   |  - Keep top-N within token budget                |
   +-----------------------+--------------------------+
                           v
   +-------------------------------------------------+
   |  Dispatch via compose_anything_v1 (18Q)          |
   |  - research_v1 / compose_tab_v1 /                |
   |    compose_doc_v1 / compose_media_v1 /           |
   |    compose_campaign_v1 / mutate_*_v1             |
   +-----------------------+--------------------------+
                           v
   +-------------------------------------------------+
   |  D2: Cite or Stay Silent (validator)             |
   |  - Every claim has a citation_id                 |
   |  - Reject + rewrite if any uncited claim         |
   +-----------------------+--------------------------+
                           v
   +-------------------------------------------------+
   |  D3: Confidence Calibration                      |
   |  - Compute high / medium / low / refused         |
   |  - Surface in UI badge                           |
   |  - Refuse output if below floor                  |
   +-----------------------+--------------------------+
                           v
   +-------------------------------------------------+
   |  Audit-chain entry + Owner-touch-point logged    |
   +-------------------------------------------------+
```

The loop is **idempotent within a turn** — re-running it with the same
inputs yields the same `audit_hash`. The audit-chain link follows the
same `@borjie/audit-hash-chain` contract as the rest of the platform
(Wave 6).

---

## 4. The `CognitiveTurn` Contract

```typescript
export interface CognitiveTurnInput {
  readonly turn_id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly session_id: string;
  readonly utterance: string;                       // chat text
  readonly voice_transcript?: string;
  readonly attachments?: ReadonlyArray<AttachmentRef>;
  readonly passive_capture?: PassiveCaptureSnapshot;
  readonly ui_state_snapshot?: UiStateGraph;
  readonly is_new_user: boolean;                    // <14 days since first sign-in
  readonly active_authority_tier_max: 0 | 1 | 2;
}

export interface CognitiveTurnOutput {
  readonly turn_id: string;
  readonly reasoning_trace: ReasoningTrace;         // private by default; audit-only on demand
  readonly path:
    | 'asked_for_clarification'
    | 'asked_for_data'
    | 'composed_output'
    | 'refused_low_confidence';
  readonly questions?: ReadonlyArray<ClarifyingQuestion>;
  readonly requested_data?: ReadonlyArray<DataRequest>;
  readonly artifact_ref?: { kind: string; id: string };
  readonly confidence: 'high' | 'medium' | 'low' | 'refused';
  readonly citations: ReadonlyArray<SpanCitation>;
  readonly uncertainty_notes?: ReadonlyArray<UncertaintyNote>;
  readonly cost_usd_cents: number;
  readonly duration_ms: number;
  readonly audit_hash: string;
}

export interface ReasoningTrace {
  readonly intent_classification: { intent: string; confidence: number };
  readonly evidence_inventory: ReadonlyArray<EvidenceItem>;
  readonly sufficiency: 'sufficient' | 'needs_clarification' | 'needs_data' | 'needs_research';
  readonly plan_steps: ReadonlyArray<PlanStep>;
  readonly expected_confidence: 'high' | 'medium' | 'low';
  readonly cost_estimate_usd_cents: number;
}

export interface ClarifyingQuestion {
  readonly question: string;
  readonly possible_answers?: ReadonlyArray<string>;
  readonly why_needed: string;                      // explained to the user
}

export interface DataRequest {
  readonly kind: 'excel' | 'csv' | 'pdf' | 'image' | 'audio' | 'manual_form';
  readonly description: string;                     // "your last 3 months of FX positions"
  readonly required: boolean;                       // vs. optional-but-helpful
  readonly why_needed: string;
}

export interface AdaptiveIngestResult {
  readonly attachment_id: string;
  readonly kind: 'excel' | 'csv' | 'pdf' | 'image' | 'audio';
  readonly storage_key: string;
  readonly parsed_columns: ReadonlyArray<ColumnSpec>;
  readonly parsed_rows_count: number;
  readonly pii_redactions: ReadonlyArray<PiiRedaction>;
  readonly inferred_data_join_ref: DataJoinRef;
  readonly relevance_to_intent: number;             // 0..1
  readonly audit_hash: string;
}
```

`SpanCitation` reuses the existing
`packages/research-tools/src/types.ts::SpanCitationSchema`. `ReasoningTrace`
is captured in the `cognitive_turns.reasoning_trace` JSONB column (§11).

---

## 5. Anti-Hallucination Enforcement (Cite-Validator)

Concrete pipeline applied to every `compose_*` output before it leaves
the engine:

1. **Claim extraction.** Run a Haiku 4.5 classifier (`claim-extractor.ts`) over each candidate sentence. A claim is any sentence containing a number, date, named entity, regulator reference, statistic, comparative ("higher than", "the largest"), or definite assertion about external state. Opinion/recommendation sentences are excluded.
2. **Citation resolution.** For each claim sentence, the validator looks up the `citation_id` markers (`[cit_xyz]`-style) and confirms each id exists in the turn's `EvidenceInventory` AND the cited artifact actually contains the claim (via the existing span-citation Jaccard match).
3. **Per-sentence verdict.** PASS / UNCITED / FAKED.
4. **Rewrite or reject.** UNCITED sentences are rewritten to `"[unverified — please confirm]"` and `confidence` is reduced one tier. FAKED citations reject the entire output. If >20% of sentences are UNCITED or FAKED, the entire output is rejected and replaced with a `requested_data` payload.
5. **Refusal-with-path-forward.** A rejection always proposes the next step: which data to upload, which corpus rule to consult, or which research step to invoke. The MD never refuses without offering a path forward.

---

## 6. Interactive Scoping Protocol — Decision Table

| Situation | Action |
|---|---|
| `intent_confidence >= 0.85` AND evidence sufficient | Compose immediately. |
| `intent_confidence < 0.7` | Ask 1-2 clarifying questions. |
| Evidence inventory missing a critical data join | Issue `DataRequest`; do NOT compose. |
| New user + broad intent ("make me a report") | 3-question scoping conversation. |
| Owner override in recent context ("just do it") | Bypass scoping; document the assumptions in the output. |
| 3 questions already asked this turn | Commit at best-guess + explicit assumption block. |
| Refused output at `confidence ≤ 0.4` | Propose a research step or data upload; never refuse silently. |

Questions are minimally invasive. Bad: `"Tell me about your operation."`
Good: `"Which mine site — Geita-3 or Buzwagi?"`. Good:
`"Should I assume Q1 2026 or last quarter?"`. The
`question-generator.ts` enforces a 25-word cap per question and rejects
questions that ask >1 thing at once.

---

## 7. Adaptive Ingest Pipeline

```
Excel / CSV  -> SheetJS / fast-csv -> column-type-inferer ->
                pii-redactor (boundary) -> tenant-storage -> DataJoinRef

PDF          -> @borjie/document-analysis pipeline (text + tables) ->
                Haiku 4.5 vision for chart-heavy pages -> DataJoinRef

Image        -> Anthropic Haiku 4.5 vision -> caption + OCR ->
                pii-redactor (text content) -> DataJoinRef

Audio        -> @borjie/audio-capture Whisper -> transcript ->
                pii-redactor (text content) -> DataJoinRef
```

All ingests carry a 14-day TTL by default. The owner can pin from the
chip menu; pinned attachments inherit the surrounding session's
retention policy. PII is hashed at the boundary using the existing
`file-ingest/schema-sniff/pii-redactor.ts` patterns. Storage paths are
tenant-keyed: `tenants/{tenant_id}/cognitive-ingest/{session_id}/{attachment_id}.{ext}`.

---

## 8. Confidence Calibration — Formula

```
confidence_score = w_source     * mean_source_quality
                 + w_agreement  * cross_source_agreement_rate
                 + w_corpus     * corpus_consistency_rate
                 + w_recency    * (1 - days_since_evidence / 90)

  where the weights default to:
    w_source    = 0.40
    w_agreement = 0.30
    w_corpus    = 0.20
    w_recency   = 0.10

confidence_label =
  'high'    if confidence_score >= 0.75 AND uncited_claims = 0
  'medium'  if confidence_score >= 0.50 AND uncited_claims <= 1
  'low'     if confidence_score >= 0.30
  'refused' otherwise
```

- `mean_source_quality` reuses `@borjie/research-tools::scoreSource` (9-class rubric, 0..1).
- `cross_source_agreement_rate` is computed by an LLM cluster-agreement check (Haiku 4.5) — 1.0 if all citations corroborate, lower as they diverge.
- `corpus_consistency_rate` checks the output against the owner's own corpus (no contradiction = 1.0).
- `days_since_evidence` uses the median publication date of the cited sources.

The thresholds (0.75 / 0.50 / 0.30) are configurable per tenant via a
governance override entry in `routing_overrides` (Wave WX port 7) so
high-stakes tenants can tighten the floors.

---

## 9. What "Thinking" Looks Like Operationally

- **Extended thinking budget per turn:** 2 000 tokens for simple turns (greeting, single-field query), 8 000 for compose-heavy turns (doc / image / campaign), 32 000 for deep-dive research.
- **Trace visibility:** private by default in chat; surfaced in the audit panel; included verbatim in the `cognitive_turns.reasoning_trace` row.
- **"I should ask" insights** must result in a question being asked. The kernel runs a self-check on the reasoning trace: if the trace contains `sufficiency: 'needs_clarification' | 'needs_data'`, the loop **must** route to D4, not D5.
- **Cost-cascade integration:** the deliberate-reasoner picks the cheapest model that still scores ≥ 0.6 on the trace's plan-quality eval. Haiku 4.5 for simple intents, Sonnet for compose-heavy, Opus reserved for sufficiency-critical edge cases (configurable).

---

## 10. Anti-Patterns

- Produce confident-sounding output without earning the confidence.
- Ask >3 clarifying questions in a row (decision paralysis — commit at 3 with explicit assumptions).
- Attach the whole tenant data to every turn (token waste; relevance pruning required).
- Accept an uploaded file without PII redaction.
- Cite a source that doesn't actually contain the claim (citation faking).
- Refuse to produce output without proposing the next step (always offer a path forward).
- Hide reasoning from the audit chain.
- Cache a turn's reasoning trace across tenants.
- Treat a tenant override of "just do it" as permanent — it expires at session end.

---

## 11. Schema Additions

Migration `0024_cognitive_engine.sql` adds three tenant-scoped tables:

```sql
CREATE TABLE cognitive_turns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       text NOT NULL,
  user_id         text NOT NULL,
  session_id      uuid NOT NULL,
  utterance       text NOT NULL,
  reasoning_trace jsonb NOT NULL,
  path            text NOT NULL,
  artifact_ref    jsonb,
  confidence      text NOT NULL,
  citations       jsonb NOT NULL,
  uncertainty_notes jsonb,
  cost_usd_cents  integer,
  duration_ms     integer,
  audit_hash      text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cog_session_recent_idx
  ON cognitive_turns(session_id, occurred_at DESC);

CREATE TABLE ingested_attachments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          text NOT NULL,
  session_id         uuid NOT NULL,
  user_id            text NOT NULL,
  kind               text NOT NULL,
  storage_key        text NOT NULL,
  original_filename  text,
  parsed_columns     jsonb,
  parsed_rows_count  integer,
  pii_redactions     jsonb,
  data_join_ref      jsonb NOT NULL,
  relevance_to_intent numeric(3,2),
  retention_until    timestamptz NOT NULL,
  audit_hash         text NOT NULL,
  ingested_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clarifying_question_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id          uuid NOT NULL REFERENCES cognitive_turns(id),
  question         text NOT NULL,
  possible_answers jsonb,
  why_needed       text NOT NULL,
  user_response    text,
  asked_at         timestamptz NOT NULL DEFAULT now(),
  answered_at      timestamptz
);
```

All three tables enable RLS under the canonical `app.tenant_id` GUC
pattern (migration 0003). Confidence enum is constrained to
`high|medium|low|refused`. Path enum is constrained to
`asked_for_clarification|asked_for_data|composed_output|refused_low_confidence`.

---

## 12. Phase 2 Implementation Map

- New package `packages/cognitive-engine/` (this wave creates the scaffold).
- New api-gateway routes:
  - `POST /api/v1/cognitive/turn` — submit an utterance, receive a `CognitiveTurnOutput`.
  - `POST /api/v1/cognitive/ingest` — upload a file, receive `AdaptiveIngestResult`.
  - `GET  /api/v1/cognitive/reasoning-trace/:turn_id` — fetch the trace for the audit panel.
- Wire the kernel composition root so every `compose_anything_v1` invocation routes through the cognitive engine first (a thin wrapper — does NOT modify existing capabilities).
- Migration file `packages/database/drizzle/0024_cognitive_engine.sql` with the three tables above + Drizzle schema in `packages/database/src/schemas/cognitive-engine.schema.ts`.
- Persona-kernel tool additions:
  - `ask_clarifying_question_v1` — emit a `ClarifyingQuestion` to the chat surface.
  - `request_data_v1` — emit a `DataRequest` chip with upload affordance.
  - `ingest_attachment_v1` — drive the AdaptiveIngestResult flow.

---

## 13. Acceptance Criteria

- Every `compose_*` output produced via the kernel carries a confidence label, ≥1 citation per factual claim, and a `cognitive_turns` row.
- New-user (< 14 days) + broad intent → at least one clarifying question OR data request before any expensive capability fires.
- Uncited factual claims are either rewritten to "unverified" or the output is rejected.
- Adaptive ingest of an Excel file with PII (emails / phones / NIDA / KRA-PIN) produces a parsed payload where the PII columns are hashed, not in cleartext, in any stored artifact.
- The reasoning trace is captured in `cognitive_turns.reasoning_trace` AND audit-chain hashed AND surfaced in the audit panel "explain reasoning" toggle.
- A tenant-config override can tighten the confidence floor from 0.75 to 0.85 without code changes.

---

## 14. Cross-References

- Universal-creator dispatch contract: [`CAPABILITIES_UNIFICATION.md`](./CAPABILITIES_UNIFICATION.md) §3 (`compose_anything_v1`).
- READ-side observability tiers consumed for evidence: [`UNIVERSAL_OBSERVABILITY_SPEC.md`](./UNIVERSAL_OBSERVABILITY_SPEC.md) §2.
- WRITE-side mutations that route through this engine: [`MUTATION_AUTHORITY_SPEC.md`](./MUTATION_AUTHORITY_SPEC.md) §4.
- Source-quality scorer reused by the calibrator: `packages/research-tools/src/scorer/source-quality.ts`.
- Span-citation contract reused by the cite-validator: `packages/ai-copilot/src/retrieval/span-citations.ts`.
- File-ingest PII redactor reused by the adaptive-ingest pipeline: `packages/file-ingest/src/schema-sniff/pii-redactor.ts`.
- Existing intent recogniser used as the keyword-floor before the LLM classifier: `packages/dynamic-ui/src/intent-recognition.ts`.
- LLM routing surface (extended-thinking budget + cost cascade): `packages/brain-llm-router/`.
