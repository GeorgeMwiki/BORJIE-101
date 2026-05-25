# File Ingest Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/file-ingest/`
**Public entry:** `packages/file-ingest/src/index.ts`
**Tier scope:** platform spine (Phase J2 conversational ingest)

## Purpose

The conversational-ingest pipeline: drop a CSV/XLSX/PDF/JSON into a
chat and Borjie sniffs the schema, proposes a mapping to the
canonical domain model, lets a human approve, and writes provenance
so every cell can be traced back to the source. Five-stage pipeline:
**entity-store → schema-sniff → proposal → approval → provenance**.
Hardened post-Wave-1 against SSRF + path traversal in URL ingest.

## Entry points

- `src/index.ts` — barrel re-exporting each stage.
- `src/entity-store/` — staged-row store with tenant scope.
- `src/schema-sniff/` — column-type inference + header detection.
- `src/proposal/` — generates a proposed mapping.
- `src/approval/` — human-in-the-loop approval state machine.
- `src/provenance/` — source → cell lineage writer.

## Internal structure

- Each stage is a sub-package with its own `index.ts`.
- `__tests__/` — coverage per stage + integration tests.

## Dependencies

- Upstream: `@borjie/domain-models`, `@borjie/database`,
  `@borjie/observability`, csv parser, XLSX reader.
- Downstream: api-gateway ingest route, chat-ui upload flow.

## Common workflows

- **Stage a file** → `entityStore.stage(buffer, mime, tenantId)`.
- **Sniff schema** → `schemaSniff.infer(rows)`.
- **Propose mapping** → `proposal.fromSniff(sniff, target='lease')`.
- **Approve** → operator hits approval UI; status transitions
  `proposed → approved → committed`.
- **Trace** → `provenance.query({ cellId })` returns source row.

## Anti-patterns to avoid

- Never trust client-supplied MIME — sniff content.
- Never let a URL ingest fetch private CIDR (SSRF guard mandatory).
- Never resolve filenames with `..` — sanitised in entity-store.
- Never auto-commit a proposal without an approver — human in loop.

## Related codemaps

- [chat-ui.md](./chat-ui.md) — upload + approve UI
- [database.md](./database.md) — provenance table
- [observability.md](./observability.md) — audit each stage
