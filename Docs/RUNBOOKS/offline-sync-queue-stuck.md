# Runbook: Offline Sync Queue Stuck

| Field        | Value                                              |
| ------------ | -------------------------------------------------- |
| Slug         | `offline-sync-queue-stuck`                         |
| Severity     | P1 (silent data loss risk)                         |
| Team         | mobile + sync + database                           |
| Owner code   | `apps/workforce-mobile/src/offline/enqueue-write.ts`, `packages/sync-engine/*` |

## Symptoms

- Pilot user reports: "I added 5 deliveries yesterday but my manager
  doesn't see them."
- Sentry event: `OfflineSyncStuck` or `EnqueueWriteQueueFull`.
- `mobile_offline_queue.length` rises monotonically over 1+ hour
  without flushing.
- In-app sync indicator stays on "Pending 5" even with full bars.
- `sync_drain_attempts` table shows retries with `error_kind=*` but
  no successes for the user.

## Detection

- Sentry alert "Offline queue length > 10 entries for any user > 1h".
- Bridge auto-files a GitHub Issue with label
  `runbook:offline-sync-queue-stuck`.
- Dashboard panel `Pilot · Sync drain rate` < 0.95.

## Diagnosis

```sh
# 1. Queue depth and oldest entry for the user.
psql "$DATABASE_URL" -c "
  SELECT count(*) AS depth,
         MIN(created_at) AS oldest,
         MAX(created_at) AS newest
    FROM mobile_offline_queue
   WHERE user_id = '$USER_ID' AND status != 'drained';
"

# 2. What error is the drain failing with?
psql "$DATABASE_URL" -c "
  SELECT attempt_no, error_kind, error_message, attempted_at
    FROM sync_drain_attempts
   WHERE user_id = '$USER_ID'
   ORDER BY attempted_at DESC LIMIT 10;
"

# 3. Is the user's auth token still valid?
psql "$DATABASE_URL" -c "
  SELECT expires_at, expires_at - now() AS time_left
    FROM auth_sessions
   WHERE user_id = '$USER_ID'
   ORDER BY created_at DESC LIMIT 1;
"

# 4. The actual queued payloads (last 5) — look for one bad apple.
psql "$DATABASE_URL" -c "
  SELECT id, operation, table_name, payload->>'idempotency_key'
    FROM mobile_offline_queue
   WHERE user_id = '$USER_ID' AND status != 'drained'
   ORDER BY created_at LIMIT 5;
"
```

## Fix

Pick by error_kind:

1. **`auth_expired`** (most common):
   - User's session expired offline. Mobile is supposed to refresh
     transparently but the refresh path failed. Force re-auth:
     ```sh
     pnpm tsx scripts/mobile/send-push.ts \
       --user-id=$USER_ID --type=reauth_required
     ```
   - User taps push → re-enters OTP → queue drains automatically.

2. **`idempotency_conflict`** (server says "already saw this op"):
   - One write completed server-side but the mobile client didn't
     record the ACK (e.g., crashed mid-flight). Confirm with:
     ```sh
     psql "$DATABASE_URL" -c "
       SELECT created_at FROM ledger_postings
        WHERE idempotency_key = '$IDEMP_KEY';"
     ```
   - If a row exists, **mark the queue entry as drained manually**:
     ```sh
     pnpm tsx scripts/sync/mark-drained.ts \
       --user-id=$USER_ID --idempotency-key=$IDEMP_KEY \
       --reason="post-hoc confirm — server has the write"
     ```

3. **`validation_failed`** (server rejected the payload):
   - A schema drift between mobile (v1.2.0) and server (v1.3.0)
     happened. The blocking entry is poisoning the queue. **Quarantine
     it**:
     ```sh
     pnpm tsx scripts/sync/quarantine-entry.ts \
       --queue-id=$QUEUE_ID --reason="schema-drift"
     ```
   - Then push the mobile client to update:
     ```sh
     pnpm tsx scripts/mobile/send-push.ts \
       --user-id=$USER_ID --type=app_update_required
     ```

4. **`network_unreachable`** persistent for >1h:
   - Connectivity not transient — check carrier outage:
     ```sh
     curl -sf "https://api.cellmapper.net/coverage?country=TZ&carrier=$CARRIER" \
       | jq '.outages | length'
     ```
   - If carrier outage confirmed, document, and wait — no server-side
     fix possible.

5. **`server_5xx`** (server hot path issue):
   - Cross-check `api-error-rate-high.md`. The queue WILL drain when
     the server recovers — no mobile-side action required.

## Critical: never drop user data

- Default policy: **never call `clearQueue()` to "unstick" things.**
  Use `quarantine-entry` so the row is preserved with a reason. The
  pilot team reviews quarantined rows daily.
- If a queue entry is poisoning the whole drain (corrupt payload),
  quarantine ONLY that entry and resume normal draining.

## Prevention

- The queue MUST have a per-entry retry budget (current default: 7
  attempts with exponential backoff). After budget exhaustion, the
  entry is moved to `mobile_offline_queue_dlq` automatically — NOT
  dropped.
- `enqueueWrite` checks queue depth before adding; if > 100 entries
  the app shows a banner asking the user to connect. Already shipped
  as `apps/workforce-mobile/src/offline/queue-full-banner.tsx`.
- Daily smoke (`scripts/smoke/offline-sync.sh`) inserts 1 entry per
  cohort offline, brings online, confirms drain within 60s.

## Severity

- **P1** during pilot — risk of user perceiving data loss. SLA: ack
  30m, root-cause within 4h. Never close without confirming user's
  data is intact (drained or quarantined).
- **P1** in production too — same SLA.

## Linked Sentry fingerprints

_(Populated by `sentry-to-github.ts` over time. Initial list empty.)_
