# Document Generation — Real-vs-Stub Audit & SOTA Gap Analysis

**Area:** Document generation (PDF + "infinite" document types) — templating, data-binding, AI-authoring, format engines (PDF/docx/xlsx/pptx/html), quality/accuracy guarantee, e-sign.
**Date:** 2026-06-08
**Repos audited:** Borjie (`/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Borjie`) and BossNyumba (`/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BOSSNYUMBA101`).
**Verdict:** Current level **3.0 / 5** vs SOTA. The *building blocks* are unusually deep and mostly real, but the production-wired path generates **Markdown only**; binary rendering (docx/pdf/pptx/xlsx) is a dead-ended async queue with **no worker**, the "infinite types" AI-authoring engine (`dynamic-recipe-authoring`) is **not wired to any route**, and the SOTA template engines (Carbone/Docxtemplater) were **stripped of their real library dependencies** in the Borjie fork (reduced to hand-rolled, zero-dep OOXML/PDF).

---

## 1. What actually exists (inventory + real-vs-stub)

Borjie has **five overlapping document subsystems** plus a sixth (BN-derived) infra server. They were built independently and are NOT unified; only one is fully wired to a live route.

### 1.1 `services/api-gateway/src/services/document-drafter/` — THE production-wired path (REAL, Markdown-only)
- Brain-backed composer producing **Markdown** content; persists to `document_drafts` (`index.ts:211`, `composer.ts`).
- **Free-form / "infinite" intent path**: `free-form-composer.ts:124 composeFreeForm()` infers `DraftKind` from NL intent (`inferKindFromIntent`, `free-form-composer.ts:86`) across letter/memo/rfp/notice/contract — section-by-section brain generation with citation tracking.
- **~30 typed templates** under `templates/` (board-resolution, business-plan, employment-offer-letter, mou-cooperative, nemc-eia-decision-letter, off-taker-master-sale-agreement, partnership-deed, rfp-equipment, sop-blast-safety, tender-response, training-material, dismissal-letter, performance-review, etc.).
- **WIRED LIVE**: `index.ts:744/1342`; routes `owner/forms.hono.ts:129`, `owner/drafts.hono.ts:100/112`, `mining/draft.hono.ts:99..243`; exposed as a brain tool (`brain-tools.ts`, `free-form-brain-tool.ts`).
- **GAP**: the composer output is `contentMd` (Markdown string). The free-form brain tool only declares a `targetFormat` enum (`free-form-brain-tool.ts:51`) describing what the caller "plans to use next" — it does NOT render to binary.

### 1.2 `packages/report-engine/` — REAL hand-rolled multi-format renderer (NOT wired to a route)
- **Real PDF 1.4** synthesizer: multi-page, xref/trailer, Helvetica/Helvetica-Bold, tables, KPI grids, pagination (`renderers/pdf.ts:107/149/222`).
- **Real OOXML docx** (`renderers/docx.ts:175`) and **pptx** (`renderers/pptx.ts:458` — slide master, layout, theme, EMU geometry) via a **hand-rolled PKZIP writer** (`ooxml-zip.ts:46` — CRC-32 + `deflateRawSync`, deterministic). Output opens in Word/PowerPoint/LibreOffice.
- Orchestrator with DI renderer overrides + per-tenant registry (`orchestrator.ts:75/166`).
- **Deps**: `zod` only — **no** real doc libraries.
- **GAP**: grep across `services/` + `apps/` for `renderReport(`/`ReportOrchestrator`/`createReportOrchestrator` returns **zero** call sites. Dead code from the API's perspective.

