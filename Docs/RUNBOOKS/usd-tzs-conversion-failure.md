# Runbook: USD/TZS Conversion Failure

| Field        | Value                                              |
| ------------ | -------------------------------------------------- |
| Slug         | `usd-tzs-conversion-failure`                       |
| Severity     | P1 (blocks any cross-currency money render)        |
| Team         | payments + fx + brain                              |
| Owner code   | `packages/fx-rates/*`, `services/payments-ledger/src/fx/*` |

## Symptoms

- Pilot user reports: "Buyer-mobile won't let me see the USD price."
- Sentry event: `FxRateUnavailable` or `FxConversionFailed`.
- API `/api/v1/payments/quote` returns 503 with `code='FX_UNAVAILABLE'`.
- `fx_rates` table has no row for `(USD, TZS)` newer than 24 hours.
- Owner-cockpit Market Intelligence panel shows "—" for USD-converted
  values.

## Detection

- Sentry alert "FX-conversion failures > 1% in 10m" — fires fast.
- Bridge auto-files a GitHub Issue with label
  `runbook:usd-tzs-conversion-failure`.
- Per CLAUDE.md USD-cliff rule: domestic non-TZS contracts are
  rejected at API layer; this runbook covers READ-side conversion for
  comparative display.

## Diagnosis

```sh
# 1. How stale is the most recent USD/TZS rate?
psql "$DATABASE_URL" -c "
  SELECT base, quote, rate, source, fetched_at,
         now() - fetched_at AS age
    FROM fx_rates
   WHERE base = 'USD' AND quote = 'TZS'
   ORDER BY fetched_at DESC LIMIT 5;
"

# 2. Did the refresh-fx-rates job run today?
psql "$DATABASE_URL" -c "
  SELECT created_at, status, error_message
    FROM scheduled_job_runs
   WHERE job_name = 'refresh-fx-rates'
     AND created_at > now() - interval '24 hours'
   ORDER BY created_at DESC;
"

# 3. Test the upstream rate provider directly.
curl -sf "https://openexchangerates.org/api/latest.json?app_id=$OPENEXCHANGE_APP_ID&base=USD&symbols=TZS" \
  | jq '.rates.TZS' || echo "OPENEXCHANGE DOWN"

# Also try the secondary provider:
curl -sf "https://api.exchangerate.host/latest?base=USD&symbols=TZS" \
  | jq '.rates.TZS' || echo "EXCHANGERATE.HOST DOWN"

# 4. Bank of Tanzania official rate (regulatory fallback):
curl -sf "https://www.bot.go.tz/api/exchange-rates/USD" \
  | jq '.selling' || echo "BOT DOWN"
```

## Fix

Pick by what's working:

1. **One provider down, another up**:
   - The fx-rates service has a primary/secondary fallback already.
     Force switch:
     ```sh
     pnpm tsx scripts/feature-flags/set.ts \
       --flag=fx.primary_provider --value=exchangerate_host
     pnpm refresh-fx-rates
     ```

2. **All upstream providers down (rare)**:
   - Use the **Bank of Tanzania pegged rate** as a hard fallback. This
     is a regulatory-acceptable conservative rate (1-2% wider spread):
     ```sh
     pnpm tsx scripts/fx/manual-publish.ts \
       --base=USD --quote=TZS --source=BOT_OFFICIAL \
       --reason="upstream-outage" --confirm
     ```
   - Document the manual publish in the on-call log. Owner reviews
     within 4h.

3. **Refresh job failed silently** (cron didn't fire):
   - Trigger the job manually:
     ```sh
     pnpm refresh-fx-rates
     ```
   - If it succeeds, check why the scheduler missed it:
     ```sh
     kubectl -n borjie logs deploy/cron-supervisor --since=24h \
       | rg 'refresh-fx-rates' | tail
     ```

4. **Rate fetched but `fx_rates` insert failed (DB issue)**:
   - Check the insert error:
     ```sh
     pnpm tsx scripts/fx/diagnose-insert.ts --base=USD --quote=TZS
     ```
   - Most likely a unique-constraint clash with an old in-flight
     transaction. Force commit of pending fx-rate transactions:
     ```sh
     psql "$DATABASE_URL" -c "
       SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE query LIKE '%INSERT INTO fx_rates%'
          AND state = 'idle in transaction'
          AND state_change < now() - interval '5 minutes';
     "
     ```

5. **Brain pipeline asks for `KES → TZS` or other non-USD route**:
   - We compute non-USD via USD intermediate. If USD route is broken,
     all cross-rates fail. Fix #1-#4 first, then verify:
     ```sh
     curl -sf "$API/api/v1/fx/convert?from=KES&to=TZS&amount=100" | jq
     ```

## Critical: never hard-code a rate

- Per CLAUDE.md: "Never hard-code TZS / USD / KES." Even during an
  outage the manual publish via `scripts/fx/manual-publish.ts` records
  the source as `BOT_OFFICIAL` so the audit chain is intact.
- DO NOT bypass the FX service to "just show something" in the UI —
  return the typed `FX_UNAVAILABLE` error and let the client show "—".

## Prevention

- The refresh-fx-rates cron runs every 6 hours during pilot (vs daily
  in prod). Verify schedule:
  ```sh
  kubectl -n borjie get cronjob refresh-fx-rates -o jsonpath='{.spec.schedule}'
  ```
  Should be `0 */6 * * *` during pilot weeks.
- Alert: any fx_rate age > 12h triggers a Slack page.
- Maintain `fx_rates_dlq` — rates that failed to insert are retained
  for forensic replay.
- Health probe `/api/v1/health/fx` returns 503 when (USD,TZS) is
  stale > 24h. Load balancer routes around to a pod with fresh state.

## Severity

- **P1** during pilot — buyer-mobile pricing cannot render. SLA: ack
  30m, restore via fallback provider within 1h.
- **P1** in production — same SLA, with BOT_OFFICIAL fallback always
  available.

## Linked Sentry fingerprints

_(Populated by `sentry-to-github.ts` over time. Initial list empty.)_
