# DOCUMENT GENERATION — SOTA Design Spec (lane `document-generation-sota`)

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Lane:** `document-generation-sota`
**Gap IDs closed:** `DOC-01` (BLOCKER), `DOC-02`, `DOC-03`, `DOC-04` (HIGH), `DOC-05`, `DOC-06`, `DOC-07`, `DOC-08` (MED), `DOC-09` (LOW) — the full DOC family from `Docs/research/MASTER_GAP_REGISTER.md` §C.3.
**Cited dossier:** `Docs/research/document-generation-audit-sota.md` (verdict 3.0/5 — deep building blocks, dead last-mile assembly).
**Scope:** Design only. No code is written, no migration is applied, no commit is made by this pass. This spec is file-level and buildable.

> **One-line:** The MD can already author *Markdown* and the binary building blocks (Carbone/Typst/Puppeteer/docxtemplater/react-pdf renderers, citation gate, quality gates, WORM signing, e-sign adapters, the "infinite types" recipe-authoring engine) all exist as **real code** — they are nine **disconnected** islands. This spec wires them into **one pipeline behind one queue worker**, plus a thin new `@borjie/document-pipeline` package that is the single composer-of-record, a gateway route, a modality-arbiter hook, and three append-only migrations.

---

## 0. The keystone framing (what this lane actually is)

Every piece in the closure architecture from the dossier §6 already exists. The audit's own verdict: *"All nine pieces already exist as real code. The work is wiring + a queue worker + restoring the high-fidelity render deps/servers, not greenfield."* This spec therefore is **80% wiring, 20% new glue code**, with the new code concentrated in:

1. a **render worker** that drains `document_render_jobs` (closes `DOC-01`, the only BLOCKER);
2. a thin **`@borjie/document-pipeline`** orchestration package that is the *single composer-of-record* bridging recipe-authoring → composeDoc/strategic-reports → citation-gate → render → quality-guarantor → WORM+storage → e-sign (closes `DOC-02/03/07/08`);
3. a **gateway route** (`documents.hono.ts`) + **modality-arbiter hook** so the MD emits any document type from one intent (closes `DOC-02/03`);
4. **dependency + env restoration** for the high-fidelity renderers (closes `DOC-04`);
5. **real e-sign/OCR port binding** at the composition root (closes `DOC-05`);
6. **recipe coverage** binding (contract recipe data-binding + mining-domain recipes) (closes `DOC-06`);
7. an **email-document template set** (closes `DOC-09`).

The unifying invariant: **no document leaves the pipeline that has an empty evidence chain, an unrendered binary, or an unsealed audit link** — citation gate + quality-guarantor + WORM are *forced gates on the render path*, not optional namespaces.

---

## 1. SOTA grounding (2026, web-researched, cited)

### 1.1 Engine selection — **PICK + JUSTIFY**

The product needs *both* code-first deterministic rendering (for regulator-grade reproducibility) *and* template-from-Office-document fidelity (for owner/buyer-facing branded docs). The decision is a **three-engine arbiter keyed on the artifact's fidelity/format needs**, not a single winner:

