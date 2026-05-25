# @borjie/document-analysis — Piece K

Pipeline: **ingest → OCR → layout → semantic extract → entity resolution
→ routing decision → citation**. The brain-to-tab loop at the document
layer. User uploads any document (PDF, image, email body, spreadsheet
scan), and the pipeline produces:

1. A canonical `documents` row with provenance.
2. Per-fact `document_extractions` rows with page + bbox citation.
3. Per-entity `document_entities` rows resolved against canonical store.
4. Per-target `document_routing` rows so the right module/tab learns.

## Stages

- **`src/ingest.ts`** — accept file (buffer + metadata), dedupe via
  sha256 within tenant, persist via `IDocumentRepository`, emit event.
- **`src/ocr/`** — born-digital text extraction first; Tesseract.js
  fallback for scans with `eng + swa` language packs (Swahili + English).
- **`src/layout/`** — bounding boxes, tables, signature blocks, stamps,
  photo regions. Uses pdfjs-dist when available.
- **`src/extract/`** — classifier + entity extractor. Hybrid: rules first
  (deterministic, citable), LLM second (vision for stamps + free-text
  reasoning).
- **`src/resolve/`** — fuzzy + embedding match against `core_entity`
  via `IEntityResolver` port.
- **`src/route/`** — doc-type + entities → modules + actions matrix.
- **`src/orchestrator.ts`** — `analyzeDocument(documentId)` end-to-end.

## Document taxonomy

| Doc type            | Extracted entities                                                  | Routes to                       |
|---------------------|---------------------------------------------------------------------|---------------------------------|
| `lease_application` | applicant_name, applicant_phone, applicant_nida, requested_asset, requested_rent | ESTATE → `create_lease_application` |
| `lease_contract`    | landlord, tenant, asset, rent, start_date, end_date, signatures     | ESTATE → `create_lease`         |
| `payment_receipt`   | payer_name, amount, currency, gepg_ref, payment_date                | FINANCE → `post_receipt`        |
| `national_id`       | id_number, full_name, dob, photo_region                             | COMPLIANCE → `archive_id`       |
| `condition_survey`  | asset, inspection_date, condition_items, photo_regions              | ESTATE → `update_condition`     |
| `complaint_letter`  | complainant, complaint_topic, asset, urgency                        | CRM → `open_ticket`             |
| `renewal_request`   | tenant, asset, requested_dates                                      | ESTATE → `create_renewal_request` |
| `termination_notice`| tenant, asset, notice_date, effective_date                          | LEGAL → `process_termination`   |
| `vendor_invoice`    | vendor, invoice_number, amount, line_items                          | FINANCE → `process_invoice`     |
| `unknown`           | (heuristic)                                                          | HITL (no auto-route)            |

## Bilingual support

- Tesseract loaded with `eng + swa` traineddata.
- Doc classifier keyword set includes Swahili equivalents
  (mkataba/lease, malipo/payment, kitambulisho/ID, etc.).
- Extracted text preserved verbatim; routing rules work on either.

## Citation back to source

`renderCitation(extractionId)` returns the page + bbox so the frontend
can highlight where the fact came from. Every extraction stores
`page` and `bbox_jsonb` whenever the source method supports it.

## Migrations

- `0211_documents.sql` — top-level document record.
- `0212_document_extractions.sql` — per-fact extractions.
- `0213_document_entities.sql` — entity resolution layer.
- `0214_document_routing.sql` — routing decisions.

All four FORCE RLS via the canonical `current_app_tenant_id()` GUC.

## Optional dependencies

- `pdf-parse` — born-digital PDF text extraction.
- `pdfjs-dist` — page rendering + bbox extraction.
- `tesseract.js` — OCR for scans + images. WASM, no native binaries.

Listed as `optionalDependencies` so the package builds without them. The
adapters lazy-import; if a dep is missing, the adapter falls back to
the synthetic-text path used in tests.

## Tests

- `src/__tests__/ingest.test.ts` — dedupe + persistence.
- `src/__tests__/ocr.test.ts` — text-extraction selector + Tesseract adapter contract.
- `src/__tests__/layout.test.ts` — bbox + table heuristics.
- `src/__tests__/extract.test.ts` — classifier + entity extractor.
- `src/__tests__/resolve.test.ts` — fuzzy + embedding.
- `src/__tests__/route.test.ts` — routing matrix.
- `src/__tests__/orchestrator.test.ts` — end-to-end on 5 fixtures.
- `src/__tests__/rls.test.ts` — repository-port tenant isolation.

Coverage target: 80%+.
