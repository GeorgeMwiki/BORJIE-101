# Supabase Live-Test Readiness Runbook

> **Phase D11, 2026-05-17** — first-time end-to-end smoke against a live
> Supabase Postgres + Auth project. Mirrors the contract documented in
> `Docs/ARCHITECTURE.md` and the JWT verification path in
> `packages/ai-copilot/src/config/supabase-auth.ts`.

This runbook walks an operator through bringing BORJIE up against a
fresh Supabase project, applying all Drizzle migrations, validating
the JWT auth path end-to-end (customer-app + estate-manager-app login
→ api-gateway acceptance), and exercising the known RLS surface.

---

## 1. Prerequisites

- A Supabase project (free-tier is fine) at https://supabase.com/dashboard.
- `psql` ≥ 14 on the operator workstation (for migration runner sanity
  checks).
- `pnpm`, `node ≥ 20`, repository checked out and `pnpm install` clean.
- Network reach from the operator workstation to
  `<project-ref>.supabase.co` on 443 and 5432.

---

## 2. Required environment variables

Copy `.env.example` → `.env` and fill in the **Supabase block at the
top** plus the cross-cutting auth secrets. The minimum viable set for
a live-test boot is:

| Var | Source | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Settings → API → Project URL | Public, baked into client bundles. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API → anon public key | Public, baked into client bundles. RLS-gated. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API → service_role key | **Server-only**. Bypasses RLS. Never expose to the client. |
| `SUPABASE_JWT_SECRET` | Supabase dashboard → Settings → API → JWT Secret | The HS256 signing key used by Supabase Auth. The api-gateway + Brain verify caller tokens with this. |
| `DATABASE_URL` | Supabase dashboard → Settings → Database → Connection string (URI) | Use the **session pooler** (port 6543) for the migration runner. |
| `JWT_SECRET` | `openssl rand -base64 48` | api-gateway-issued service tokens. Must be ≥ 32 chars in production. |
| `SESSION_HASH_SECRET` | `openssl rand -base64 48` | Audit hash-chain HMAC root. Without this the chain silently degrades to unkeyed SHA-256. |
| `INTERNAL_API_KEY` | `openssl rand -hex 32` | Required for internal tenant-context endpoints. |
| `ALLOWED_ORIGINS` | comma-separated `https://` origins | Production CORS allowlist for the api-gateway. |

Everything else in `.env.example` has a documented graceful fallback
or `[OPTIONAL]` tag.

---

## 3. Applying all 148+ Drizzle migrations

> The current migrations directory ships **148+ numbered SQL files**
> (max counter `0171` after the FORCE RLS / phase-2 + kill-switch /
> tool-flag migrations) covering schema, indices, RLS, and seed data.
> The base RLS policy file added in Phase D is
> `0155_supabase_rls_policies.sql`; FORCE RLS plus phase-2 coverage on
> the remaining tenant-scoped tables (CoT reservoir, sovereign action
> ledger, agency run checkpoints, sensor call log, voice turns, doc
> chat, memory tables) lands in `0146_cot_reservoir_rls.sql` and
> `0156_supabase_rls_phase2.sql`. Re-verify the count before sign-off
> with `ls packages/database/src/migrations/*.sql | wc -l`.