| Engine | Role in Borjie | Why (2026 SOTA) |
|---|---|---|
| **Typst** (`TYPST_SERVER_URL`, already wired in `document-studio/renderers/typst-renderer.ts`) | **DEFAULT for regulator/compliance/legal PDF** (licence applications, royalty statements, Tumemadini returns, NEMC filings, geological/JORC reports). | Compiles in **milliseconds** (vs Puppeteer 2–5 s), single **~40 MB secure binary**, trivial to containerise, and **byte-for-byte reproducible when the document date is pinned** — exactly what an immutable audit chain + WORM archival requires. ([Typst blog — automated generation](https://typst.app/blog/2025/automated-generation/), [Typst reproducibility discussion #1439](https://github.com/typst/typst/discussions/1439), [DocuForge — best PDF lib 2026](https://www.docuforge.app/blog/best-pdf-generation-library-2026)) |
| **Carbone** (`CARBONE_URL`, wired in `document-studio/renderers/carbone-renderer.ts`) | **One Office template → PDF/DOCX/XLSX/PPTX/ODS/HTML/CSV** for editable, brand-designed, owner/buyer docs (contracts, offer letters, MOUs, KYB packs, marketplace listings). | Single template → 7 output formats from JSON; **OSS on-prem Docker REST edition, no license to self-host**; uses LibreOffice for conversion ("most reliable in production"). Covers DOCX **and** XLSX **and** PPTX in one engine, where docxtemplater core only covers docx+pptx (xlsx is a paid module). ([carbone.io](https://carbone.io/), [GitHub carboneio/carbone](https://github.com/carboneio/carbone)) |
| **Puppeteer** (`PUPPETEER_URL`, wired in `document-studio/renderers/pdf-from-html-renderer.ts`) | **Pixel-perfect HTML→PDF fallback** for any layout Typst/Carbone can't express (complex CSS grid marketing one-pagers, chart-heavy investor briefings). Used **only** when a recipe declares `fidelity:'pixel-perfect'`. | Renders anything a browser can (CSS grid, web fonts, media queries); the trade-off is 2–5 s/doc and ~100 MB Chromium, so it is **not** the default — reserved for the long tail. ([RisingStack — Puppeteer HTML→PDF](https://blog.risingstack.com/pdf-from-html-node-js-puppeteer/), [DocuForge 2026](https://www.docuforge.app/blog/best-pdf-generation-library-2026)) |
| **@react-pdf/renderer** + **docxtemplater** (`domain-services/.../react-pdf-renderer.ts`, `docxtemplater-renderer.ts`) | **In-process fast path** for high-volume, simple, latency-sensitive docs (e.g. a single offer letter on tap) where spinning an out-of-process server is overkill; `<500 ms`, handles hundreds of pages. | react-pdf is `<500 ms` and scales to hundreds of pages but is layout-constrained (flexbox only, no CSS grid); docxtemplater is the most-adopted DOCX tag engine (150k weekly downloads). Kept as the **in-process tier** of the same factory. ([DEV — Puppeteer vs react-pdf](https://dev.to/iurii_rogulia/pdf-generation-on-the-server-puppeteer-vs-react-pdfrenderer-a-production-comparison-44cg), [npmtrends carbone vs docxtemplater](https://npmtrends.com/carbone-vs-docx-vs-docxtemplater-vs-easy-template-x-vs-html-docx-js)) |

**Decision rule (encoded in the render worker, §4):** `recipe.engine_hint` → `typst` (default, regulator/legal/reproducible) | `carbone` (Office-template, multi-format) | `puppeteer` (pixel-perfect tail) | `react-pdf`/`docxtemplater` (in-process fast path). The existing `renderer-factory-v2.getRenderer()` + `document-studio` ports already implement all four; this lane **selects** between them, it does not re-author them.

> **Borjie-specific reproducibility note:** `document-templates/src/types.ts:124` already exposes `generated_at` as a "pin the renderer's now so checksums are stable" seed, and `IRDoc.generated_at` is required. Typst's pinned-date reproducibility maps 1:1 onto this — the worker MUST pass `ctx.generated_at` through to the Typst `--input` so the audit hash is deterministic.

### 1.2 Accuracy / grounding (the hard part)

2026 evidence: **retrieval grounding cuts citation hallucination 75–90%** where prompting alone cuts only 5–15%; even frontier models (GPT-4o, Claude 3.7) still hallucinate **15–20%** on factual citation tasks, rising to **35–55%** on niche/recent topics; legal LLMs hallucinate **58–88%** of the time on verifiable questions. ([digitalapplied — hallucination benchmarks 2026](https://www.digitalapplied.com/blog/ai-model-hallucination-rate-benchmarks-2026-study), [ClarityArc — grounding & citation](https://www.clarityarc.com/insights/ai-hallucination-grounding-citation), [arXiv 2606.00898 — citation grounding via legal citation graphs](https://arxiv.org/html/2606.00898)). The SOTA answer is **architectural grounding: retrieve-then-cite, per-claim verification against a fact store, abstain-over-confabulate.**

Borjie already has this in `packages/document-templates/src/citations/embedder.ts:101 enforceCitationGate()` (refuses any uncited numeric/monetary/dated/regulatory claim with `CITATION_GAP`) and `packages/document-quality-guarantor` reconciliation (self-consistency voting). **This lane's job is to make those gates MANDATORY on the binary render path** — today they run only pre-persistence in the unwired `composeDoc`, never on the live `document_render_jobs` path.

### 1.3 E-sign + accessibility/compliance (2026)

- **eIDAS 2.0** (Reg. EU 2024/1183, in force 2024-05-20): by **end-2026 every member state ships an EUDI Wallet** that issues a **QES from a smartphone with no hardware token**; SES/AES/QES tiers persist. ([qualified-electronic-signature.com — QES 2025-2026](https://www.qualified-electronic-signature.com/eidas-2-0-changes-qes-2025-2026/), [yousign — EUDI wallet compliance 2026](https://yousign.com/blog/eidas-2-0-digital-identity-wallet-compliance-requirements))
- **European Accessibility Act (EAA)** enforceable **June 2025**: digital documents must meet **EN 301 549 / WCAG 2.1 AA**; **PDF/UA-2 (ISO 14289-2:2024)** is the de-facto build standard; **PDF/A** is the eIDAS long-term-preservation format. ([iText — EAA compliance](https://itextpdf.com/blog/technical-notes/european-accessibility-act-compliance-itext), [textcontrol — PDF/UA & PDF/A-3a](https://www.textcontrol.com/blog/2025/10/07/why-pdf-ua-and-pdf-a-3a-matter-accessibility-archiving-and-legal-compliance/))

Borjie already has DocuSign REST v2.1 + Adobe Sign + HelloSign adapters with **eIDAS SES/AES/QES jurisdiction mapping** (`packages/document-ai/src/e-signature/docusign-adapter.ts`, eIDAS map ~`:164`) and **PDF/A + PDF/UA validators** (`packages/document-ai/src/accessibility/pdf-a-validator.ts`, `pdf-ua-validator.ts`). They are **mock-default and unwired** (`document-ai/src/index.ts:88` defaults to `createMockESignAdapter()`). This lane binds the real ports.

> **Jurisdiction note for Borjie:** Tanzania (launch) is **not** an eIDAS jurisdiction — the eIDAS tier mapping is for the KE/UG/NG expansion + cross-border off-take contracts with EU counterparties. The e-sign tier MUST be selected per-tenant-region (reuse the `getTenantRegion` pattern referenced in `DP-06`), defaulting to SES for TZ and escalating to AES/QES only where the counterparty jurisdiction requires it. **Never hard-code a jurisdiction.**

---

## 2. Current-state file map (what exists, where it dead-ends)

Verified by reading the actual files this pass. Every path below is real.

| Subsystem | Path | State | Dead-end |
|---|---|---|---|
| Markdown drafter (LIVE) | `services/api-gateway/src/services/document-drafter/{index.ts,free-form-composer.ts,free-form-brain-tool.ts}` | **WIRED, Markdown-only** | `free-form-brain-tool.ts:51` declares a `targetFormat` enum but **never renders binary** |
| Binary render queue | `services/api-gateway/src/routes/document-render.router.ts:145` POST `/jobs` | inserts `document_render_jobs` row (status=`queued`), emits `DocumentRenderRequested`, returns 202 | **NO WORKER drains the queue** → jobs `queued` forever (DOC-01) |
| Render job schema | `packages/database/src/schemas/document-render-jobs.schema.ts:42` (`documentRenderJobs`) | real table, 4 indexes | **no RLS migration of its own** (created in `0305`); no `outputDocumentId` ever populated |
| Renderer factory (4 engines) | `services/domain-services/src/documents/renderers/renderer-factory-v2.ts:36 getRenderer()` | **REAL** — text/docxtemplater/react-pdf/typst, nano-banana guardrail | called by **no worker** |
| Out-of-process render servers | `infra/document-render/server/{puppeteer,carbone,typst}-server.js` (+ vendored `node_modules`, Dockerfile, docker-compose) | **REAL, Dockerised** | `*_URL` envs unset → `document-studio` renderers throw/stub |
| document-studio ports | `packages/document-studio/src/renderers/{typst,carbone,pdf-from-html}-renderer.ts` | **REAL** Carbone/Typst/Puppeteer ports | only consumed by `strategic-reports`, which is null-wired |
| "Infinite types" engine | `packages/dynamic-recipe-authoring/src/index.ts` → `author/recipe-author.ts createRecipeAuthor()` | **REAL** — LLM authors a new doc/tab recipe, validates, persists to `dynamic_authored_recipes` w/ lifecycle + audit-chain | grep across `services/` = **0 call sites** (DOC-02) |
| Closed-set composer | `packages/document-templates/src/composer.ts composeDoc()` (11 recipes, `registry.ts`) | **REAL** — evidence-gated, brand-lock OOXML | grep `composeDoc` across services/apps = **0** (DOC-03); `recipes/contract.ts:52-56` placeholders unbound (DOC-06) |
| Strategic reports | `packages/strategic-reports/src/renderer.ts:131`; wiring `services/api-gateway/src/routes/reports/engine-wiring.ts:16` | **REAL** pipeline, **route exists** | `let engine: ReportEngine \| null = null` — never set at composition root (DOC-08) |
| Citation gate | `packages/document-templates/src/citations/embedder.ts:101 enforceCitationGate()` | **REAL**, enforced pre-persistence | not on the binary render path (DOC-07) |
| Quality guarantor | `packages/document-quality-guarantor/src/index.ts:141 createDocumentQualityGuarantor()` → `processOutput()` | **REAL** 7 gates + reconciliation + WORM | namespace-wired only; **no caller invokes `processOutput`** on render (DOC-07) |
| E-sign / OCR | `packages/document-ai/src/index.ts:88 createDocumentAI()` (DocuSign/Adobe/HelloSign + eIDAS map; PDF/A & PDF/UA validators) | **REAL adapters** | **mock-default + unwired** (DOC-05) |
| Storage | `packages/storage-adapter/src/{types.ts:90 StorageAdapter,supabase.ts:41 createSupabaseStorageAdapter}` | **REAL** Supabase port (`upload/getUrl/delete/list`, `physicalBucketName`) | not called by any render path |
| Real doc deps | `services/domain-services/package.json` keeps `docxtemplater/pizzip/@react-pdf`; the **5 doc packages declare `zod` only** | dep regression vs BN (DOC-04) | high-fidelity path unreachable |
| Email templates | `packages/email-templates/src/templates/daily-brief.ts` (one template) | near-stub (DOC-09) | — |

**Residue flagged (out of this lane's critical path, see §11):** `packages/document-studio/src/templates/eviction-notice/{ke,ng,tz,ug}/template.typ` is **property-domain (BossNyumba) residue** in a mining product. The replacement mining templates (licence-application, royalty-statement) are specified in §6.

---

## 3. Target architecture — one unified pipeline

```
                                  ┌─────────────────────────────────────────────────────────────┐
  MD intent ("emit X")            │              @borjie/document-pipeline (NEW, thin)            │
       │                          │   composer-of-record — orchestrates existing real packages   │
       ▼                          │                                                               │
  modality-arbiter hook ──run_document──►  resolveRecipe()                                        │
  (COG-07; fallback = brain tool)  │     ├─ known class? → document-templates.registry.getLive() │
                                   │     └─ novel type?  → dynamic-recipe-authoring.createRecipeAuthor()
                                   │                         → validate → persist draft → bridge  │
                                   │   composeIR()  → composeDoc(ctx) OR strategic-reports.engine  │
                                   │   enforceCitationGate(ir)   ◄── FORCED (was pre-persist only)│
                                   │   reconcile() (self-consistency)                             │
                                   │   enqueueRenderJob(jobSpec)  ─────────────┐                  │
                                   └────────────────────────────────────────────┼───────────────┘
                                                                                ▼
                                                       document_render_jobs (status=queued, +RLS)
                                                                                │ DocumentRenderRequested
                                                                                ▼
   ┌──────────────────────── services/document-render-worker (NEW) ───────────────────────────────┐
   │ cluster-locked queue drainer (withClusterLock — RSS-06 pattern, leader-only)                  │
   │  1. claim job  (UPDATE … SET status='running' WHERE status='queued' … RETURNING — atomic)     │
   │  2. select engine: recipe.engine_hint → renderer-factory-v2.getRenderer() | document-studio   │
   │  3. render bytes (Typst default | Carbone multi-format | Puppeteer pixel | react-pdf inproc)   │
   │  4. document-quality-guarantor.processOutput()  ◄── FORCED (accessibility/font/citation/diff)  │
   │  5. WORM seal + storage-adapter.upload(bucket, key, bytes)  → document_uploads row             │
   │  6. UPDATE job: status='succeeded', outputDocumentId, outputMimeType, outputSizeBytes, pages   │
   │  7. (optional) document-ai.eSignature.createEnvelope() → poll → store signed PDF               │
   │   failure at any step → status='failed' + errorCode/errorMessage; retry-queue w/ backoff       │
   └────────────────────────────────────────────────────────────────────────────────────────────┘
                                                                                │
                                                              client polls GET /documents/jobs/:id
```

Every named function/file above **already exists** except: `@borjie/document-pipeline` (NEW thin package), `services/document-render-worker` (NEW), the `documents.hono.ts` route surface (NEW), and the modality-arbiter `run_document` decision (NEW, gated on COG-07).

---

## 4. NEW: `services/document-render-worker/` (closes DOC-01 — the only BLOCKER)

**Model:** copy the structure of `services/outbox-processor/src/` (the existing queue-drain worker) + the cluster-lock leader-election pattern from `RSS-06` (`withClusterLock(pg_try_advisory_lock)`). Do **not** run the drain loop on every gateway replica.

### 4.1 Files

| File | Responsibility |
|---|---|
| `services/document-render-worker/package.json` | deps: `@borjie/database`, `@borjie/document-studio`, `@borjie/document-quality-guarantor`, `@borjie/storage-adapter`, `@borjie/document-ai`, `@borjie/observability`, `drizzle-orm`, `postgres`. Plus the **real render deps** for the in-process tier: `@react-pdf/renderer@^3.4.5`, `docxtemplater@^3.68.5`, `pizzip@^3.2.0` (mirror `services/domain-services/package.json`). |
| `services/document-render-worker/src/index.ts` | bootstrap: dotenv (only here — hard rail), Pino logger, OTel-first (`@borjie/observability`), `getDb()` shared pool, start drain loop under cluster lock. |
| `services/document-render-worker/src/drainer.ts` | the claim→render→gate→store→update state machine (atomic claim via conditional `UPDATE … RETURNING`). |
| `services/document-render-worker/src/engine-select.ts` | `selectEngine(job, recipe)` → `'typst'\|'carbone'\|'puppeteer'\|'react-pdf'\|'docxtemplater'`; pure function (testable). |
| `services/document-render-worker/src/render.ts` | invokes `renderer-factory-v2.getRenderer()` (in-process) OR `document-studio` ports (out-of-process Carbone/Typst/Puppeteer via `*_URL`). |
| `services/document-render-worker/src/persist.ts` | WORM seal + `storage-adapter.upload()` + `document_uploads` insert + job `succeeded` update. |
| `services/document-render-worker/src/logger.ts` | Pino child (mirror `consolidation-worker/src/logger.ts`). |
| `services/document-render-worker/Dockerfile` | reuse the api-gateway image pattern (this also closes the AUT-12 "workers have no Dockerfile" sub-gap for *this* worker). |
| `k8s/base/document-render-worker-deployment.yaml` (+ HPA scaled on `document_render_jobs WHERE status='queued'` queue depth via KEDA) | deploy manifest. |

### 4.2 The atomic claim (cross-replica safe, no double-render)

```sql
-- inside drainer.ts, parameterised Drizzle, NOT raw string interpolation
UPDATE document_render_jobs
   SET status = 'running', started_at = now()
 WHERE id = (
     SELECT id FROM document_render_jobs
      WHERE status = 'queued'
      ORDER BY requested_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
RETURNING *;
```

`FOR UPDATE SKIP LOCKED` + the conditional status flip guarantees at-most-once claim even with N worker replicas. The worker runs the **whole loop under `withClusterLock(DOCUMENT_RENDER_LOCK_ID)`** only for the *scheduling cadence* (so idle replicas don't all poll), but the claim itself is concurrency-safe so horizontal scale is fine.

### 4.3 Forced gates on the render path (closes DOC-07)

After bytes are produced and **before** the job is marked `succeeded`, the worker MUST call:

1. `document-quality-guarantor.processOutput({ tenantId, bytes, format, recipeId, citations })` — accessibility (PDF/UA), font-embedding, citation-coverage, roundtrip-fidelity, visual-diff. A `fail` verdict → job `failed` with `errorCode='QUALITY_GATE'` + escalation ticket; the binary is **never stored as succeeded**.
2. WORM seal via `document-studio/src/signing/worm-audit.ts` → append-only audit-chain link (hard rail: AI audit chain is hash-chained, append-only).

This is the single highest-value change: today the gate exists but runs only in the *unreachable* `composeDoc` path; here it becomes mandatory on the live binary path.

---

## 5. NEW: `packages/document-pipeline/` (composer-of-record, closes DOC-02/03/08)

A **thin orchestration package** (target <400 lines across files) that is the single entry the gateway route + brain tool call. It does **not** re-implement any composer; it **selects and chains** the existing real ones.

| File | Responsibility |
|---|---|
| `packages/document-pipeline/src/index.ts` | public surface: `createDocumentPipeline(deps)`, `composeAndEnqueue(req)`. |
| `packages/document-pipeline/src/resolve-recipe.ts` | `resolveRecipe(intent)`: known `DocumentClass` → `document-templates/registry.ts getLive()`; **novel type** → `dynamic-recipe-authoring createRecipeAuthor()` → validate → persist `draft` → bridge to a `DocumentRecipe` (closes DOC-02). |
| `packages/document-pipeline/src/compose-ir.ts` | calls `document-templates.composeDoc(ctx)` for closed-set, OR routes report-class intents through `strategic-reports` engine; returns the `IRDoc` + `DocumentArtifact` metadata (closes DOC-03). |
| `packages/document-pipeline/src/gate.ts` | calls `enforceCitationGate(ir)` + reconciliation **before** enqueue — refuses to enqueue a doc with an uncited numeric/monetary/dated/regulatory claim. |
| `packages/document-pipeline/src/enqueue.ts` | inserts the `document_render_jobs` row with the resolved `engine_hint` + the composed IR payload; emits `DocumentRenderRequested`. |
| `packages/document-pipeline/src/ports.ts` | DI ports: `RecipeAuthorPort`, `ComposerPort`, `ReportEnginePort`, `RenderQueuePort` — so unit tests inject fakes and production binds the real packages at the composition root. |

**Composition-root wiring** (`services/api-gateway/src/composition/`, new `document-pipeline-wiring.ts`):
- binds `createRecipeAuthor({ llm: brainLlmPort, repo: createSqlAuthoredRecipeRepository(driver) })`
- binds `composeDoc` (registry of record)
- **sets the strategic-reports engine** that `engine-wiring.ts:16` leaves `null` (closes DOC-08) — call `setEngine(buildReportEngine({ studio: documentStudioPort, ... }))` from the composition root (add a production `setEngine()` sibling to the test-only `setEngineForTests`).
- binds `createSupabaseStorageAdapter`, `createDocumentQualityGuarantor`, and `createDocumentAI({ ocr: realOcrPort, eSignature: realESignPort })` (closes DOC-05).

---

## 6. Recipe coverage — the "infinite types" guarantee + mining domains (closes DOC-06)

Two complementary layers (the dossier's architectural answer to "infinite types"):

**Layer A — closed-set, hand-verified recipes** (`document-templates/src/recipes/`): bind the contract recipe's placeholders. `recipes/contract.ts:52-56` ships `Volume/Price/Duration = "—"` — wire them to `ctx.available_data` joins (off-take volume, provisional price, duration) and assert via the citation gate that each bound figure carries a `SpanCitation`. Add the **missing mining-domain recipes** that replace the property residue:
- `licence-application` (Tumemadini PML/PL submission) — Typst, regulator audience, eIDAS-aware.
- `royalty-statement` (per-shipment royalty computation) — Carbone XLSX + PDF; **every money figure via `formatCurrency(amount, currencyCode)`** (hard rail), never hard-coded TZS.
- `compliance-filing` (NEMC/OSHA) — Typst.
- `offer-letter` / `employment-contract` — Carbone DOCX (editable).

**Layer B — infinite types via authoring** (`dynamic-recipe-authoring`): for any document class the closed set does not cover, the pipeline calls `createRecipeAuthor()` to author a new `doc` recipe from the NL intent, validate it against the `doc` kind contract (`validator/recipe-validator.ts`), persist it `draft` → lifecycle `shadow→live`, then compose it. This is what makes the set *open-ended* — the closed set is the fast, audited path; authoring is the long tail. Extend the `doc` prompt builder (`prompts/doc-recipe-prompt.ts`) with the mining/RE document taxonomy.

---

## 7. Modality-arbiter hook (`run_document`) — closes the DOC-02/03 "from one intent" requirement

**Dependency:** the modality arbiter itself (`COG-07 / AUT-14`) does not yet exist — confirmed this pass: no `packages/central-intelligence/src/**/modality-arbiter.ts`, no `run_modality` decision. This lane therefore ships **two wirings**, the second being live today and the first activating the moment COG-07 lands:

1. **Arbiter decision (gated on COG-07):** add `run_document` as a target of the 7-variant Decision ADT the arbiter selects (`ANSWER/SKILL/WORKFLOW/LOOP/AGENT/TOOL/DOCUMENT`). When the arbiter classifies an intent as document-emission, it dispatches to `document-pipeline.composeAndEnqueue()` *before* `router.call`. Spec the contract in `kernel/orchestrator/modality-arbiter.ts` (the file COG-07 creates) as: `{ kind: 'run_document', intent, target_format?, audience? }`.
2. **Brain-tool fallback (LIVE today):** register `mining.documents.emit` as a brain tool alongside the existing `mining.drafts.compose_free_form` (`document-drafter/free-form-brain-tool.ts`). The tool signature: `{ intent: string, document_class?: DocumentClass | 'auto', target_format: DocumentFormat, audience: TargetAudience, language: 'en'|'sw' }` → returns `{ jobId, status: 'queued' }`. This means the MD can emit any binary document **now**, through the existing tool-dispatch path, without waiting for the arbiter.

Both land on the **same** `document-pipeline.composeAndEnqueue()` — the arbiter is an optimisation of *routing*, not a second pipeline.

---

## 8. Localisation + multi-currency in rendered output (HARD RAILS)

These are non-negotiable per `CLAUDE.md` and MUST be enforced *inside the rendered bytes*, not just the chat surface:

- **EN/SW absolute toggle:** `DocComposeContext.language: 'en'|'sw'` (`document-templates/src/types.ts:117`) already threads the locale. The recipe + brand-lock branders MUST render **single-language** output — zero EN/SW mixing in headings, footnotes, signature blocks, watermarks, or boilerplate. Add a **render-time purity assertion** in the quality-guarantor (`processOutput`): scan the produced text layer for the *other* language's stopword set; a hit → `errorCode='LOCALE_MIXING'`, job `failed`. This makes the absolute toggle a *machine-checked render gate*, closing the only place a leak could survive (binary output).
- **Multi-currency:** every monetary figure rendered into a doc MUST pass through `formatCurrency(amount, currencyCode)` (`packages/genui/src/format.ts` / `packages/api-client/src/currency.ts`) with the tenant's currency — never a hard-coded `TZS`/`USD`/`KES`. The royalty-statement and financial-model recipes are the highest-risk; add a guarantor gate that rejects any rendered numeric token adjacent to a bare currency glyph not produced by `formatCurrency`.

Both assertions live in `document-quality-guarantor` so they gate the **binary** path, where today nothing checks them.

---

## 9. Migrations (append-only, RLS+FORCE, canonical GUC) — three new forward files

> **Numbering note:** the highest existing forward migration is `0312_memory_v2_durable_stores.sql` (the MEM lane is actively using `0312`). This lane MUST start at **`0313`**. Migrations are immutable — never edit a shipped file (hard rail).

### 9.1 `0313_document_render_jobs_rls.sql` — RLS on the render queue (DOC-01 safety)

`document_render_jobs` was created in `0305` **without its own RLS policy family**. Apply the canonical pattern proven in `0310_corpus_ratings_with_check.sql` (read this pass — it is the template): `ENABLE` + `FORCE ROW LEVEL SECURITY`; SELECT/INSERT/UPDATE policies keyed on `current_setting('app.current_tenant_id', true)` with `WITH CHECK (tenant_id IS NOT NULL AND tenant_id = <GUC>)`; a `*_service_role_bypass` FOR ALL on `current_setting('app.is_service_role', true)='true'` so the **render worker** (running under `withServiceRoleContext`) can flip `status`/`outputDocumentId` across the claim. No DELETE policy (queue rows are immutable history). Every `CREATE POLICY` guarded by a `pg_policies` existence check; idempotent + re-runnable.

### 9.2 `0314_document_artifacts_worm.sql` — sealed-artifact registry + audit linkage

New table `document_artifacts` (the immutable record of every rendered+sealed doc): `id`, `tenant_id` (FK `tenants`, RLS), `render_job_id` (FK `document_render_jobs`), `recipe_id`, `recipe_version`, `format`, `storage_bucket`, `storage_key`, `checksum`, `audit_hash`, `prev_audit_hash` (hash-chain), `span_citations jsonb`, `approval_state`, `language`, `currency_code`, `generated_at`, `sealed_at`. Same RLS+FORCE+service-role-bypass family as 9.1. **Append-only** (no UPDATE policy except service-role; no DELETE) — this is the WORM archival + audit linkage the hard rail "AI audit chain is hash-chained, append-only" requires for documents.

### 9.3 `0315_dynamic_authored_recipes_rls.sql` — RLS on the authored-recipe store

`dynamic-recipe-authoring` persists to `dynamic_authored_recipes` (the "infinite types" table). Verify/apply the same RLS+FORCE family so an authored recipe is tenant-scoped (a tenant's bespoke licence-letter recipe is not visible to another tenant), with the service-role bypass for the lifecycle promoter. If the table already carries RLS from its creating migration, this file is a no-op idempotent re-assertion (still ship it for the CI drift check, per `KI-rls-drift`).

> **Migration-safety:** none of the three add a `NOT NULL` column to an existing populated table (avoids the `migration-safety-check.yml` backfill hazard). `0314` creates a new table; `0313`/`0315` only add policies. All three are pure `BEGIN…COMMIT` DO-blocks, RLS-only or new-table — safe to fresh-apply (`migration-apply-fresh.yml`) and replay.

---

## 10. Test plan (TDD, 80%+ — RED first)

### Unit
- `engine-select.test.ts`: regulator/legal class → `typst`; multi-format Office → `carbone`; `fidelity:'pixel-perfect'` → `puppeteer`; high-volume simple → `react-pdf`. Pure function, exhaustive.
- `resolve-recipe.test.ts`: known class hits `registry.getLive()`; novel intent triggers `createRecipeAuthor()` (mocked LLM) → validated `doc` recipe.
- `gate.test.ts`: an IR with an uncited monetary claim → `CITATION_GAP`, **not enqueued**.
- `locale-purity.test.ts`: an `en` doc containing a Swahili stopword → guarantor `LOCALE_MIXING` fail. And the inverse.
- `currency-format.test.ts`: a rendered figure not produced by `formatCurrency` → guarantor reject; hard-coded `TZS` literal in a recipe → reject.

### Integration (against a fresh Postgres 17 + pgvector, the `migration-apply-check.yml` shape)
- Enqueue → worker claims (`FOR UPDATE SKIP LOCKED`) → renders (stub `*_URL` servers) → `processOutput` passes → `document_artifacts` row sealed → job `succeeded` with `outputDocumentId` set. Assert **non-zero bytes** in storage (mirror the `MG-09 BORJIE_LIVE_MODE` integration-test pattern).
- **Concurrency:** two worker instances against one queue → each job claimed exactly once (no double-render), asserted by unique `document_artifacts.render_job_id`.
- **RLS:** tenant A cannot SELECT tenant B's render job / artifact; a tenant-scoped session cannot INSERT a job with another tenant's `tenant_id` (WITH CHECK).
- **e-sign:** with a mock DocuSign fetcher, envelope create → poll → `downloadSigned` → signed PDF stored + linked to the artifact; eIDAS tier = SES for a TZ tenant, AES for a configured KE counterparty.

### E2E (Playwright, the `live-test.yml` happy-path shape)
- Owner asks the MD "draft and send the off-take agreement to buyer X" → brain tool `mining.documents.emit` → poll `GET /documents/jobs/:id` → `succeeded` → signed PDF downloadable, citations footnoted, currency via `formatCurrency`, single-language.

### Eval / regression
- Add a doc-gen scenario to the citation-grounding eval: every rendered regulator doc has a non-empty evidence chain (the Auditor-agent invariant). Add a reproducibility assertion: same input + pinned `generated_at` → identical `checksum` (Typst byte-reproducibility).

---

## 11. Reversibility & rollout

**Rollout (behind flags, no big-bang):**
1. Ship migrations `0313–0315` (additive: new table + RLS only — safe to apply ahead of code).
2. Restore render deps + point `TYPST_SERVER_URL`/`CARBONE_URL`/`PUPPETEER_URL` at the already-vendored `infra/document-render` servers (env-only; closes DOC-04). The `document-studio` renderers degrade to deterministic stubs when a `*_URL` is unset, so this is reversible by unsetting the env.
3. Deploy `document-render-worker` with `DOCUMENT_RENDER_ENABLED=false` → enable in staging → prod. While disabled, `POST /jobs` keeps persisting `queued` rows exactly as today (zero behaviour change).
4. Register the `mining.documents.emit` brain tool behind a per-tenant capability flag (Tier-1 draft / Tier-2 execute, mirroring `document-templates/types.ts:38 AuthorityTier`); e-sign send stays **dual-control HITL** (hard rail: money/licence/deletion-class actions stay HITL forever).
5. Activate the `run_document` arbiter decision only after COG-07 lands; until then the brain tool is the live path.

**Reversibility:** every step is a flag/env flip. The worker is additive (drains a queue that is otherwise inert). The migrations are append-only and RLS-additive — a rollback simply stops the worker; queued rows remain valid history. No existing route changes behaviour while `DOCUMENT_RENDER_ENABLED=false`. No money path touched (e-sign is the only side-effecting external call and is HITL-gated). The Markdown drafter path (`document-drafter`) is untouched and remains the fallback.

**Out-of-lane residue to spin off (flag, do not fix here):**
- `packages/document-studio/src/templates/eviction-notice/{ke,ng,tz,ug}/template.typ` — property-domain residue in a mining product; replace with the `licence-application`/`royalty-statement` Typst templates (§6) and delete the eviction templates.
- The 5 doc packages declaring `zod` only vs BN's full doc-lib set (DOC-04) is closed by §11.2 for the worker, but a repo-wide dependency-parity audit vs `BOSSNYUMBA101` is its own pass.

---

## 12. Hard-rail compliance checklist (this spec honours every one)

- **Money via `LedgerService.post`** — untouched; no document path writes the ledger. Royalty *figures* are read-only renders of ledger rows via `formatCurrency`.
- **RLS never weakened** — three new migrations *add* RLS+FORCE on the render queue, artifact registry, and authored-recipe store; canonical `app.current_tenant_id` GUC; `WITH CHECK` on every write policy.
- **Supabase-JWT auth** — the `documents.hono.ts` route reuses `authMiddleware` (`hono-auth`) exactly as `document-render.router.ts:30` does today. No Clerk.
- **Append-only migrations** — start at `0313` (0312 is taken by MEM); never edit a shipped file.
- **No `console` in services** — the worker uses Pino (`logger.ts`), mirroring `consolidation-worker`.
- **`formatCurrency` multi-currency** — enforced *inside rendered bytes* + machine-checked by the guarantor; no hard-coded currency codes.
- **EN/SW absolute toggle** — single-language render + a `LOCALE_MIXING` guarantor gate on the binary output.
- **Evidence-required AI output** — `enforceCitationGate` is promoted to a *forced* pre-enqueue gate; the Auditor invariant (≥1 evidence_id) holds for every rendered doc.
- **AI audit chain append-only** — `document_artifacts` is WORM (hash-chained, no UPDATE/DELETE except service-role); WORM seal via `document-studio/signing/worm-audit.ts`.
- **No reflective CORS / no raw HTML interpolation** — route uses the gateway allowlist; the Puppeteer HTML path renders *recipe-produced* IR→HTML, never user-interpolated raw HTML (DOMPurify wraps any free-text field).
- **No `process.env` outside bootstrap** — all envs read in `document-render-worker/src/index.ts` bootstrap only.

---

## Sources (web-verified, 2026)

- Typst automated generation + reproducibility: https://typst.app/blog/2025/automated-generation/ , https://github.com/typst/typst/discussions/1439
- PDF library production comparison 2026: https://www.docuforge.app/blog/best-pdf-generation-library-2026
- Puppeteer vs @react-pdf/renderer: https://dev.to/iurii_rogulia/pdf-generation-on-the-server-puppeteer-vs-react-pdfrenderer-a-production-comparison-44cg , https://blog.risingstack.com/pdf-from-html-node-js-puppeteer/
- Carbone (OSS on-prem, multi-format): https://carbone.io/ , https://github.com/carboneio/carbone
- Carbone vs docxtemplater adoption/format coverage: https://npmtrends.com/carbone-vs-docx-vs-docxtemplater-vs-easy-template-x-vs-html-docx-js
- AI hallucination benchmarks + grounding 2026: https://www.digitalapplied.com/blog/ai-model-hallucination-rate-benchmarks-2026-study , https://www.clarityarc.com/insights/ai-hallucination-grounding-citation , https://arxiv.org/html/2606.00898
- eIDAS 2.0 QES 2025-2026 + EUDI wallet: https://www.qualified-electronic-signature.com/eidas-2-0-changes-qes-2025-2026/ , https://yousign.com/blog/eidas-2-0-digital-identity-wallet-compliance-requirements
- EAA / PDF/UA-2 / PDF/A accessibility: https://itextpdf.com/blog/technical-notes/european-accessibility-act-compliance-itext , https://www.textcontrol.com/blog/2025/10/07/why-pdf-ua-and-pdf-a-3a-matter-accessibility-archiving-and-legal-compliance/
- DocuSign eSign REST API v2.1: https://developers.docusign.com/docs/esign-rest-api/