### 1.3 `packages/document-templates/` — REAL evidence-gated composer + brand-lock OOXML (NOT wired to a route)
- **CLOSED SET of 11 recipes** (`registry.ts:25`): daily-briefing, board-report, investor-briefing, tumemadini-return, nemc-filing, buyer-kyb-pack, sop, financial-model, contract, geological-report, marketplace-listing. NOT "infinite."
- Its OWN brand-lock OOXML branders: `brand-lock/{pdf,docx,xlsx,pptx}-brander.ts` + md/html (`recipes/_helpers.ts:84`). DOCX brander emits footnote citations + brand-lint gate (`brand-lock/docx-brander.ts:202`).
- **Evidence gate is REAL & enforced PRE-PERSISTENCE**: `citations/embedder.ts:101 enforceCitationGate()` refuses any uncited numeric/monetary/dated/regulatory claim (`CITATION_GAP`). Audit-chain link per artifact (`citations/audit-chain-link.ts`). Approval workflow (`approval/workflow.ts`).
- **GAP 1 — closed set**: only 11 hand-coded recipes; contract recipe ships placeholder values (`recipes/contract.ts:52-56` — Volume/Price/Duration = "—", no data binding from `ctx`).
- **GAP 2 — unwired**: grep for `composeDoc` across services/apps = **zero** call sites. The spec comment `composer.ts:9` says "the single entry point the API gateway calls" but it never does.

### 1.4 `packages/strategic-reports/` — REAL brain-composed report engine (partially wired)
- Full pipeline: gather → brain-compose → citation-verify → structural quality gates → render via `DocumentStudioPort` → WORM audit → persist (`renderer.ts:131`). Harvard-PhD persona, 11 gatherers (acquisition-ic, royalty-roll, sustainability, offtake-financial, refinancing…), Carbone/HTML/Typst templates.
- **Route exists** (`routes/reports/reports.router.ts`) but engine is **null by default** (`reports/engine-wiring.ts:17 let engine: ReportEngine | null = null`); grep shows **no composition-root wiring** sets it in production — only `setEngineForTests`.
- Render delegates to an injected `DocumentStudioPort.render()` — which in production resolves to `document-studio` renderers (see 1.5).

### 1.5 `packages/document-studio/` — REAL DI renderers with stub fallback (used as a port by strategic-reports)
- **Typst** renderer: spawns `typst compile` or POSTs to `TYPST_SERVER_URL` (`renderers/typst-renderer.ts:144/186`); deterministic stub fallback.
- **Carbone** renderer: POSTs to `CARBONE_URL/render/:id` with `{data, convertTo}` (`renderers/carbone-renderer.ts:124`); throws in production if `CARBONE_URL` unset (`:88`).
- **HTML→PDF** renderer: dynamic `import('puppeteer')` via `Function('return import("puppeteer")')` hide-from-bundler (`renderers/pdf-from-html-renderer.ts:196`); returns `browser_not_available` error if puppeteer absent.
- **REAL signing/WORM** (`signing/worm-audit.ts`) + citation verifier (`citations/citation-verifier.ts`).
- **Deps**: `zod` only. All three real engines require **out-of-process** binaries/servers that Borjie does not ship as a dependency (they live in `infra/document-render/`, see 1.7).

### 1.6 `packages/document-ai/` — REAL OCR/e-sign/chat-with-doc adapters, mock-by-default
- **E-signature**: real DocuSign REST v2.1 (`e-signature/docusign-adapter.ts:40` — envelope create, poll, download-combined; eIDAS SES/AES/QES jurisdiction mapping `:164`), Adobe Sign, HelloSign, mock. Factory defaults to **mock** (`index.ts:63`).
- **OCR**: Anthropic-vision, Tesseract, Marker, Docling, mock adapters (`ocr/*`); SSRF guard (`ocr/ssrf-guard.ts`).
- **Chat-with-doc** (chunker/retriever/citations), form-extraction (zod schemas), multilingual detect/translate, PII tokenise, prompt-safety, **PDF/A + PDF/UA validators** (`accessibility/pdf-a-validator.ts`, `pdf-ua-validator.ts`).
- Wired into gateway as a namespace bundle with **mock OCR + mock e-sig** (`composition/ported-platform-wiring.ts:130 createDocumentAI()` — no real ports bound).

