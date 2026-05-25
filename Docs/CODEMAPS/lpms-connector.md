# LPMS Connector Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/lpms-connector/`
**Public entry:** `packages/lpms-connector/src/index.ts`
**Tier scope:** platform spine (legacy LPMS bulk import)

## Purpose

Bulk-import adapter for incumbent Legacy Property Management Systems
(LPMS). Customers migrating to Borjie export CSV/JSON/XML dumps
from their old portals; this package normalises any of the three
formats into the canonical schema. Used by both the admin
legacy-migration UI and the conversational ingest pipeline.

## Entry points

- `src/index.ts` — barrel.
- `src/adapter.ts` — `LpmsAdapter` interface.
- `src/csv-adapter.ts`, `src/json-adapter.ts`, `src/xml-adapter.ts` —
  format-specific adapters.
- `src/types.ts` — `LpmsRow`, `LpmsBatch`, error types.

## Internal structure

- `adapter.ts` — common interface + dispatcher.
- One file per format adapter.
- `__tests__/` — golden fixtures per format.

## Dependencies

- Upstream: papaparse (CSV), xml2js (XML).
- Downstream: file-ingest (uses LPMS adapters in schema-sniff),
  admin-platform-portal legacy-migration.

## Common workflows

- **Detect format** → `adapter.sniff(buffer, mime)`.
- **Parse to rows** → `adapter.parse(buffer)` → `LpmsBatch`.
- **Pipe to ingest** → feed rows into `file-ingest` proposal stage.

## Anti-patterns to avoid

- Never trust client-supplied schema hints — always sniff.
- Never load huge files into memory — stream when possible.
- Never log raw row content (PII).
- Never bypass the adapter — go through the dispatcher.

## Related codemaps

- [file-ingest.md](./file-ingest.md) — downstream
- [browser-perception.md](./browser-perception.md) — sibling import path
- [domain-models.md](./domain-models.md) — canonical schema
