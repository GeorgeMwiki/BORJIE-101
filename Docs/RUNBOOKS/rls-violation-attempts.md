# Runbook: RLSViolationAttempts

| Field            | Value                                                        |
| ---------------- | ------------------------------------------------------------ |
| Alert            | `RLSViolationAttempts`                                       |
| Severity         | page                                                         |
| Team             | sre                                                          |
| Source PromQL    | `sum(increase(rls_cross_tenant_denials_total[1m])) > 0`      |
| Window           | 1m (fire on first occurrence)                                |
| Rules file       | `monitoring/alerts/borjie-rules.yml` (group `borjie.security`) |

## Symptoms

- PagerDuty page: `RLSViolationAttempts`. **Treat as P0 security event
  until proven otherwise.**
- Postgres logs: `policy "<name>" denied access on table "<t>"`.
- Optionally elevated 5xx on the affected route.
- Audit log shows queries with `tenant_id` mismatch between session context
  and row being touched.

## Suspect causes

- Application bug leaking tenant context across requests (most common —
  module-level variable, async-local storage misuse).
- A new internal admin endpoint missing the `SET app.tenant_id` step.
- Compromised credentials: an attacker is enumerating tenants via a
  legitimate user account.
- Background job (cron, queue consumer) using wrong tenant scope.
- Recent migration changed a policy expression incorrectly.

## Diagnostics

```sh
# 1. Count + by-user/route breakdown.
curl -s "$PROM_URL/api/v1/query" --data-urlencode \
  'query=sum by (route, user_id) (increase(rls_cross_tenant_denials_total[15m]))'

# 2. Inspect denied queries from Postgres logs.
kubectl -n borjie logs deploy/pgbouncer --since=15m \
  | rg 'policy.*denied' | head -50

# 3. Audit-log query (canonical source).
psql "$DATABASE_URL" -c "
  SELECT actor_id, tenant_id_session, tenant_id_row, route, ts
  FROM audit_log
  WHERE event = 'rls.denied' AND ts > now() - interval '15 minutes'
  ORDER BY ts DESC LIMIT 50;
"

# 4. Is the actor a real user or a service account?
psql "$DATABASE_URL" -c "
  SELECT id, email, role, last_login_at, ip_last_login
  FROM users WHERE id IN (<actor_ids>);
"

# 5. Recent code/migration changes.
git -C "/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Cursor Projects/BORJIE101" log --since='24 hours ago' -- packages/db/ services/
```

## Immediate mitigation

1. **Always**: open `#incident-<id>` and tag security@borjie.com.
2. If the actor is a single user account and the access pattern looks like
   enumeration, suspend the account:
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/users/<id>/suspend" \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -d '{"reason":"suspected credential abuse"}'
   ```
3. If a route is the leaker, take it offline at the gateway:
   ```sh
   curl -X POST "$PROD_URL/api/v1/admin/routes/<path>/disable" \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```
4. If a recent deploy correlates, roll back immediately:
   ```sh
   kubectl -n borjie rollout undo deployment/<service>
   ```

## Permanent fix

- Audit the offending request path for missing `withTenantContext()` wrapper.
- Add an integration test that asserts cross-tenant SELECT returns zero rows
  for every new query in the offending package.
- Run `scripts/audit-rls-coverage.mjs` against the diff before re-deploy.
- Notify Data Protection Officer (DPO) — KE/TZ data-protection laws may
  require a 72h notification if any cross-tenant read actually succeeded.
- Rotate any user-session secrets if credential abuse confirmed.

## Escalation contact

1. SRE on-call (`sre-primary`).
2. Security lead (`security@borjie.com`) — **always page**, no matter how
   small the count.
3. DPO if cross-tenant *reads* succeeded (denials are fine, leaks are not).
4. CTO if criminal abuse confirmed.
