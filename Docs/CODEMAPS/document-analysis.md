# Document Analysis Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/document-analysis/`
**Public entry:** `packages/document-analysis/src/index.ts`
**Tier scope:** platform spine (Piece K — document analysis pipeline)

## Purpose

The document-analysis pipeline is the brain-to-tab loop at the
document layer. A user (or an agent) uploads a file — PDF, image,
email body, spreadsheet scan — and the pipeline walks it through
seven stages, persisting facts and routing decisions along the way:

```
ingest → OCR → layout parse → semantic extract → entity resolution
       → routing decision → citation
```

Distinct from sibling packages:

- `packages/file-ingest/` is the J2 conversational schema-sniff
  pipeline for tabular CSV/Excel uploads — it answers "what entity
  rows do these columns map to?".
- `services/document-intelligence/` is the KYC-flavoured Module G
  service — scan + Textract/Vision + fraud + evidence packs.
- This package is the **orchestrator** that takes any document, classifies
  it against a 10-label taxonomy, extracts the canonical entities for
  that doc type, resolves them against the tenant's entity store, and
  emits routing decisions to the right module/tab.

## Entry points

- `src/index.ts` — barrel re-exporting every stage.
- `src/types.ts` — Zod schemas + threshold knobs.
- `src/ports.ts` — repository + storage + LLM + resolver + event-bus
  interfaces. Adapters are wired by the host.
- `src/in-memory-adapters.ts` — reference implementations for tests
  and the RLS-isolation contract.
- `src/ingest.ts` — accept file, sha256 dedupe, persist + emit event.
- `src/orchestrator.ts` — `analyzeDocument(documentId, tenantId, deps)`
  end-to-end; `renderCitation(extractionId)` for source pinning.
- `src/ocr/` — born-digital text first; Tesseract.js fallback with
  `eng + swa`. Lazy-imports.
- `src/layout/` — bbox + table + signature + stamp + photo blocks.
- `src/extract/` — doc classifier + per-doc-type entity extractors.
- `src/resolve/` — exact / fuzzy / embedding resolution against
  `core_entity` via `IEntityResolver`.
- `src/route/` — `ROUTING_MATRIX` maps doc-type + entities → module +
  action. Auto-apply above `THRESHOLDS.AUTO_APPLY_ROUTING`,
  HITL-gate otherwise.

## Internal structure

```
src/
├── extract/
│   ├── doc-classifier.ts     — bilingual keyword scorer + LLM tie-break
│   ├── entity-extractor.ts   — per-doc-type field regexes
│   └── index.ts              — barrel
├── in-memory-adapters.ts     — test substrate + RLS contract
├── index.ts                  — public barrel
├── ingest.ts                 — dedupe + persist + storage put
├── layout/
│   └── index.ts              — table/sig/stamp/photo detection
├── ocr/
│   ├── extract-text.ts       — adapter selector
│   ├── language.ts           — en | sw | mixed
│   ├── tesseract-adapter.ts  — lazy WASM wrapper
│   └── index.ts              — barrel
├── orchestrator.ts           — end-to-end driver
├── ports.ts                  — IDocumentRepository, IExtractionRepository,
│                                IEntityRepository, IRoutingRepository,
│                                IDocumentStorage, IEntityResolver,
│                                IEventBus, ILlmClient
├── resolve/
│   └── index.ts              — exact + fuzzy + embedding rungs
├── route/
│   └── index.ts              — ROUTING_MATRIX + decideRouting
└── types.ts                  — Zod schemas + THRESHOLDS
```

## Migrations (head 0214)

| File                              | Table                  | Purpose                                  |
|-----------------------------------|------------------------|------------------------------------------|
| `0211_documents.sql`              | `documents`            | Top-level record + provenance + state    |
| `0212_document_extractions.sql`   | `document_extractions` | Per-fact facts with page + bbox          |
| `0213_document_entities.sql`      | `document_entities`    | Resolution layer (soft FK to core_entity)|
| `0214_document_routing.sql`       | `document_routing`     | Module/action routing decisions          |

All four FORCE RLS via the canonical `current_app_tenant_id()` GUC
helper installed by `0172_unify_rls_guc.sql`. Pattern matches
`0182_section_layouts` / `0183_user_action_tracker` / `0184_reflexion`
/ `0185_decision_traces`:

```
ENABLE + FORCE ROW LEVEL SECURITY
CREATE POLICY tenant_isolation_select  USING (tenant_id = current_app_tenant_id())
CREATE POLICY tenant_isolation_modify  USING + WITH CHECK
REVOKE ALL FROM anon
```

`document_extractions` carries a `CHECK (confidence ∈ [0,1])`.
`document_entities` carries the same on `resolution_confidence`.

## Doc-type taxonomy

| `DocType`              | Required entities                                           | Target module / action                     |
|------------------------|-------------------------------------------------------------|--------------------------------------------|
| `lease_application`    | `applicant_name`, `requested_asset`                         | `estate` → `create_lease_application`      |
| `lease_contract`       | `tenant_name`, `asset_reference`, `monthly_rent`            | `estate` → `create_lease`                  |
| `payment_receipt`      | `amount`                                                    | `finance` → `post_receipt`                 |
| `national_id`          | `id_number`                                                 | `compliance` → `archive_id`                |
| `condition_survey`     | `asset_reference`                                           | `estate` → `update_condition`              |
| `complaint_letter`     | `complainant_name`                                          | `crm` → `open_ticket`                      |
| `renewal_request`      | `tenant_name`, `asset_reference`                            | `estate` → `create_renewal_request`        |
| `termination_notice`   | `tenant_name`, `asset_reference`                            | `legal` → `process_termination`            |
| `vendor_invoice`       | `vendor_name`, `amount`                                     | `finance` → `process_invoice`              |
| `unknown`              | —                                                           | `crm` → `open_ticket` (HITL)               |

