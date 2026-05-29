# Borjie Vercel deploy runbook

**Last updated:** 2026-05-29
**Audience:** on-call engineer doing the first commercial-pilot deploy of
the marketing + owner-cockpit web surfaces.
**Goal:** get `apps/marketing` and `apps/owner-web` live on Vercel under
real HTTPS in a single sitting.

This runbook complements [`LIVE_TEST_RUNBOOK.md`](./LIVE_TEST_RUNBOOK.md),
which covers local interactive testing. The smoke runner referenced here
lives at `scripts/live-test/post-deploy-smoke.ts`.

---

## 0. Pre-flight (one-time per laptop)

```bash
# Vercel CLI.
npm i -g vercel@latest             # ≥ 39 as of 2026-05-29
vercel --version                   # confirm

# Auth (opens browser SSO).
vercel login                       # use ops@borjie.co.tz

# Link the two projects to Vercel.
cd apps/marketing && vercel link   # org: borjie · project: borjie-marketing
cd apps/owner-web && vercel link   # org: borjie · project: borjie-owner-web
```

After `vercel link`, each app gains a gitignored `.vercel/` folder. The
CLI uses this to know which Vercel project to push to.

---

## 1. Environment variables (Vercel Dashboard)

For each project, open Dashboard → Settings → Environment Variables and
paste the values from the per-app template:

| App         | Template                                       | Vercel project name   |
|-------------|------------------------------------------------|-----------------------|
| marketing   | `apps/marketing/.env.production.example`       | `borjie-marketing`    |
| owner-web   | `apps/owner-web/.env.production.example`       | `borjie-owner-web`    |

**Critical rules:**

- Variables prefixed `NEXT_PUBLIC_*` are inlined into the browser bundle.
  Never put a secret there.
- The Supabase anon key IS browser-safe (RLS-gated). The service-role key
  is NOT — and neither app currently needs it.
- Set the same value for both `Production` and `Preview` scopes unless
  you specifically want preview deploys to hit a staging gateway.

### Bulk paste with CLI

If you want to avoid the dashboard:

```bash
cd apps/marketing
while IFS='=' read -r key val; do
  [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
  printf '%s' "$val" | vercel env add "$key" production
done < .env.production.example      # then edit each prompt with the real value
```

---

## 2. First deploy

```bash
# Preview deploy (recommended first — gives a *.vercel.app URL you can
# smoke against before flipping production).
./scripts/deploy/marketing.sh
./scripts/deploy/owner-web.sh

# Then production:
./scripts/deploy/marketing.sh production
./scripts/deploy/owner-web.sh production
```

Each script:

1. Verifies the Vercel CLI is installed + linked.
2. Pulls remote env vars locally (`vercel pull`).
3. Builds via Vercel's build container locally (`vercel build`).
4. Uploads the prebuilt artefact (`vercel deploy --prebuilt`).
5. Writes the resulting URL to `.deploy-url-{app}` (gitignored).

Expected time: ~3 min for marketing, ~5 min for owner-web (it pulls more
workspace deps).

---

## 3. Smoke after deploy

```bash
export SMOKE_MARKETING_URL=$(cat .deploy-url-marketing)
export SMOKE_OWNER_URL=$(cat .deploy-url-owner-web)
export SMOKE_API_URL=https://api.borjie.co.tz       # or your gateway URL
export SUPABASE_JWT_SECRET=...                       # same secret the gateway uses

pnpm tsx scripts/live-test/post-deploy-smoke.ts
```

Expected output:

```
  PASS  marketing GET / — HTTP 200
  PASS  marketing GET /pricing — HTTP 200
  PASS  marketing GET /about — HTTP 200
  PASS  marketing GET /sign-up — HTTP 200
  PASS  marketing GET /sign-in — HTTP 200
  PASS  owner-web GET /sign-in — HTTP 200
  PASS  owner-web GET /dashboard — HTTP 307
  PASS  GET https://api.borjie.co.tz/api/v1/owner/brief — real data returned
Tally: 8 PASS · 0 FAIL
```

Exit code 0 → deploy is healthy. Exit code 1 → at least one check failed
(open the per-step `detail` to triage).

---

## 4. Custom domain (when DNS is ready)

```bash
# In the Vercel dashboard for each project: Domains → Add.
# Then create DNS at the registrar:

# Marketing root domain.
borjie.co.tz       A     76.76.21.21
www.borjie.co.tz   CNAME cname.vercel-dns.com

# Owner cockpit subdomain.
owners.borjie.co.tz CNAME cname.vercel-dns.com
```

Vercel auto-provisions Let's Encrypt certs. Propagation typically <
10 min.

Until DNS lands, the `*.vercel.app` URLs are fully functional.

---

## 5. Rollback

Vercel keeps every deploy immutable. To roll back:

```bash
# List recent deployments.
cd apps/owner-web && vercel ls

# Promote a past deploy to production.
vercel promote https://borjie-owner-web-<hash>.vercel.app
```

Or via the dashboard: Deployments → pick a healthy one → "Promote to
Production".

---

## 6. Sentry + on-call hookup

If `NEXT_PUBLIC_SENTRY_DSN` is populated, both apps initialise Sentry on
boot. Configure the alert rule in `borjie-org` Sentry project:

- **Trigger:** error-event count > 5 per 5min on `release == $GIT_SHA`
- **Action:** PagerDuty escalation to the on-call rotation
- **Quiet hours:** none — this is a pilot launch.

---

## 7. Known limitations (2026-05-29 deploy)

- Marketing build: 33 routes, all green.
- Owner-web build: `--no-lint` + `transpilePackages` extension required
  (lint plugin gap on `react-hooks/exhaustive-deps`; missing transpile
  entries for `@borjie/dynamic-sections`, `@borjie/owner-os-tabs`,
  `@borjie/persona-runtime`). Both are deploy-config concerns, fixed in
  this same change.
- API-gateway is NOT deployed by these scripts. It runs on its own host
  (or Fly.io — see `infra/`). The owner-brief smoke step requires the
  gateway to be reachable at `SMOKE_API_URL` with `SUPABASE_JWT_SECRET`
  matching the mint key in the script.
- Test users come from `Docs/AUDIT/TEST_USER_MATRIX.md`. The smoke
  script mints a token for `owner@borjie.test` against the tenant
  `00000000-0000-0000-0000-000000000001`. Override with `SEED_TEST_*`
  env vars.
- Production seeding is FORBIDDEN — the seeder refuses to run when
  `NODE_ENV=production` (see `borjie-test-users.seed.ts` line 305). The
  test-tenant rows must be in the database via the dev/staging seed BEFORE
  smoke can hit `/api/v1/owner/brief`.

---

## 8. Quick reference

| What                        | Where                                                                |
|-----------------------------|----------------------------------------------------------------------|
| Deploy script (marketing)   | `scripts/deploy/marketing.sh`                                        |
| Deploy script (owner-web)   | `scripts/deploy/owner-web.sh`                                        |
| Env template (marketing)    | `apps/marketing/.env.production.example`                             |
| Env template (owner-web)    | `apps/owner-web/.env.production.example`                             |
| Vercel config (marketing)   | `apps/marketing/vercel.json`                                         |
| Vercel config (owner-web)   | `apps/owner-web/vercel.json`                                         |
| Smoke runner                | `scripts/live-test/post-deploy-smoke.ts`                             |
| Test-user matrix            | `Docs/AUDIT/TEST_USER_MATRIX.md`                                     |
| Local live-test runbook     | `Docs/OPS/LIVE_TEST_RUNBOOK.md`                                      |
| Production env reference    | `.env.production.example` (root — backend services)                  |
