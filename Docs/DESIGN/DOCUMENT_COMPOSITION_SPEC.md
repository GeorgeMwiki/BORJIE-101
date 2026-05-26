# Document Composition Specification — Borjie

> Wave 17 / foundational layer #3 — the persistent artefact layer of the MD's autonomy.

Status: design-spec (Phase 2 implementation pending).
Brand: Borjie.
Persona: Mr. Mwikila (Managing Director).
Sibling specs:
- `docs/DESIGN/ANTICIPATORY_UX_SPEC.md` — ephemeral interactive surfaces (Wave 17B).
- `docs/DESIGN/DEEP_RESEARCH_SPEC.md` — research-evidence layer (Wave 17C).

---

## 1. Vision

> "Even in all document types creation too. The MD as dynamic UI designer + UX optimizer, not just a tab-spawner." — founder, verbatim follow-up.

Documents are the **persistent artefact layer** of Mr. Mwikila's autonomy. Where the Anticipatory UX layer covers ephemeral interactive surfaces (tabs, wizards, prefilled forms) and the Deep Research layer covers grounded evidence, **this layer covers durable outputs** — board reports, investor briefings, Tumemadini monthly returns, buyer KYB packs, SOPs, financial models, contracts, daily briefings, geological reports, marketplace listings, regulator emails.

Mr. Mwikila composes documents like a senior MD would: not from static templates frozen at install, but with **dynamic structure choice, citation embedding, brand-locked rendering, and lock/improve evolution under human-in-the-loop approval**. The same evidence that informs a research result becomes a citation footnote in the next board report. The same approval queue that gates a Tier-2 action gates a Tier-2 outbound document. The same audit chain that records every persona handoff records every produced doc.

A senior MD does not push send on a Tumemadini return without re-reading it. Mr. Mwikila does not either.

---

## 2. The 11 Document Classes Borjie Composes

| # | Class | Use case (when Mr. Mwikila reaches for it) | Output format(s) | Authority tier | Citation density |
|---|---|---|---|---|---|
| 1 | **Daily Briefing** | Owner morning summary — overnight events, FX shifts, ore-parcel deltas, regulator notices | MD (in-app), then PDF | Tier 1 | high |
| 2 | **Board Report** | Quarterly multi-section board pack — production, finance, compliance, risk, outlook | DOCX + PDF | Tier 1 | extreme |
| 3 | **Investor Briefing** | Investor deck — narrative, financials, ore-reserve update, deal terms | PPTX + PDF | Tier 1 | extreme |
| 4 | **Tumemadini Return** | Monthly regulatory filing (Tanzania Mining Commission) | PDF (official) | Tier 2 | extreme (per regulation) |
| 5 | **NEMC Filing** | Environmental compliance filing (National Environment Management Council) | PDF (official) | Tier 2 | high |
| 6 | **Buyer KYB Pack** | Counterparty KYB bundle — licenses, beneficial-ownership, sanctions, AML | PDF bundle | Tier 2 | high |
| 7 | **SOP** | Internal Standard Operating Procedure — shaft inspection, blast prep, payroll | DOCX | Tier 1 | medium |
| 8 | **Financial Model** | FX hedge / production-cost / NPV / scenario model | XLSX | Tier 1 | high (per assumption) |
| 9 | **Contract** | Buyer / supplier / counterparty / employment contract | DOCX + DocuSign | Tier 2 | extreme |
| 10 | **Geological Report** | Drill-results synthesis + interpretation | PDF (charts + text) | Tier 1 | high |
| 11 | **Marketplace Listing** | Ore-parcel for-sale page with assay certs | HTML + PDF tear-sheet | Tier 1 | high (per assay cert) |

The 11 classes are the **closed set** for v1. New classes require a new `DocumentRecipe.class` enum value plus a passing `documentClassDiscipline.test.ts` case. Anything outside the 11 is rendered via the AdaptiveRenderer in-app (transient) and never persisted as a document artefact.

---

## 3. The `DocumentRecipe` Contract

