# Runbook: Corpus Citations Empty

| Field        | Value                                               |
| ------------ | --------------------------------------------------- |
| Slug         | `corpus-citations-empty`                            |
| Severity     | P1 (junior recs fail evidence-required gate)        |
| Team         | brain + corpus + database                           |
| Owner code   | `packages/central-intelligence/src/corpus/*`, `services/consolidation-worker/src/tasks/borjie-corpus-ingest.ts` |

## Symptoms

- Junior agent recommendations return with empty `evidence_ids[]`.
- Sentry event: `CorpusCitationsEmpty` or `CorpusZeroRows`.
- Auditor Agent rejects the response: `AUDITOR_NO_EVIDENCE_CHAIN`.
- User sees in-app: "I cannot make this recommendation — no
  supporting evidence found."
- `intelligence_corpus_chunks` count is 0 OR tenant cannot read its
  own rows.

## Detection

- Sentry alert "Junior recs with empty evidence > 5% in 15m".
- Bridge auto-files a GitHub Issue with label
  `runbook:corpus-citations-empty`.
- Dashboard panel `Brain · Evidence chain coverage` < 95%.

## Diagnosis

```sh
# 1. Confirm the table even has rows (global ingest may have failed).
psql "$DATABASE_URL" -c "
  SELECT count(*) AS total,
         count(*) FILTER (WHERE tenant_id IS NULL) AS global,
         count(*) FILTER (WHERE tenant_id = '$TENANT_ID') AS tenant
    FROM intelligence_corpus_chunks;
"

# 2. Was the first-boot ingestion job ever run?
psql "$DATABASE_URL" -c "
  SELECT MAX(created_at) FROM intelligence_corpus_chunks WHERE tenant_id IS NULL;
"

# 3. Can the tenant actually see global rows (RLS sanity)?
psql "$DATABASE_URL" -c "
  SET app.tenant_id = '$TENANT_ID';
  SELECT count(*) FROM intelligence_corpus_chunks;
  RESET app.tenant_id;
"

# 4. Is the pgvector index healthy?
psql "$DATABASE_URL" -c "
  SELECT relname, pg_size_pretty(pg_relation_size(indexrelid))
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname LIKE 'idx_corpus%';
"

# 5. Pull the last 3 retrieval attempts and confirm vector match.
psql "$DATABASE_URL" -c "
  SELECT query, returned_chunk_count, top_score, created_at
    FROM corpus_retrieval_log
   WHERE tenant_id = '$TENANT_ID'
   ORDER BY created_at DESC LIMIT 3;
"
```

## Fix

Pick by symptom:

1. **`total = 0`** (corpus never ingested):
   - Set the corpus root path and re-run ingest:
     ```sh
     export BORJIE_MINING_CORPUS_PATH="/path/to/corpus/Docs/"
     pnpm --filter @borjie/consolidation-worker exec \
       tsx src/tasks/borjie-corpus-cli.ts --reingest
     ```
   - Verify count rises above 0 with the diagnostic #1 query.

2. **`global > 0` but `tenant = 0` AND tenant query returns 0**:
   - RLS policy is blocking global rows. Check policy:
     ```sh
     psql "$DATABASE_URL" -c "
       SELECT polname, polqual FROM pg_policy
        WHERE polrelid = 'intelligence_corpus_chunks'::regclass;
     "
     ```
   - Expected: policy should be `tenant_id IS NULL OR tenant_id = current_setting(...)`.
     If `tenant_id IS NULL` clause is missing, re-apply migration:
     ```sh
     pnpm tsx scripts/repair-corpus-rls.ts --tenant=$TENANT_ID --confirm
     ```

3. **Index missing or bloated**:
   - Rebuild concurrently (no downtime):
     ```sh
     psql "$DATABASE_URL" -c "
       REINDEX INDEX CONCURRENTLY idx_corpus_chunks_embedding;
     "
     ```

4. **Vector retrieval returns 0 even with rows present** (similarity
   threshold too high):
   - Lower the threshold for this tenant (kept conservative for the
     pilot):
     ```sh
     pnpm tsx scripts/corpus/set-threshold.ts \
       --tenant=$TENANT_ID --threshold=0.55
     ```
   - Default `0.70` is tuned for production; pilot fine-tune is `0.55`
     until corpus depth is verified.

5. **Specific query routinely empty** (corpus has gaps):
   - Identify the gap:
     ```sh
     pnpm tsx scripts/corpus/show-gap.ts \
       --query="$FAILED_QUERY" --tenant=$TENANT_ID
     ```
   - File a content ticket — owner is Mr. Mwikila for new mining
     domain content. Do NOT add filler content; the Auditor Agent
     correctly rejects empty evidence.

## Prevention

- Make the first-boot ingest **mandatory** on tenant creation:
  ```sh
  psql "$DATABASE_URL" -c "
    SELECT key, enabled FROM kill_switches
     WHERE key = 'tenant_creation.require_corpus_ingest';
  "
  ```
  Should be `enabled=true`. Toggle if not.
- Health probe `/api/v1/health/corpus` returns 503 when global rows = 0;
  load balancer routes around the unhealthy pod.
- Daily smoke (`scripts/smoke/corpus.sh`) runs 12 known-good queries
  per cohort. Slack-pages on regression.

## Severity

- **P1** during pilot — junior recs lose credibility instantly. SLA:
  ack 30m, restore retrieval within 2h.
- **P0** in production — drives the entire reasoning loop.

## Linked Sentry fingerprints

_(Populated by `sentry-to-github.ts` over time. Initial list empty.)_
