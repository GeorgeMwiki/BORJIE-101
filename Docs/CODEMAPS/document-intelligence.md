# Document Intelligence Codemap

**Last Updated:** 2026-05-22
**Module:** `services/document-intelligence/`
**Public entry:** `services/document-intelligence/src/index.ts`
**Tier scope:** platform spine (document processing + KYC)

## Purpose

Implements Module G of the spec: document collection (G.1), OCR +
data extraction (G.2 via AWS Textract / Google Vision), fraud
detection (G.3), validation + consistency (G.4), expiry tracking
(G.6), and evidence-pack builder (G.7). The substrate behind KYC
flows, lease-document parsing, ID verification, and the regulatory
evidence packs.

## Entry points

- `src/index.ts` — barrel.
- `src/types/` — `Document`, `KycCheck`, `FraudSignal`, `EvidencePack`.
- `src/repositories/interfaces.ts` — repository ports.
- `src/routes/` — Hono routes mountable in api-gateway.
- `src/scan/` — scan + capture flow.
- `src/services/` — service implementations.
- `src/providers/` — OCR provider adapters (Textract, Vision).
- `src/utils/` — quality validation, EXIF, normalisation.

## Internal structure

- `routes/` — HTTP handlers.
- `services/` — orchestration: collection → OCR → fraud → validate
  → expiry → evidence.
- `providers/` — pluggable OCR + biometric.

## Dependencies

- Upstream: `@borjie/observability`, `@borjie/database`,
  `@borjie/domain-models`, AWS SDK (Textract, S3), Google Vision SDK.
- Downstream: domain-services (lease + customer KYC), reports
  (evidence packs), api-gateway.

## Common workflows

- **Upload + OCR** →
  `documentService.collect(file)` → `ocr.extract(docId)` →
  `fraud.evaluate(docId)`.
- **Verify identity** →
  `idCheck.run({ docId, claimedName, claimedDob })`.
- **Build evidence pack** →
  `evidencePack.build({ caseId, leaseId })`.
- **Expiry monitor** → background poller flags expiring docs.

## Anti-patterns to avoid

- Never store raw documents in DB — use S3 + signed URLs.
- Never log OCR raw text (contains PII).
- Never run OCR without the file-type sniffer first.
- Never trust client-supplied EXIF — re-extract.

## Related codemaps

- [file-ingest.md](./file-ingest.md) — sibling import path
- [database.md](./database.md) — documents schema
- [observability.md](./observability.md) — KYC audit