```typescript
type DocumentClass =
  | 'daily_briefing'
  | 'board_report'
  | 'investor_briefing'
  | 'tumemadini_return'
  | 'nemc_filing'
  | 'buyer_kyb_pack'
  | 'sop'
  | 'financial_model'
  | 'contract'
  | 'geological_report'
  | 'marketplace_listing';

interface DocumentRecipe {
  readonly id: string;                          // 'tumemadini_monthly_return', 'investor_quarterly'
  readonly class: DocumentClass;
  readonly version: number;
  readonly status: 'draft' | 'shadow' | 'live' | 'locked' | 'deprecated';
  readonly compose: (ctx: DocComposeContext) => Promise<DocumentArtifact>;
  readonly required_inputs: ReadonlyArray<InputContract>;
  readonly required_citations: ReadonlyArray<CitationContract>;
  readonly output_formats: ReadonlyArray<'pdf' | 'docx' | 'pptx' | 'xlsx' | 'md' | 'html'>;
  readonly authority_tier: 0 | 1 | 2;
  readonly brand: 'borjie';
  readonly approval_required: boolean;          // Tier 2 always requires owner approval before send
}

interface DocComposeContext {
  readonly tenant_id: string;
  readonly intent_payload: unknown;             // what triggered this composition
  readonly available_data: DataJoin[];          // ore parcels, FX positions, etc.
  readonly research_result_id: string | null;   // link to Deep Research spec's research_results
  readonly owner_profile: OwnerProfile;
  readonly mastery_tier: 'novice' | 'fluent' | 'veteran';
  readonly target_audience: 'owner' | 'regulator' | 'investor' | 'buyer' | 'internal';
  readonly language: 'en' | 'sw';
}

interface DocumentArtifact {
  readonly id: string;
  readonly recipe_id: string;
  readonly recipe_version: number;
  readonly format: 'pdf' | 'docx' | 'pptx' | 'xlsx' | 'md' | 'html';
  readonly storage_key: string;                 // Supabase Storage path
  readonly checksum: string;
  readonly span_citations: ReadonlyArray<SpanCitation>;
  readonly audit_hash: string;
  readonly approval_state: 'pending' | 'approved' | 'rejected' | 'auto_published';
  readonly approved_by: string | null;
  readonly approved_at: string | null;
}
```

Recipes are versioned. A live recipe never mutates in place — improvement proposals create version `n+1` in `shadow` state, which is promoted to `live` only after owner approval. Locked recipes refuse all auto-improvement signals until manually unlocked.

---

## 4. The 4 Layers of Document Composition

Mirrors the Anticipatory UX 4-layer model for consistency.

### Layer 1 — Intent Binding

A trigger event (cron schedule, chat intent, threshold breach, regulator deadline, owner explicit request) selects a `DocumentRecipe.id`. The router is the same `persona-router` already wired in `packages/ai-copilot/src/personas/` — extended with a `doc_intent → recipe_id` map. No fuzzy matching at this layer; intent → recipe is a deterministic table lookup.

### Layer 2 — Dynamic Structure Composition

The composer takes the recipe + the `DocComposeContext` and **assembles** rather than fills-blanks. Operations:

- **Section list** — chosen from a recipe-declared library based on `target_audience`, `mastery_tier`, and `available_data` (e.g. a quarterly board report drops the "outlook" section if no forward-looking research result is available).
- **Inputs** — joined from corpus + data joins + research-result citations. Missing required inputs short-circuit composition with an `INPUT_GAP` event surfaced to the approval queue.
- **Citation embedding** — every numeric / dated / regulatory claim is paired with a span citation at compose time, not after. Reuses the existing `packages/document-studio/src/citations/citation-verifier.ts` regex enforcement plus the broader `span-citations.ts` contract from `packages/ai-copilot/src/retrieval/`.
- **Boilerplate clauses** — pulled from regulatory rule engines (Tumemadini, NEMC, TRA) keyed by jurisdiction + filing-period. Rule engines live alongside existing compliance services and are versioned independently of recipes.
- **Localisation** — `en` / `sw` per `owner_profile.preferred_language`; regulator docs lock to the language the regulator accepts.
- **Tone** — formal-regulatory vs. investor-narrative vs. owner-conversational, expressed as system-prompt overlays on the composer LLM call.

### Layer 3 — Brand-Locked Rendering

Same brand discipline as the UX spec. Every binary format goes through a Borjie-branded renderer that enforces:

