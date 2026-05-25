# Runbook — Rollback a Bad Release

## When to use

The deploy went out, alerts are firing, and you need to revert NOW. Use
this when:

- Error rate >5% on any portal for >2 minutes.
- p95 latency >2s on `api-gateway` for >5 minutes.
- Any 5xx from `payments-ledger` (zero tolerance — money path).
- A migration applied successfully but the new code is reading data
  in a way that breaks tenants.

> **This is a scaffolding runbook.** Verify each command in staging
> before relying on it in production.

## Quick rollback (helm history method)

This is the fastest path if Helm holds the previous release state.

```bash
# 1. Find the last good revision.
helm history borjie -n borjie

# 2. Roll back. If the table shows rev N is bad and N-1 is the last good:
helm rollback borjie <N-1> -n borjie --wait --timeout 5m
```

`helm rollback` re-applies the previous values + chart and waits for
all workloads to become Ready. If it times out, see "Stuck rollback"
below.

## Image-only rollback (faster)

If only the container images regressed (no schema change, no values
change), pin to the previous SHA without changing chart values:

```bash
PREV_SHA=<the SHA before the bad one>
helm upgrade borjie ./k8s/helm/borjie \
  -n borjie \
  --reuse-values \
  --set image.tag=$PREV_SHA \
  --atomic --timeout 5m
```

This is preferred when the bug is clearly in the app code, not the
infrastructure.

## Database migration rollback

**STOP — read this twice.**

If the bad release included a schema migration that wrote to columns
the previous app version doesn't understand, rolling back the image
alone may corrupt data or cause 500s.

1. **Pause writes** — set the kill-switch:
   ```bash
   kubectl -n borjie set env deploy/api-gateway KILL_SWITCH_WRITES=true
   ```
   `api-gateway`'s `kill-switch.ts` middleware will return 503 for
   write paths until reset.

2. **Determine if the migration is forward-compatible**:
   - If yes (only added columns / tables, never removed): leave the
     migration applied, roll back app images only.
   - If no (renamed / dropped columns): you must apply the *reverse*
     migration manually:
     ```bash
     pnpm --filter @borjie/payments-ledger drizzle-kit drop
     # …or write a targeted reverse SQL file.
     ```

3. **Roll back the app**:
   ```bash
   helm rollback borjie <N-1> -n borjie --wait
   ```

4. **Re-enable writes**:
   ```bash
   kubectl -n borjie set env deploy/api-gateway KILL_SWITCH_WRITES-
   ```

## Stuck rollback

If `helm rollback` times out:

```bash
# What's stuck?
kubectl -n borjie get pods | grep -v Running

# Common: StatefulSet pod won't terminate because PVC is busy.
kubectl -n borjie describe pod <name>

# Force-delete the pod (PVC is safe):
kubectl -n borjie delete pod <name> --grace-period=0 --force
```

If a Deployment is stuck in `Progressing` for >10 min:

```bash
# Inspect the ReplicaSet hash that's failing:
kubectl -n borjie describe rs -l app.kubernetes.io/component=<comp>

# Most common: image pull error. Check the new ReplicaSet's events.
kubectl -n borjie get events --sort-by=.lastTimestamp | tail -50
```

## Confirm rollback succeeded

```bash
for host in tenant manager owner admin; do
  curl -fsS --max-time 5 https://$host.borjie.example.com/api/health
done

# Replay a few synthetic transactions through payments-ledger:
kubectl -n borjie exec deploy/api-gateway -- \
  curl -sS http://payments-ledger:4010/__synthetic_check
```

## Post-incident

1. Write an incident note in `Docs/incidents/YYYY-MM-DD-<short-name>.md`.
2. File a GitHub issue with the regression repro.
3. Add a regression test in `e2e/` before the fix lands.

## TODOs before this runbook is real

- [ ] Replace `borjie` namespace with the actual one(s).
- [ ] Confirm the kill-switch env var name matches the implementation
      (currently `KILL_SWITCH_WRITES` — verify in `api-gateway/src`).
- [ ] Add the `__synthetic_check` endpoint to payments-ledger if it
      doesn't exist.
- [ ] Wire on-call rotation contact in the incident note template.
