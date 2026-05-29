# Memory Durability — Borjie's "never-lose" guarantee

**Audience:** founder, ops, regulators, support, LLM coding assistants
**Status:** Production-enforced. Regression tests in
`services/api-gateway/src/services/brain-recall/__tests__/`.

## The promise (plain English)

> "Anything you feed Borjie — a CSV, a photo, a voice memo, a typed
> note, a scanned permit — is still there next year, byte-for-byte,
> with the same chunk id, the same embedding, the same audit trail.
> We never quietly drop, prune, or rewrite your data."

The promise has three dimensions:

1. **No silent deletion.** Memory rows are append-only at the SQL
   level (no `DELETE` policy, no TTL job, no scheduled vacuum-purge).
2. **No silent rewrite.** Hash-chained audit rows lock prior content.
3. **No silent forgetting.** The embedding stays at full dimensionality
   (1024) for the entire retention window. We never down-sample, never
   re-embed-and-replace.

## The data model (append-only set)

| Table | Append-only contract | Enforcement |
|---|---|---|
| `intelligence_corpus_chunks` | Insert + supersede (never delete). When a newer chunk replaces an older one, the old row stays and `superseded_by_id` points to the new one. | No `DELETE` policy. The consolidation worker upserts; it never deletes. |
| `corpus_doc_uploads` | Insert + status-update (status flows pending → parsing → chunking → embedded → indexed → failed). Never delete. | Migration 0140 ships no `DELETE` policy. Application code never issues `DELETE`. |
| `corpus_doc_summaries` | Insert once per upload; never updated, never deleted. | Migration 0140 ships no `UPDATE` / `DELETE` policy on this table. |
| `entity_index` | Upsert (refresh metadata + embedding); the row id is stable. | The entity-indexer worker upserts; the row's `kind + id` identity is sticky. |
| `entity_cross_references` | Append (typed edges). Removed only when the source or target entity is hard-deleted (which we don't do). | No application-level DELETE; only cascades from entity removal. |
| `ai_decisions` | Append-only, hash-chained. Mutation is forbidden by CLAUDE.md hard rule + enforced by audit-verifier worker. | Hash chain breaks on any mutation; the daily audit-chain integrity worker raises an alert. |
| `outcome_predictions` | Insert at decision time; outcome_reconciliation-worker fills in the actual outcome via a SEPARATE row (`outcome_observations`). The original prediction is never overwritten. | No `UPDATE` on `predicted_at` / `predicted_value` columns. |
| `decisions` (decision-journal) | Append-only. Supersession via a new row pointing back. | Per migration 0125 unique constraint + the recorder never `UPDATE`s. |

## How it's enforced (defence in depth)

### Layer 1 — Schema

- No `ON DELETE CASCADE` from tenant-scoped DELETE entrypoints. The
  only cascades are tenant lifecycle (full tenant termination, which
  triggers a full audit export first).
- No TTL columns. No `pg_cron` job purges memory tables.
- RLS policies grant `SELECT` only — there is no `FOR DELETE` policy
  on memory tables, so even a compromised app would be blocked at the
  RLS layer.

### Layer 2 — Application code

- The `services/api-gateway/src/services/brain-ingestion/` package
  exposes only `ingest()` and `getReceipt()` — no `delete()`.
- The decision journal recorder
  (`services/api-gateway/src/services/decision-journal/recorder.ts`)
  exports `recordDecision()` and `linkDecisions()`; no
  `deleteDecision()`.
- The entity-indexer worker upserts with stable ids; it never issues
  `DELETE`.

### Layer 3 — Audit chain verifier

- `services/api-gateway/src/workers/audit-chain-verifier.ts` recomputes
  the hash of every `ai_decisions` row against the prior row each
  night. Any mismatch → Sentry alert + paged founder.

### Layer 4 — Restore drill

- Monthly: dump `intelligence_corpus_chunks` + `corpus_doc_uploads`
  + `corpus_doc_summaries` + `entity_index` + `entity_cross_references`
  + `ai_decisions` to S3 (encrypted, 7-year retention).
- Quarterly: restore the dump to a staging DB, run the brain-recall
  integration test, confirm every seeded fact is recallable with
  identical chunk_ids.

### Layer 5 — Tenant-export self-service

- The owner can request a full memory export at any time via
  `GET /api/v1/owner/brain/export` (planned; tracked in
  `Docs/KNOWN_ISSUES.md`). The export ships every chunk, every
  embedding, every entity, every decision in JSON-Lines + a SHA-256
  manifest. The owner owns their brain.

## What we explicitly do NOT promise

- **No promise that embeddings will be identical across model
  versions.** When OpenAI ships a new `text-embedding-3-extra-large`,
  we'll backfill the column in place via a new column, not by replacing
  the existing one. The old embedding survives until the new one
  validates.
- **No promise of zero-latency recall.** Memory durability is about
  *not losing*, not about latency. Recall latency is governed by the
  `services/realtime-latency/` SLO monitor.
- **No promise of perfect OCR.** A blurry photo of a permit will be
  OCR'd best-effort. The original image stays in `storage_url` so a
  better OCR pass next year can re-derive the text.

## How to verify the promise in dev

```sh
# 1. Seed a doc.
pnpm -F api-gateway test brain-recall

# 2. Run the durability regression suite.
pnpm -F api-gateway test memory-durability

# 3. Manual: ingest a doc, then check no DELETE happened.
psql $DATABASE_URL -c "SELECT count(*) FROM corpus_doc_uploads WHERE status = 'redacted';"
# Expected: 0 in dev. Redaction only triggers via owner-initiated
# tenant data-erasure request, which itself writes an audit row.
```

## Incident protocol (if a recall returns nothing)

1. Check `corpus_doc_uploads` row for the failed doc. Status should
   be `indexed`. If it's `failed`, the error_message tells you why.
2. Check `intelligence_corpus_chunks` row count for the same
   `source_doc_id`. If zero, the chunker failed — re-run via
   `POST /api/v1/owner/brain/ingest/{uploadId}/reprocess`.
3. If chunks exist but recall is empty, the embedding probably ran on
   the stub model. Set `OPENAI_API_KEY` and reprocess.
4. Never delete the failed row. The failure record itself is part of
   the memory; the next reprocess writes a new chunk and keeps the
   trail.

## Owner-facing wording (for cockpit copy)

EN: *"Borjie remembers everything you give it. We never quietly drop
or rewrite your data. The document you uploaded today will still be
here next year — same words, same citation, same evidence id."*

SW: *"Borjie inakumbuka kila kitu unachopa. Hatufuti wala
kubadilisha taarifa zako kimya kimya. Hati uliyoipakia leo itakuwa
hapa hapa mwakani — maneno yale yale, chanzo kilekile, kitambulisho
cha ushahidi kilekile."*