- Borjie wordmark + signature gradient in headers and footers.
- OKLCH palette only — no off-brand hex literals, ever. Tokens come from `packages/design-system/`.
- Typography: `font-display` family for headings, `font-mono` for kickers and metadata, `font-sans` for body.
- Spacing scale from design-system tokens (`spacing-1` … `spacing-12`).
- Citation footnotes formatted consistently across formats.
- Watermarks for `draft` vs. `final` (visible only on draft).
- Mr. Mwikila signature block on Tier-1 docs and a regulator-signature block on Tier-2.

DOCX / PPTX / XLSX renderers enforce the same brand contract via **brand-locked template skeletons** checked into a new package `packages/document-templates/` — extending the existing `report-engine` and `document-studio` template patterns. The renderer pipeline is:

1. Composer emits a **brand-agnostic intermediate representation** (`IRDoc`) — sections, blocks, citations, references.
2. The format-specific brander (`pdf-brander.ts`, `docx-brander.ts`, `pptx-brander.ts`, `xlsx-brander.ts`) walks the IRDoc and emits the final binary.
3. A `brand-lint` step verifies all colors are token references and all fonts are registered before the artefact is persisted.

### Layer 4 — Continuous Doc Optimization

Every produced doc emits feedback signals. A nightly job (new service `services/doc-evolution-worker/`) aggregates them per `DocumentRecipe`:

- **Acceptance signal** — recipient (owner, regulator, counterparty) accepted on first submit.
- **Revision signal** — recipient asked for changes; which sections were revised.
- **Owner-rewrite signal** — owner edited specific sections; diff captured.
- **Regulator-flag signal** — regulator sent back the filing with annotations.
- **Time-to-approve signal** — seconds between MD compose and owner approve.

These signals drive lock/improve decisions and **generate improvement proposals** under the same human-in-the-loop pattern as the Anticipatory UX layer: a proposal is a section-level diff against the current live version, carrying its own citation set explaining *why* the change is proposed. Owner sees the proposal in a unified approval queue and Approves / Rejects / Edits-and-Approves.

---

## 5. Tool Integrations — Concrete 2026 Picks

| Concern | Tool | Why |
|---|---|---|
| PDF primary path | **Puppeteer + Chromium** | HTML → PDF at print fidelity; already wired in `pdf-from-html-renderer.ts`. Playwright is a drop-in alternate. |
| PDF forms + signing fields | **pdf-lib** | Form-field manipulation + signature placeholders that DocuSign can consume. |
| DOCX | **`docx` npm package** | Still SOTA in 2026 for programmatic DOCX; existing `report-engine` and `document-studio` precedent. |
| XLSX | **ExcelJS** | Financial models with formulas, cell comments (used for citations), named ranges, multi-sheet workbooks. |
| PPTX | **pptxgenjs** | Investor decks with charts, brand-locked masters, speaker notes carrying citations. |
| HTML / Markdown | **AdaptiveRenderer + MarkdownCard** | Existing in-app render path; no new infra. |
| Signing (Tier 2) | **DocuSign API** | Existing `packages/document-ai/src/e-signature/docusign-adapter.ts`; Dropbox Sign as fallback per `document-ai/types.ts` references. |
| Signing (Tier 0–1) | **Email-bot signed link** | Lightweight click-through for SOPs and internal docs. |
| Storage | **Supabase Storage** — bucket per class | `borjie-docs-tumemadini`, `borjie-docs-board`, etc. Each bucket gets per-tenant RLS and retention policy. |
| Audit chain | **`packages/audit-hash-chain/`** | Every produced doc emits one entry: `{recipe_id, recipe_version, checksum, span_citations, generated_at}`. HMAC secret per tenant. |
| Citations | **Anthropic Citations API + local verifier** | Generation-time grounding + post-render verifier already implemented in `document-studio/src/citations/citation-verifier.ts`. |

---

## 6. Citation Embedding Contract

Every claim in every doc carries a span-level citation. Format inside the doc:

- **PDF / DOCX** — footnote: `[doc:UUID p.PAGE] retrieved YYYY-MM-DD`.
- **XLSX** — cell comments with citation refs; a dedicated Appendix tab listing all citations.
- **PPTX** — speaker-notes footer with citations.
- **HTML / MD** — clickable inline chips (existing `[cite:<id>]` marker in `MarkdownCard.tsx`).

