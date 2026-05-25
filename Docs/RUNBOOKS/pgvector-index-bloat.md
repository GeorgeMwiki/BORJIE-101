# Runbook: PgvectorIndexBloat

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Alert            | `PgvectorIndexBloat`                                         |
| Severity         | ticket                                                       |
| Team             | brain                                                        |
| Source PromQL    | `pgvector_hnsw_recall_at_10 / on(index) pgvector_hnsw_recall_at_10_baseline < 0.90` |
| Window           | 1h                                                           |
| Rules file       | `monitoring/alerts/borjie-rules.yml` (group `borjie.brain`) |

## Symptoms

- Slack ticket: `PgvectorIndexBloat index=<name>`.
- Recall@10 on the HNSW vector index is < 90% of its post-build baseline.
- Users notice "the assistant can't find that lease/maintenance ticket I
  uploaded last week".
- RAG quality dashboard shows degraded ranking metrics.

## Suspect causes

- High insert/update churn since last `REINDEX` — HNSW graph fragmented.
- Workload distribution shifted (new tenant with very different embeddings).
- `lists`/`m`/`ef_construction` params no longer match data volume.
- Recent `VACUUM FULL` skipped this index.
- Bug in the new ingestion path producing low-quality embeddings.

## Diagnostics

```sh
# 1. Confirm the affected index + size.
psql "$DATABASE_URL" -c "
  SELECT i.relname AS index, pg_size_pretty(pg_relation_size(i.oid)) AS size,
         s.idx_scan, s.idx_tup_read
  FROM pg_class i JOIN pg_index ix ON i.oid = ix.indexrelid
  JOIN pg_stat_user_indexes s ON s.indexrelid = i.oid
  WHERE i.relname LIKE '%hnsw%' ORDER BY pg_relation_size(i.oid) DESC;
"

# 2. Insert/update churn since last build.
psql "$DATABASE_URL" -c "
  SELECT relname, n_tup_ins, n_tup_upd, n_tup_del, last_vacuum, last_analyze
  FROM pg_stat_user_tables WHERE relname LIKE '%embedding%';
"

# 3. Quality probe — run the eval suite for this index.
pnpm --filter @borjie/brain-eval run eval:rag -- --index <name>

# 4. Compare current recall vs baseline.
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  "query=pgvector_hnsw_recall_at_10{index=\"$INDEX\"} / on(index) pgvector_hnsw_recall_at_10_baseline{index=\"$INDEX\"}"
```

## Immediate mitigation

There is no live-traffic mitigation — this is a quality, not availability,
issue. Customer impact is gradual. Schedule the fix below within 24h.

If quality has fallen critically (recall < 70% of baseline), put a temporary
banner in the assistant UI:

```sh
curl -X POST "$PROD_URL/api/v1/admin/feature-flags" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"flag":"rag.degraded_banner","enabled":true}'
```

## Permanent fix

1. Rebuild the index concurrently (does not block reads, takes longer):
   ```sql
   REINDEX INDEX CONCURRENTLY <index_name>;
   ```
2. Re-record baseline after rebuild:
   ```sh
   pnpm --filter @borjie/brain-eval run baseline:rag -- --index <name> --write
   ```
3. If churn is the root cause, schedule a weekly `REINDEX` cron in
   `k8s/cronjobs/` and document in `Docs/RUNBOOKS/cron-supervisor-debug.md`.
4. If embeddings drifted (new model), backfill with the new model and tag
   the index version in `Docs/ARCHITECTURE_BRAIN.md`.

## Escalation contact

1. Brain on-call (`brain-primary`).
2. Brain-eval lead (`#brain-eval`) — they own recall baselines.
3. Data platform lead if `REINDEX` exceeds maintenance window.
