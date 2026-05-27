# Runbook: Mobile Data Flapping (rural TZ pilot)

| Field        | Value                                              |
| ------------ | -------------------------------------------------- |
| Slug         | `network-mobile-data-flapping`                     |
| Severity     | P2 (degraded UX, app should self-heal)             |
| Team         | mobile + sync                                      |
| Owner code   | `apps/workforce-mobile/src/network/*`, `packages/sync-engine/src/retry-policy.ts` |

## Symptoms

- Pilot user in rural Tanzania reports: "App keeps spinning and then
  saying offline."
- Sentry event: `NetworkFlapping` or `NetworkOfflineRetryExhausted`.
- Mobile telemetry shows alternating `online`/`offline` events <30s
  apart, sustained.
- Photo uploads partially complete then fail with `ECONNRESET`.
- `sync_drain_attempts.error_kind = 'network_unreachable'` in
  bursts.

## Detection

- Sentry alert "Network flap events > 5 per user per 10m".
- Bridge auto-files a GitHub Issue with label
  `runbook:network-mobile-data-flapping`.

## Diagnosis

```sh
# 1. Confirm the flap pattern (online → offline → online).
psql "$DATABASE_URL" -c "
  SELECT created_at, payload->>'state', payload->>'rtt_ms'
    FROM mobile_telemetry_events
   WHERE user_id = '$USER_ID'
     AND event_name IN ('network_online','network_offline')
     AND created_at > now() - interval '30 minutes'
   ORDER BY created_at;
"

# 2. What carrier + signal strength was reported?
psql "$DATABASE_URL" -c "
  SELECT payload->>'carrier', payload->>'signal_dbm', payload->>'tech'
    FROM mobile_telemetry_events
   WHERE user_id = '$USER_ID'
     AND event_name = 'network_state_snapshot'
   ORDER BY created_at DESC LIMIT 5;
"

# 3. Geographic context — known low-coverage area?
psql "$DATABASE_URL" -c "
  SELECT gps_latitude, gps_longitude, accuracy_m
    FROM mobile_geo_pings
   WHERE user_id = '$USER_ID'
     AND created_at > now() - interval '1 hour'
   ORDER BY created_at DESC LIMIT 1;
"
# Cross-ref against rural-low-coverage atlas:
pnpm tsx scripts/network/check-coverage.ts \
  --lat=$LAT --lon=$LON --carrier=$CARRIER
```

## Fix

Pick by signal pattern:

1. **Flap at 30-60s cadence, signal_dbm bouncing -95 ↔ -110**
   (classic rural cell-edge):
   - Switch the mobile client to **aggressive offline mode**: queue
     everything, attempt drain only when online for >2 minutes
     continuous. Toggle via remote config:
     ```sh
     pnpm tsx scripts/feature-flags/set.ts \
       --tenant=$TENANT_ID --user=$USER_ID \
       --flag=sync.aggressive_offline_mode --value=true
     ```
   - Push the config to the user immediately:
     ```sh
     pnpm tsx scripts/mobile/send-push.ts \
       --user-id=$USER_ID --type=config_refresh
     ```

2. **Long-running offline (>30 min), then short online bursts**:
   - The default retry policy backs off too aggressively (1m → 5m →
     15m). For pilot rural users, use a tighter schedule:
     ```sh
     pnpm tsx scripts/feature-flags/set.ts \
       --tenant=$TENANT_ID --user=$USER_ID \
       --flag=sync.retry_policy --value=rural_tz_v1
     ```
   - `rural_tz_v1` policy lives in
     `packages/sync-engine/src/retry-policy.ts` — 15s → 30s → 60s
     → 120s (capped), 9 attempts.

3. **Photos timing out at chunk boundaries** (uploads >1MB on 3G):
   - Lower the chunk-size:
     ```sh
     pnpm tsx scripts/feature-flags/set.ts \
       --tenant=$TENANT_ID --user=$USER_ID \
       --flag=upload.chunk_size_kb --value=64
     ```
   - Mobile client picks up on next app foreground.

4. **Tech downgraded from 4G to 2G** (`tech=GSM` or `EDGE`):
   - The brain endpoint REST payload is too heavy for 2G. Enable
     compact-mode (1/10th payload size, no chain-of-thought):
     ```sh
     pnpm tsx scripts/feature-flags/set.ts \
       --tenant=$TENANT_ID --user=$USER_ID \
       --flag=brain.response_mode --value=compact
     ```

5. **Carrier outage confirmed** (cellmapper API shows outage):
   - Document, file a notice to the pilot lead. No server-side fix.
   - Ensure user has fallback in writing: "If your phone shows no
     bars for >5 minutes, walk 200m toward [closest reliable landmark]
     and re-open the app. Your data is safe."

## Prevention

- Network state machine in mobile already debounces transitions (250ms
  hold-down). Verify it's still active — check telemetry:
  ```sh
  psql "$DATABASE_URL" -c "
    SELECT count(*) FROM mobile_telemetry_events
     WHERE user_id = '$USER_ID'
       AND event_name = 'network_state_change'
       AND created_at > now() - interval '1 hour';"
  ```
  Should be ≤ raw `network_online`/`network_offline` events.
- Pre-pilot site survey: log signal_dbm at each pilot site. If <-100
  dBm sustained, switch the user to satellite-friendly mode
  preemptively.
- "Offline-first" copy in every blocking action: "Saved — will sync
  when online" (already in
  `apps/workforce-mobile/src/components/offline-banner.tsx`).

## Severity

- **P2** during pilot — frustrating but data is safe (queue + DLQ).
  SLA: ack 1h, mitigate (aggressive-offline-mode) within 4h.
- **P3** in production with default settings tuned for typical urban
  connectivity.

## Linked Sentry fingerprints

_(Populated by `sentry-to-github.ts` over time. Initial list empty.)_