All citation strings reference the existing `SpanCitation` format from `packages/ai-copilot/src/retrieval/span-citations.ts`. The audit-chain entry bundles the doc checksum + every referenced research artefact id, making lineage queryable end-to-end (research → doc → audit).

**Hard rule**: a doc with any uncited numeric, monetary, dated, or regulatory claim is **refused** by the composer. The `citation-verifier.ts` regex enforcement runs pre-persistence.

---

## 7. Lock / Improve Policy for Documents

Decision table — mirror of the UX layer's table:

| Signal | Threshold | Outcome |
|---|---|---|
| 60-day rolling first-submit acceptance rate | > 80 % | Lock candidate |
| 60-day rolling revision rate | < 10 % | Lock candidate |
| Regulator-flagged issues (last 30 days) | 0 | Lock candidate |
| All above met for 90 consecutive days | yes | **LOCK** |
| 60-day acceptance rate | < 50 % | Improve candidate |
| Revision rate by section | > 20 % | Improve candidate |
| Regulator flag (any) | yes | Improve candidate |
| Improvement proposal pending | yes | **Shadow mode** |
| Owner approves proposal | yes | **Promote to live** |

A `locked` recipe ignores all improve signals until manually unlocked by the owner. This protects regulator-facing recipes (Tumemadini, NEMC) from drift once they have a clean record. Shadow mode runs the proposed version in parallel with the live version for N composes before being eligible for promotion.

---

## 8. Human-in-the-Loop Approval for Tier 2 Docs

Every Tier 2 document (Tumemadini return, NEMC filing, contract, KYB pack) goes through a full approval workflow:

1. Mr. Mwikila composes → `DocumentArtifact.approval_state = 'pending'`.
2. Owner sees the artefact in the unified approval queue alongside:
   - Diff vs. last accepted version of the same recipe (section-level).
   - Citation chips with hover-preview into source corpus.
   - Mastery-tier-appropriate explanation ("you previously approved this clause unchanged 4 times").
3. Owner action:
   - **Approve** → MD submits + audit-chains the approval action.
   - **Request Revision** → MD revises with owner's note in the prompt; status loops to `pending`.
   - **Reject** → MD logs reasoning, removes from queue, surfaces an `INTENT_BLOCKED` signal for evolution.
4. All transitions are audit-chained (`packages/audit-hash-chain/`).

Tier 1 docs (daily briefing, board report draft) may auto-publish to internal channels but trigger a passive notification rather than blocking approval. Tier 0 — currently no doc class lives at Tier 0; the closed set is Tier 1 and Tier 2 only.

---

## 9. Anti-Patterns

Composition MUST NOT:

- Auto-send a Tier 2 doc without owner approval. The composer pipeline lacks a path to publish without traversing the approval queue.
- Insert claims without citations. Verifier refuses pre-persistence.
- Render off-brand. `brand-lint` refuses raw HTML / non-token colors / unregistered fonts.
- Auto-revise an approved doc without surfacing the diff. Every revision is a new artefact id; the prior id is immutable.
- Lose a doc's lineage in the audit chain. Missing parent hash → `chain_break` audit signal → ops alarm.
- Generate a financial model without citing each assumption source. ExcelJS cell-comments enforce per-cell citation on every input-cell.
- Allow a locked recipe to be silently improved. Locked → all improve signals queued as proposals, none auto-applied.
- Cross brand. Borjie recipes never produce non-Borjie artefacts; BossNyumba is a sibling fork with its own recipe registry.

---

## 10. Phase 2 Implementation Plan

1. **New package `packages/document-templates/`** — recipe registry, composers (one per class), brand-locked renderers (`pdf-brander.ts`, `docx-brander.ts`, `pptx-brander.ts`, `xlsx-brander.ts`), IRDoc contract.
2. **New service `services/doc-evolution-worker/`** — nightly aggregation of `doc_feedback_events`, lock/improve decisions, proposal generation, audit-chain emission.
3. **New routes** in admin-api:
   - `POST /api/v1/docs/compose` — synchronous compose for owner-initiated docs.
   - `POST /api/v1/docs/approve` — Tier 2 approval action.
   - `POST /api/v1/docs/reject` — Tier 2 rejection with reasoning capture.
   - `GET /api/v1/docs/recipe/:id/proposals` — list pending improvement proposals.
   - `GET /api/v1/docs/artifact/:id` — fetch with citation chips expanded.