### 1.7 `services/domain-services/src/documents/renderers/` + `infra/document-render/` — REAL libs, async, no worker
- `renderer-factory-v2.ts:38 getRenderer()` returns working renderers for text/docxtemplater/react-pdf/typst, guardrailing nano-banana to imagery-only.
- **domain-services DOES declare real libs**: `docxtemplater@^3.68.5`, `pizzip@^3.2.0`, `@react-pdf/renderer@^3.4.5`. `docxtemplater-renderer.ts:42` dynamic-imports PizZip+docxtemplater (real), falls back to `synthesizeDocxFromText` (`docx-fallback-synthesizer.ts`). `pdf-real-renderer.ts:36` defaults to `engine:'builtin'` (hand-rolled), upgradeable to `@react-pdf/renderer`.
- `infra/document-render/server/{puppeteer,carbone,typst}-server.js` — Dockerised render servers (identical to BN's, with `node_modules` vendored). These back the `document-studio` Carbone/Typst/Puppeteer renderers when `*_URL` envs point at them.
- **THE DEAD-END**: `routes/document-render.router.ts` POST `/jobs` (mounted `index.ts:1837`) only **inserts a `document_render_jobs` row (status=queued)** + emits `DocumentRenderRequested` (`document-render.router.ts:131-185`). It "intentionally does NOT call the renderer inline." **No worker consumes the queue** — grep for any consumer of `document_render_jobs` / `documentRenderJobs` outside the route returns nothing. Jobs persist as `queued` forever; binary docs are never produced via this path.

### 1.8 `packages/dynamic-recipe-authoring/` — the "INFINITE TYPES" AI engine (REAL, NOT wired)
- `author/recipe-author.ts:80 createRecipeAuthor()` — LLM authors a NEW doc/tab recipe from an NL utterance, validates against a kind contract (`validator/recipe-validator.ts`), persists to `dynamic_authored_recipes` with a lifecycle (`lifecycle/lifecycle-bridge.ts`) + audit-chain. Kinds: `tab|doc|media|campaign|tool` (`types.ts:33`); only `tab`+`doc` have v1 prompt builders.
- **This is the architectural answer to "infinite document types"** — generate the recipe, then compose it. **GAP**: grep for `dynamic-recipe-authoring`/`createRecipeAuthor`/`authorRecipe` across `services/` returns **zero** — completely unwired; no route, no composition root, no bridge to `document-templates`'s `composeDoc`.

### 1.9 `packages/document-quality-guarantor/` + `packages/document-reconciliation/` — REAL gates (namespace-wired only)
- Quality gates: accessibility, citation-coverage, confidence, font-embedding, roundtrip-fidelity, schema-completeness, visual-diff (`quality-gates/*`), retry-queue w/ backoff, escalation, WORM audit + replay, format-coverage registry (`index.ts`). Reconciliation: self-consistency voting, fact-matcher, calibration, issuer-fingerprint, mpesa-sms/eml/msg/qr extractors.
- Wired only as a **namespace** in `ported-platform-wiring.ts:49/65` with an in-memory audit store; **per-tenant guarantor façade is instantiated at request time** but no route currently calls `processOutput`/`processIntake` on the binary-render path.

### 1.10 `packages/email-templates/` — minimal (one template)
- Only `templates/daily-brief.ts`; no deps. Effectively a stub for "email document" needs.

---

## 2. Borjie vs BossNyumba (BN) — the dependency regression

The packages are largely **identical source** (BN is the upstream). The decisive difference:

| Capability | BN | Borjie |
|---|---|---|
| Real doc libs in package.json | `carbone`, `docxtemplater`, `exceljs`, `pdfkit`, `pdf-lib`, `playwright`(×3), `puppeteer`(×2) declared | Only `domain-services` keeps `docxtemplater`/`pizzip`/`@react-pdf`; the 5 doc packages declare **`zod` only** |
| `infra/document-render` servers | Present + vendored `node_modules` | **Present + vendored** (same Dockerised puppeteer/carbone/typst servers) |
| Render worker draining the queue | (BN has `services/reports` + `services/document-intelligence`) | **No queue worker** for `document_render_jobs` |

**Implication:** Borjie deliberately replaced library-backed renderers with hand-rolled zero-dep equivalents (valid but lower-fidelity — no embedded fonts beyond Standard-14, no real charts, ASCII-only PDF text per `report-engine/renderers/pdf.ts:67`, no images, basic tables). The high-fidelity path (Carbone one-template→7-formats, docxtemplater image/chart/HTML modules, Playwright pixel-perfect PDF) exists in code but is unreachable because (a) deps are stripped and (b) the out-of-process servers are not wired via env nor drained by a worker.

---

## 3. SOTA reference (2026) — what "any document type, accurate, e-signed" means today

### Format/template engines
- **Carbone** — one template (DOCX/ODT/HTML/XLSX/PPTX/IDML/MD/Canva) → PDF/DOCX/XLSX/PPTX/ODS/HTML/CSV; JSON data-binding; self-host/Docker/Cloud; OSS core. Source: https://carbone.io/
- **Docxtemplater** — DOCX/PPTX (OSS) + XLSX/ODT (paid); `{tag}`, `{#loop}`, `{#cond}` from JSON; paid modules for Image, HTML, Tables, Charts, Subtemplates, Styling, Watermark/Comments. Source: https://docxtemplater.com/
- **Apryse Fluent** — low-code; one template → PDF/DOCX/PPTX/HTML; data from JSON/XML/SQLServer/OData. Source: https://apryse.com/capabilities/document-generation
- **Pandoc / python-docx / python-pptx / PptxGenJS / @react-pdf/renderer / Typst** — code-first generators; Typst = Rust LaTeX-alternative, 10–100× faster. Sources: https://carbone.io/ , https://docxtemplater.com/
- **Docling (MIT)** — layout-analysis + document conversion on commodity hardware (intake/parse side). Source (overview): https://gurutech.com/programmatic-document-generation/

### AI-authoring platforms (the "infinite types from one prompt" bar)
- **Pokee / Gamma / Documentero** — generate PDF/PPTX/XLSX/DOCX/Google formats from a single prompt; pull data from 90+ integrations into placeholders; intelligent template suggestion + auto-formatting are "standard in 2026." Sources: https://pokee.ai/blog/best-ai-document-generators-2026 , https://www.guideflow.com/blog/document-generation-software-tools

### Accuracy / grounding guarantee (the hard part)
- LLM open-ended generation hallucinates **40–80%**; **citation fabrication 14–95%** across vendors; hallucination is **provably not fully eliminable** under current architectures → the SOTA answer is **architectural grounding**: retrieve-then-cite, per-claim citation verification against a fact store, numeric/date/regulatory claims must trace to evidence, abstain-over-confabulate. Borjie's `enforceCitationGate` + reconciliation self-consistency voting align with this. Sources: https://sqmagazine.co.uk/llm-hallucination-statistics/ , https://www.clarityarc.com/insights/ai-hallucination-grounding-citation , https://arxiv.org/html/2606.00898 (citation-grounding via citation graphs)

### E-sign + accessibility/compliance
- **eIDAS 2.0** (Reg. EU 2024/1183, in force 2024-05-20): by 2026 EU wallets create **QES from smartphone** (no external hardware); SES/AES/QES tiers. Source: https://www.qualified-electronic-signature.com/eidas-2-0-changes-qes-2025-2026/ , https://yousign.com/blog/eidas-2-0-digital-identity-wallet-compliance-requirements
- **WCAG / EAA / PDF-UA**: e-sign UIs and generated PDFs must be accessible (EAA enforceable 2025+). Source: https://www.esign.ai/blog/accessibility-compliance-wcag-electronic-signature
- Borjie has DocuSign/Adobe/HelloSign adapters with eIDAS jurisdiction mapping + PDF/A & PDF/UA validators — strong, but **mock-default and unwired**.

---

## 4. Scorecard (0–5 vs SOTA)

| Dimension | Score | Note |
|---|---|---|
| Templating + data-binding | 3 | 11 closed recipes + 30 drafter templates + free-form NL; no Carbone/docxtemplater tag-binding wired; contract recipe placeholders unbound |
| AI-authoring of content | 4 | Brain-backed free-form + section composer, REAL and wired (Markdown) |
| AI-authoring of NEW types ("infinite") | 2 | `dynamic-recipe-authoring` is real but **unwired**; no route generates+composes a novel type end-to-end |
| Format engines (pdf/docx/xlsx/pptx/html) | 3 | Real hand-rolled docx/pdf/pptx + real lib-backed docxtemplater/react-pdf in domain-services; **but binary path has no worker**, low fidelity, deps stripped vs BN |
| Quality / accuracy guarantee | 3 | Citation gate + reconciliation + 7 quality gates are real; not invoked on the live binary path |
| E-sign | 3 | Real DocuSign/Adobe/HelloSign + eIDAS mapping; mock-default, unwired |
| End-to-end wiring (intent→binary→signed→stored) | 2 | Markdown drafts work; binary render queue dead-ends; report/template engines unreachable |
| **Overall** | **3.0** | Deep real building blocks; the assembly + last-mile wiring is the gap |

---

## 5. Evidence-anchored gaps (every gap → buildable closure lane, no deferral)

See structured `gaps[]`. Highest-severity: (BLOCKER) the binary-render queue has no worker; (HIGH) `dynamic-recipe-authoring` "infinite types" engine unwired; (HIGH) report-engine/document-templates `composeDoc`/`renderReport` have zero call sites; (HIGH) doc libs stripped vs BN forcing low-fidelity hand-rolled output; (MED) e-sign/OCR mock-default; (MED) closed 11-recipe set + unbound contract placeholders; (MED) quality-guarantor not on the live render path; (LOW) email-templates near-stub.

---

## 6. Recommended closure architecture (one unified pipeline)

`intent → (dynamic-recipe-authoring authors/looks-up recipe) → (document-templates composeDoc OR strategic-reports) → enforceCitationGate + reconciliation → render-worker drains document_render_jobs via renderer-factory-v2 / document-studio ports (Carbone+Typst+Puppeteer in infra/document-render) → document-quality-guarantor.processOutput gates (accessibility/font/citation/visual-diff) → WORM audit + storage (s3/gcs providers already exist) → optional document-ai e-sign envelope → poll/store signed PDF`.

All nine pieces already exist as real code. The work is **wiring + a queue worker + restoring the high-fidelity render deps/servers**, not greenfield.

---

## Sources (verified)
- https://carbone.io/
- https://docxtemplater.com/
- https://apryse.com/capabilities/document-generation
- https://pokee.ai/blog/best-ai-document-generators-2026
- https://www.guideflow.com/blog/document-generation-software-tools
- https://gurutech.com/programmatic-document-generation/
- https://sqmagazine.co.uk/llm-hallucination-statistics/
- https://www.clarityarc.com/insights/ai-hallucination-grounding-citation
- https://arxiv.org/html/2606.00898
- https://www.qualified-electronic-signature.com/eidas-2-0-changes-qes-2025-2026/
- https://yousign.com/blog/eidas-2-0-digital-identity-wallet-compliance-requirements
- https://www.esign.ai/blog/accessibility-compliance-wcag-electronic-signature
- DocuSign eSign REST API v2.1: https://developers.docusign.com/docs/esign-rest-api/