```bash
# 1. Confirm DATABASE_URL points at the Supabase project (uri form,
#    session pooler).
echo $DATABASE_URL | grep -q 'supabase' || { echo "FAIL: DATABASE_URL not supabase"; exit 1; }

# 2. Run the Drizzle migration runner against the project.
pnpm --filter @borjie/database db:migrate

# 3. Verify migration table count matches expected.
psql "$DATABASE_URL" -tAc "select count(*) from drizzle.__drizzle_migrations;"
# Expected: matches `ls packages/database/src/migrations/*.sql | wc -l`
# (148 at time of writing — max counter 0171; recount before sign-off).

# 4. Spot-check that tenant-scoped tables have RLS enabled.
psql "$DATABASE_URL" -tAc "
  select relname from pg_class
  where relkind='r' and relrowsecurity=true
  order by relname
" | head -30
# Expected to include: customers, leases, ledger_entries, invoices,
# maintenance_requests, audit_events, kernel_decision_ledger,
# kernel_cot_reservoir, etc.
```

If the migration runner fails partway through, **DO NOT** re-run
`db:migrate` against the same project. Use the Supabase SQL editor to
look up `drizzle.__drizzle_migrations`, identify the last successful
hash, and replay only the failing migration via `psql`. Drizzle is
idempotent per-hash and will skip already-applied migrations.

---

## 4. End-to-end JWT verification audit

The JWT contract:

1. **Customer-app** + **estate-manager-app** sign in via Supabase Auth
   client (PKCE flow). The browser receives an `access_token` (HS256,
   short-lived) and `refresh_token`.
2. The client attaches `Authorization: Bearer <access_token>` to every
   api-gateway / Brain call.
3. The server verifies the token with `SUPABASE_JWT_SECRET` using
   `jose.jwtVerify(token, encodedSecret, { algorithms: ['HS256'] })`
   — implementation in
   `packages/ai-copilot/src/config/supabase-auth.ts`.
4. The verified principal is projected onto Brain's `AITenantContext` +
   `AIActor` + `VisibilityViewer` shape via `principalToBrainContexts()`
   — same file.
5. The api-gateway middleware caches the verification result per
   token-fingerprint for the token's lifetime to avoid re-verifying on
   every request.

### Smoke-test sequence

```bash
# 1. Confirm the unit test for the verify path passes (no Supabase
#    network required; tests sign their own HS256 tokens with a
#    deterministic SECRET).
pnpm --filter @borjie/ai-copilot vitest run \
  src/__tests__/supabase-auth.test.ts

# 2. Manually create a test user in the Supabase project (dashboard →
#    Authentication → Users → "Add user"). Confirm:
#      - The user's `raw_app_meta_data` includes:
#          { "tenant_id": "demo-tenant", "roles": ["admin"],
#            "environment": "staging" }
#    (Supabase honors `app_metadata` as server-controlled, immutable
#    from the client. `user_metadata` is client-mutable and should
#    NOT be the source of truth for tenant assignment.)

# 3. Sign in from the customer-app dev server:
pnpm --filter @borjie/customer-app dev
# Visit http://localhost:3000/login, sign in as the test user.

# 4. Copy the access_token from devtools → Application → Local
#    Storage → sb-<project-ref>-auth-token. Use it against the
#    api-gateway:
curl -i -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/me
# Expected: 200 OK, body includes the projected principal
# (userId, tenantId='demo-tenant', roles=['admin']).

# 5. Test the estate-manager-app likewise on port 3001.
```

If step 4 returns 401, debug in order:

- `SUPABASE_JWT_SECRET` matches the value in Supabase dashboard?
- Token not expired? (`jose.decodeJwt(token).exp * 1000 > Date.now()`).
- `app_metadata.tenant_id` populated server-side?
- api-gateway is reading `Authorization` header (not a stripped reverse
  proxy in between)?

---

## 5. Open RLS policy gaps (known)

The repository ships RLS policies on the top-25 tenant-scoped tables
in `packages/database/src/migrations/0155_supabase_rls_policies.sql`,
plus FORCE RLS + a further ~13 phase-2 tables in
`0156_supabase_rls_phase2.sql`, plus CoT reservoir isolation in
`0146_cot_reservoir_rls.sql`. The previously-deferred surfaces
listed below are now CLOSED — keep the table as a tombstone for the
audit trail.

| Surface | Status | Closing migration |
|---|---|---|
| `kernel_cot_reservoir` (chain-of-thought scratch) | RLS-ENABLED | `0146_cot_reservoir_rls.sql` |
| `sovereign_action_ledger` (HQ tool execution log) | RLS-ENABLED + FORCE | `0156_supabase_rls_phase2.sql` |
| `agency_run_checkpoints` (workflow resumption state) | RLS-ENABLED + FORCE | `0156_supabase_rls_phase2.sql` |
| `sensor_call_log` (sensor invocation traces) | RLS-ENABLED + FORCE | `0156_supabase_rls_phase2.sql` |
| `voice_turns`, `doc_chat_*`, `kernel_memory_*`, `reflexion_buffer`, `document_embeddings`, `intelligence_history`, `tenant_financial_statements`, `tenant_litigation_history` | RLS-ENABLED + FORCE | `0156_supabase_rls_phase2.sql` |

Both `0155` (25 base tables) and `0156` (13 phase-2 tables) now run
under `FORCE ROW LEVEL SECURITY`, so the table owner (`postgres` /
`service_role`) is also subject to the policy unless explicitly using
the `service_role` bypass route. The defense-in-depth remains: every
authenticated request rebinds the `app.tenant_id` GUC on the pooled
connection before any read, and the canonical `current_app_tenant_id()`
helper used by the RLS predicate reads that exact GUC name.

---

## 6. Post-test cleanup

```bash
# Drop the test user.
# Supabase dashboard → Authentication → Users → "..." → Delete.

# Wipe test data without dropping schemas.
psql "$DATABASE_URL" -c "
  truncate table audit_events, kernel_decision_ledger,
    kernel_cot_reservoir, sovereign_action_ledger
  restart identity cascade;
"
```

---

## 7. Sign-off checklist

- [ ] All migrations applied; `__drizzle_migrations` count matches
      `ls packages/database/src/migrations/*.sql | wc -l` (148 at time
      of writing, max counter 0171).
- [ ] RLS enabled on the top-25 base tables (0155) AND the phase-2
      table set in 0156 (spot-check via `pg_class.relrowsecurity` AND
      `pg_class.relforcerowsecurity`).
- [ ] `supabase-auth.test.ts` passes (`pnpm --filter
      @borjie/ai-copilot vitest run src/__tests__/supabase-auth.test.ts`).
- [ ] Customer-app login → api-gateway `/api/me` returns 200 with
      correct projected principal.
- [ ] Estate-manager-app login → api-gateway `/api/me` returns 200.
- [ ] `pnpm audit` reports zero blocking high+ advisories.