4. **Persona system-prompt additions** — new tools advertised in the persona registry:
   - `compose_doc_v1(recipe_id, intent_payload)` — generates the artefact.
   - `propose_doc_evolution_v1(recipe_id, diff, signals, citations)` — emits an improvement proposal.
   - `submit_for_approval_v1(artifact_id)` — moves to the approval queue.
5. **Brand discipline ESLint rule extension** — `borjie/no-non-token-in-doc-template`: refuses raw color literals, unregistered fonts, and inline HTML styles in any file under `packages/document-templates/`.
6. **New tables** — see Schema additions below.

---

## 11. Schema Additions

```sql
CREATE TABLE document_recipes (
  id text NOT NULL,                          -- 'tumemadini_monthly_return'
  version int NOT NULL,
  status text NOT NULL,                      -- draft|shadow|live|locked|deprecated
  class text NOT NULL,                       -- daily_briefing|board_report|...
  compose_fn_ref text NOT NULL,
  required_inputs jsonb NOT NULL,
  required_citations jsonb NOT NULL,
  output_formats text[] NOT NULL,
  authority_tier smallint NOT NULL,
  brand text NOT NULL DEFAULT 'borjie',
  approval_required boolean NOT NULL DEFAULT true,
  promoted_at timestamptz,
  promoted_by uuid REFERENCES users(id),
  locked_at timestamptz,
  PRIMARY KEY (id, version)
);

CREATE TABLE document_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recipe_id text NOT NULL,
  recipe_version int NOT NULL,
  format text NOT NULL,                      -- pdf|docx|pptx|xlsx|md|html
  storage_key text NOT NULL,
  checksum text NOT NULL,
  span_citations jsonb NOT NULL,
  audit_hash text NOT NULL,
  approval_state text NOT NULL DEFAULT 'pending', -- pending|approved|rejected|auto_published
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE doc_evolution_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  recipe_id text NOT NULL,
  current_version int NOT NULL,
  proposed_version int NOT NULL,
  proposed_diff jsonb NOT NULL,              -- section-level diff
  signals jsonb NOT NULL,                    -- which feedback triggered this
  citations text[] NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  proposed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  approval_audit_hash text
);

CREATE TABLE doc_feedback_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL REFERENCES document_artifacts(id),
  feedback_kind text NOT NULL,               -- accepted|revised|rejected|regulator_flag
  section_path text,                         -- 'sections.assays' if applicable
  detail jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX doc_artifacts_recipe_idx ON document_artifacts(recipe_id, recipe_version);
CREATE INDEX doc_artifacts_tenant_idx ON document_artifacts(tenant_id, generated_at DESC);
CREATE INDEX doc_artifacts_approval_idx ON document_artifacts(approval_state, generated_at);
CREATE INDEX doc_feedback_artifact_idx ON doc_feedback_events(artifact_id, feedback_kind);
CREATE INDEX doc_proposals_status_idx ON doc_evolution_proposals(status, recipe_id);
```

All tables are tenant-scoped and gated by Supabase RLS. Indexes are sized for the lock/improve worker's nightly scan and the approval-queue's owner-facing list.

---

## 12. Cross-References

- Anticipatory UX (sibling spec, Wave 17B): `docs/DESIGN/ANTICIPATORY_UX_SPEC.md`.
- Deep Research (sibling spec, Wave 17C): `docs/DESIGN/DEEP_RESEARCH_SPEC.md`.
- Existing surfaces audited and reused: `packages/document-studio/`, `packages/document-ai/`, `packages/report-engine/`, `packages/strategic-reports/`, `packages/audit-hash-chain/`, `packages/genui/`, `packages/ai-copilot/src/retrieval/span-citations.ts`.
- Manifesto authority tiers: see `docs/ARCHITECTURE.md` and the persona policy in `packages/ai-copilot/src/personas/persona-router.ts`.
