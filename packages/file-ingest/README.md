# @borjie/file-ingest — Phase J2 Conversational Ingest

Owner-customer drops a CSV/Excel/PDF/image into the chat. Mr. Mwikila does:

1. **Schema-sniff** — papaparse / xlsx / pdf-parse (lazy) / OCR shim infer columns, types, samples, primary-key candidates, dedup-key candidates.
2. **Entity-type proposal** — Zod-validated LLM output produces `EntityMappingProposal { entity_type, field_map, confidence, llm_rationale, conflicts }`.
3. **4-eye approval** — `IngestPlan { proposal, batched_rows (100/batch), dryRun }` → owner approves → executor runs.
4. **Ingest** — writes via the J1 `IEntityStoreService` contract (mocked here; J1 will implement).
5. **Provenance** — every attribute carries `{ file_hash, conversation_id, message_id, row_idx, llm_inferred_schema_version, ingest_plan_id, timestamp }`.

## J1 interface contract

`packages/file-ingest/src/entity-store/IEntityStoreService.ts` — pure interface. J1
(branch `claude/j1-entity-store-substrate`) will land an implementation; J2 ships
against the contract with a mock so tests run standalone.

## Confidence calibration

`schema-sniff` returns per-column type confidence (`type_confidence` 0-1). The
proposal layer rolls these up into an overall `confidence`:

- **>= 0.85** → auto-map (heuristic field-map suffices; LLM call is a no-op stub).
- **0.55-0.85** → LLM proposal required; owner sees suggested mapping in chat.
- **< 0.55** → low-confidence; LLM proposal required + flagged for manual review.

Thresholds live in `proposal/thresholds.ts` so they are testable + tunable.

## Provenance hash recipe

```
sha256(
  file_hash || ':' || conversation_id || ':' || ingest_plan_id ||
  ':' || row_idx || ':' || llm_inferred_schema_version
)
```

The composite hash is deterministic — re-ingesting the same file with the same
plan produces the same provenance hashes; the executor short-circuits writes
where provenance already exists (idempotency).

## Status

This package is the J2 deliverable. AI-copilot wiring is deferred until after
CL-B2 lands (see `IngestToolStub.test.ts` for the eventual surface contract).
