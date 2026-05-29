# Borjie test-user matrix

**Last updated:** 2026-05-29
**Audience:** auditor + on-call engineer.
**Seeder:** `packages/database/src/seeds/borjie-test-users.seed.ts` (refuses
to run when `NODE_ENV === 'production'`).

The seeder is fully env-driven. Each row below comes from a
`SEED_TEST_*` variable; the seeder calls `requireEnv()` for each, so a
missing var aborts seeding with a clear error. Defaults shown are the
values currently set in `.env` / `.env.local`; rotate per env.

| Email                       | Phone           | Tenant ID     | Mining role    | Lang | Source env var pair                                |
|-----------------------------|-----------------|---------------|----------------|------|----------------------------------------------------|
| `admin@borjie.dev`          | `+255700000001` | `borjie-demo` | `borjie_team`  | en   | `SEED_TEST_BORJIE_ADMIN_EMAIL` / `_PASSWORD`       |
| `owner@borjie.dev`          | `+255700000002` | `borjie-demo` | `owner`        | sw   | `SEED_TEST_OWNER_EMAIL` / `_PASSWORD`              |
| `manager@borjie.dev`        | `+255700000003` | `borjie-demo` | `site_manager` | sw   | `SEED_TEST_MANAGER_EMAIL` / `_PASSWORD`            |
| `employee@borjie.dev`       | `+255700000004` | `borjie-demo` | `driver`       | sw   | `SEED_TEST_EMPLOYEE_EMAIL` / `_PASSWORD`           |
| `buyer@borjie.dev`          | `+255700000005` | `borjie-demo` | `buyer`        | en   | `SEED_TEST_BUYER_EMAIL` / `_PASSWORD`              |

## Tenant

| Field    | Value                  | Source env var          |
|----------|------------------------|-------------------------|
| ID       | `borjie-demo`          | `SEED_TEST_TENANT_ID`   |
| Name     | `Mawe Bora Mining Ltd` | `SEED_TEST_TENANT_NAME` |

## Password rotation policy

- **Dev / live-test:** values in `.env` and `.env.local`. Rotate
  whenever the file is shared or a teammate offboards.
- **Production:** NEVER seed. The seeder throws if `NODE_ENV ===
  'production'` (see line 305 of the seeder).
- **CI:** seeder is opt-in via `SEED_TEST_USERS=true`; CI sets
  `false` for the gateway smoke-test pipeline.
- **Storage:** passwords are written ONLY to gitignored env files;
  Supabase Auth hashes them server-side via bcrypt.

## Auth-gating verification

Every protected route in the gateway is mounted behind the
`authMiddleware` exported from
`services/api-gateway/src/middleware/hono-auth.ts`. The middleware:

1. **No token** → returns `401 UNAUTHORIZED` (line 99).
2. **Invalid signature** → JWKS verify throws → 401 (line 117).
3. **Expired token** → jose throws → 401.
4. **Wrong audience / issuer** → JWT verify fails → 401.

The five seeded users have NO superuser privileges in the gateway.
Their JWTs are minted by Supabase Auth (`auth.admin.createUser`) and
embed `app_metadata.tenant_id` + `app_metadata.mining_role`. The gateway
trusts those claims but enforces tenant-scoped RLS via the
`app.current_tenant_id` GUC bound in
`services/api-gateway/src/middleware/tenant-context.middleware.ts`.

### Spot-check matrix

Sample auth-gated endpoints — calling without a `Bearer` token:

| Route                                                       | No-token expected | Mounted at                                          |
|-------------------------------------------------------------|-------------------|-----------------------------------------------------|
| `GET /api/v1/users/me`                                      | 401               | `services/api-gateway/src/routes/users.hono.ts`     |
| `POST /api/v1/maintenance/work-orders`                      | 401               | `services/api-gateway/src/routes/maintenance.hono.ts` |
| `GET /api/v1/notifications/preferences`                     | 401               | `services/api-gateway/src/routes/notification-preferences.router.ts` |
| `POST /api/v1/document-render/preview`                      | 401               | `services/api-gateway/src/routes/document-render.router.ts` |
| `GET /api/v1/gdpr/data-export`                              | 401               | `services/api-gateway/src/routes/gdpr.router.ts`    |

(Bearer-less manual smoke is straightforward — `curl -s -o /dev/null -w
'%{http_code}\n' http://localhost:3001/api/v1/users/me` returns `401`.)

None of the seeded accounts can bypass the middleware; they all flow
through the same `authMiddleware → tenantContextMiddleware → handler`
pipeline that any other user does.