## Bilingual support

- Tesseract loaded with `eng + swa` traineddata.
- Doc classifier weights include Swahili synonyms:
  `mkataba`, `mpangaji`, `mwenyenyumba`, `malipo`, `kitambulisho`,
  `ripoti ya ukaguzi`, `malalamiko`, `ankra`, `kodi ya mwezi`.
- Entity extractor labels include Swahili equivalents
  (`jina la mwombaji`, `tarehe ya kuanza`, `mlipaji`, `mkaguzi`).
- Language detection: `detectLanguage()` returns `en | sw | mixed`.

## Common workflows

- **Ingest a file** →
  `ingestDocument({ tenantId, filename, mimeType, content }, deps)`
  → returns `{ document, deduped }`. sha256 dedupe is per-tenant.

- **End-to-end analysis** →
  `analyzeDocument(documentId, tenantId, deps)` walks every stage.
  Emits `ingested → ocr_done → parsed → extracted → resolved → routed
  → done` events; or `error` if any stage throws.

- **Cite a fact back to the source** →
  `renderCitation(tenantId, extractionId, extractions)` returns
  `{ documentId, page, bbox, key, value }` for the frontend to
  highlight the source PDF coordinate.

- **HITL queue (low-confidence)** →
  - Extractions below `THRESHOLDS.HITL_EXTRACTION` (0.7) are flagged
    in the partial index `document_extractions_low_confidence_idx`.
  - Entity resolutions below `THRESHOLDS.HITL_RESOLUTION` (0.75)
    surface as `document_entities` with `resolution_hitl_status='pending'`.
  - Routings below `THRESHOLDS.AUTO_APPLY_ROUTING` (0.8) are
    `hitl_required=true` and listed by
    `document_routing_hitl_pending_idx`.

## Confidence + thresholds

```ts
THRESHOLDS = {
  HITL_EXTRACTION: 0.7,
  HITL_RESOLUTION: 0.75,
  AUTO_APPLY_ROUTING: 0.8,
  DOC_TYPE_CONFIDENT: 0.55,
}
```

A routing's combined confidence = doc_type_confidence × min(required
field confidence). When the min required field is missing, the
routing still emits with `hitl_required=true` and a reasoning trace
explaining what was missing — the operator can complete the gap.

## Dependencies

- Upstream: `zod`.
- Optional (lazy imports): `pdf-parse`, `pdfjs-dist`, `tesseract.js`.
- Downstream callers: api-gateway document routes (wire the adapters),
  consolidation-worker (run analysis in background), chat-ui (display
  citations).
- Storage: caller provides `IDocumentStorage` (Supabase Storage / S3 /
  any). Package never bakes in a backend.

## Anti-patterns to avoid

- **Never** write directly to `document_extractions` or
  `document_routing` — use the orchestrator path so events are
  emitted and state transitions are coherent.
- **Never** disable RLS to peek across tenants. The
  `InMemoryEntityResolver` + in-memory adapters mirror the postgres
  tenant-isolation policy; the postgres adapter must do the same.
- **Never** treat `resolved_entity_id` as a hard reference until
  the canonical `core_entity` table lands and the FK migration is
  appended.
- **Never** auto-apply a routing whose `hitl_required` is true —
  the operator decision is a hard gate.
- **Never** trust extracted PII (NIDA, KRA PIN, phone) without
  going through the resolver — fuzzy matches need confidence + HITL
  guards before they touch the real entity store.

## Tests

`src/__tests__/`:

| File                            | Coverage                                          |
|---------------------------------|---------------------------------------------------|
| `ingest.test.ts`                | sha256 + dedupe + sanitisation + RLS              |
| `ocr.test.ts`                   | language detect + text-mime + availability        |
| `ocr-extract-paths.test.ts`     | mocked pdf-parse + tesseract failure paths        |
| `layout.test.ts`                | page break + table + signature + stamp + photo    |
| `extract.test.ts`               | 5 fixture classify + entity extract               |
| `resolve.test.ts`               | exact + fuzzy + embedding + HITL flagging         |
| `route.test.ts`                 | routing matrix + HITL conditions                  |
| `orchestrator.test.ts`          | end-to-end on all 5 fixtures + event chain        |
| `rls.test.ts`                   | tenant isolation across every repository          |
| `coverage-extras.test.ts`       | secondary profiles + adapter error paths          |

107 tests, 87% statements / 88% lines / 88% functions / 71% branches.

## Related codemaps

- [file-ingest.md](./file-ingest.md) — tabular ingest path.
- [document-intelligence.md](./document-intelligence.md) — KYC + scan stack.
- [database.md](./database.md) — migrations + RLS conventions.
- [ai-copilot.md](./ai-copilot.md) — the existing
  `packages/ai-copilot/src/document-analysis/` heuristic parsers
  (different layer; used by the copilot personas, not the pipeline).
