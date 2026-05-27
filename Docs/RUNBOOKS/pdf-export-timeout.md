# Runbook: PDF Export Timeout (owner-web)

| Field        | Value                                              |
| ------------ | -------------------------------------------------- |
| Slug         | `pdf-export-timeout`                               |
| Severity     | P2 (workaround: CSV export available)              |
| Team         | owner-web + artifacts + brain                      |
| Owner code   | `services/api-gateway/src/composition/artifact-render-wiring.ts`, `apps/owner-web/src/audit/export.tsx` |

## Symptoms

- Owner clicks "Export Audit Pack" — spinner > 30s, then "Export
  failed" toast.
- Sentry event: `PdfExportTimeout` or `ArtifactRenderTimeout`.
- `POST /api/v1/artifacts/render` returns 504 in gateway log.
- Playwright artifact-render worker pod has p95 > 25s on PDF
  rendering.

## Detection

- Sentry alert "PDF export p95 latency > 30s in 10m".
- Bridge auto-files a GitHub Issue with label
  `runbook:pdf-export-timeout`.

## Diagnosis

```sh
# 1. Which audit pack is failing? Size matters.
psql "$DATABASE_URL" -c "
  SELECT id, tenant_id, audit_pack_kind,
         pg_size_pretty(LENGTH(rendered_html_cache)) AS html_size,
         created_at
    FROM audit_pack_renders
   WHERE tenant_id = '$TENANT_ID'
     AND created_at > now() - interval '1 hour'
   ORDER BY created_at DESC LIMIT 5;
"

# 2. Playwright pod health.
kubectl -n borjie top pod -l app=artifact-renderer
kubectl -n borjie logs deploy/artifact-renderer --since=10m \
  | rg -i 'timeout|killed|oom' | head

# 3. Average page count for owner-web audit packs.
psql "$DATABASE_URL" -c "
  SELECT audit_pack_kind, AVG(page_count), MAX(page_count)
    FROM audit_pack_renders
   WHERE tenant_id = '$TENANT_ID'
     AND created_at > now() - interval '7 days'
   GROUP BY audit_pack_kind;
"

# 4. Is the chart-generation upstream slow? Charts are inlined into
#    audit packs as SVG; the brain generates them.
psql "$DATABASE_URL" -c "
  SELECT chart_id, latency_ms FROM chart_generation_log
   WHERE tenant_id = '$TENANT_ID'
     AND created_at > now() - interval '15 minutes'
   ORDER BY latency_ms DESC LIMIT 10;
"
```

## Fix

Pick by failure mode:

1. **Audit pack >50 pages** (typical when 90-day market intel is
   appended):
   - Split into per-month chunks; render in parallel and merge:
     ```sh
     pnpm tsx scripts/audit-pack/render-chunked.ts \
       --tenant=$TENANT_ID --pack-id=$PACK_ID --chunk-size=15
     ```
   - Result is a multi-chunk PDF concatenated server-side.

2. **Playwright pod OOM-killed**:
   - Bump memory:
     ```sh
     kubectl -n borjie set resources deploy/artifact-renderer \
       --limits=memory=4Gi --requests=memory=2Gi
     kubectl -n borjie rollout restart deploy/artifact-renderer
     kubectl -n borjie rollout status deploy/artifact-renderer --timeout=120s
     ```

3. **Chart-generation backed up** (>5s per chart, multiplied by 20+
   charts):
   - Pre-render charts and cache. The brain has a cache key per
     `(tenant_id, chart_kind, range_start, range_end)`:
     ```sh
     pnpm tsx scripts/charts/prewarm.ts \
       --tenant=$TENANT_ID --pack-kind=$PACK_KIND
     ```
   - Then re-trigger the export.

4. **Single specific section times out** (e.g., the "Lifecycle of
   Tanzanite Bid" section):
   - Disable just that section in the next render:
     ```sh
     pnpm tsx scripts/audit-pack/skip-section.ts \
       --tenant=$TENANT_ID --pack-kind=$PACK_KIND \
       --skip-section=tanzanite-lifecycle --reason="render-timeout"
     ```
   - File a section-level bug against the brain — that template is
     expensive.

5. **Owner needs the data NOW and rendering is genuinely down**:
   - Fall back to CSV export (always available, no Playwright in the
     path):
     ```sh
     pnpm tsx scripts/audit-pack/export-csv.ts \
       --tenant=$TENANT_ID --pack-id=$PACK_ID --out=/tmp/pack.csv
     ```
   - Email the CSV to the owner with a note that the PDF will follow
     once renderer recovers.

## Prevention

- Set explicit 25s budget on PDF render (5s less than the 30s
  client-side timeout) so the client gets a clean error instead of
  504. Already in `services/api-gateway/src/middleware/timeout.ts`.
- Pre-render the *current* audit pack at 03:00 EAT nightly via a
  scheduled job (`scripts/audit-pack/nightly-prewarm.sh`). Cached
  render = sub-second export.
- Track PDF render p95 SLO at 8s. Alert when sustained > 15s for
  three consecutive 5m windows.
- If a tenant repeatedly hits the 50-page threshold, suggest the
  weekly compact audit pack (15 pages, summary-only) as default.

## Severity

- **P2** during pilot — owner has CSV workaround. SLA: ack 1h, fix
  within 12h.
- **P3** in production — pre-warm + caching keep it rare.

## Linked Sentry fingerprints

_(Populated by `sentry-to-github.ts` over time. Initial list empty.)_
