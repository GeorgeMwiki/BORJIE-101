# Borjie — Deployment Guide

Operational handbook for shipping every Borjie surface to its production
provider. Each section lists prerequisites, a one-command deploy recipe, the
required environment variables, a rollback recipe, and a smoke-test recipe.

Provider matrix:

| Surface           | Provider | Config file(s)                                    |
| ----------------- | -------- | ------------------------------------------------- |
| admin-web         | Vercel   | `apps/admin-web/vercel.json`                      |
| owner-web         | Vercel   | `apps/owner-web/vercel.json`                      |
| api-gateway       | Fly.io   | `services/api-gateway/fly.toml`, `Dockerfile`     |
| workforce-mobile  | EAS      | `apps/workforce-mobile/eas.json`                  |
| buyer-mobile      | EAS      | `apps/buyer-mobile/eas.json`                      |

CI source of truth:

- `.github/workflows/borjie-ci.yml` — typecheck, build, test on every push/PR
  to `main`.
- `.github/workflows/borjie-db-migrations-check.yml` — applies the Borjie
  mining migrations against a fresh Postgres container built from
  `docker/postgres/Dockerfile`.

All other workflows under `.github/workflows/` are inherited from BossNyumba
and tagged `TODO(borjie): audit/prune` until reviewed.

---

## 1. admin-web (Vercel)

Next.js 15 console at `apps/admin-web`. Deployed by Vercel via the
monorepo-aware build defined in `apps/admin-web/vercel.json`.

### Prerequisites

- Vercel project linked to this repo with **Root Directory** =
  `apps/admin-web` (matches `rootDirectory` in `vercel.json`).
- Production branch set to `main`.
- pnpm version override set to `8.15.0` in Vercel project settings
  (Settings -> General -> Node.js / pnpm).

### One-command deploy

```bash
# From repo root, deploy current local working tree to production.
vercel deploy --cwd apps/admin-web --prod --yes
```

A `git push` to `main` triggers an equivalent deploy automatically via the
Vercel GitHub integration.

### Required env vars

| Variable                          | Scope                | Notes                                                          |
| --------------------------------- | -------------------- | -------------------------------------------------------------- |
| `NEXT_PUBLIC_API_GATEWAY_URL`     | Production / Preview | Public base URL of api-gateway (e.g. `https://api.borjie.example`). |
| `NEXT_PUBLIC_USE_LIVE_API`        | Production / Preview | `true` to disable stubs.                                       |
| `NEXT_PUBLIC_TENANT_CURRENCY`     | All                  | Defaults to `TZS`.                                             |
| `NEXT_PUBLIC_TENANT_LOCALE`       | All                  | Defaults to `sw-TZ`.                                           |
| `NEXT_PUBLIC_TENANT_COUNTRY`      | All                  | Defaults to `TZ`.                                              |
| `NEXT_PUBLIC_LIVEBLOCKS_PUBLIC_KEY` | All                | Required by realtime-rooms in the admin console.               |
| `SENTRY_DSN`                      | Production           | Optional but recommended.                                      |
| `VERCEL_GIT_COMMIT_SHA`           | Provided by Vercel   | Read by build telemetry.                                       |

Set these via the Vercel dashboard (Project -> Settings -> Environment
Variables) or `vercel env add <NAME> production`. Never commit values; see
the [Secrets management](#7-secrets-management) section below.

### Rollback recipe

```bash
# List the last 10 deployments and pick the SHA / deployment URL to restore.
vercel deployments ls borjie-admin-web --scope <team>

# Promote the previous deployment to production:
vercel rollback <deployment-url> --scope <team> --yes
```

### Smoke test recipe

```bash
BASE=https://admin.borjie.example
curl -fsS "$BASE/api/health" | jq .            # next-route health probe
curl -fsS -I "$BASE/" | grep -i strict-transport-security
curl -fsS "$BASE/login" | grep -q "Sign in"    # SSR HTML reaches client
```

---

## 2. owner-web (Vercel)

Next.js 15 owner portal at `apps/owner-web`. Same shape as admin-web; only the
filter / branding / route trees differ.

### Prerequisites

Same as admin-web, with **Root Directory** = `apps/owner-web` in the Vercel
project.

### One-command deploy

```bash
vercel deploy --cwd apps/owner-web --prod --yes
```

### Required env vars

Identical to admin-web (table above), plus:

| Variable                       | Scope               | Notes                                  |
| ------------------------------ | ------------------- | -------------------------------------- |
| `NEXT_PUBLIC_OWNER_FEATURE_FLAGS` | Production / Preview | Comma-separated list of flag keys.  |

### Rollback / smoke test

Same commands as admin-web, substituting the project name
(`borjie-owner-web`) and base URL (`https://owner.borjie.example`).

---

## 3. api-gateway (Fly.io)

Fastify gateway at `services/api-gateway`. Built with `services/api-gateway/Dockerfile`
(multi-stage, Node 20, pnpm 8) and shipped by `fly.toml`.

### Prerequisites

- `flyctl` 0.3.0+ authenticated against the Borjie organisation
  (`fly auth login`).
- Fly app exists (one-time): `fly apps create borjie-api-gateway --org borjie`.
- Fly Postgres cluster exists and is attached:

  ```bash
  fly pg create  --name borjie-pg --region jnb --vm-size shared-cpu-1x --volume-size 10
  fly pg attach  --app borjie-api-gateway borjie-pg
  ```

  This sets `DATABASE_URL` automatically on the api-gateway app.

- Volume for ephemeral data (one-time):

  ```bash
  fly volumes create borjie_api_gateway_data --region jnb --size 1 --app borjie-api-gateway
  ```

### One-command deploy

```bash
# Always run from the monorepo root so the build context contains pnpm-lock.yaml.
fly deploy \
  --config services/api-gateway/fly.toml \
  --dockerfile services/api-gateway/Dockerfile \
  --remote-only
```

### Required env vars / secrets

| Variable                  | Provider | Notes                                                |
| ------------------------- | -------- | ---------------------------------------------------- |
| `DATABASE_URL`            | Fly secret | Set by `fly pg attach`. Do not override manually.  |
| `JWT_SECRET`              | Fly secret | 32+ chars, generated via `openssl rand -base64 48`. |
| `ANTHROPIC_API_KEY`       | Fly secret | Required by AI surfaces.                            |
| `OPENAI_API_KEY`          | Fly secret | Optional fallback model.                            |
| `LIVEBLOCKS_SECRET_KEY`   | Fly secret | Server-side realtime rooms.                         |
| `API_KEY_REGISTRY`        | Fly secret | Comma-separated allowlist of inbound API keys.      |
| `TANZANIA_PAYMENT_BACKEND`| Fly env    | `clickpesa` / `azampay` / `selcom` / `gepg-direct`. |
| `OCR_PROVIDER`            | Fly env    | `mock` for staging, real provider in production.    |
| `LOG_LEVEL`               | Fly env    | `info` default; `debug` for triage.                 |
| `NODE_ENV`                | Fly env    | Hard-coded to `production` in `fly.toml`.           |

Set secrets with:

```bash
fly secrets set --app borjie-api-gateway \
  JWT_SECRET="$(openssl rand -base64 48)" \
  ANTHROPIC_API_KEY=PLACEHOLDER \
  LIVEBLOCKS_SECRET_KEY=PLACEHOLDER \
  API_KEY_REGISTRY=PLACEHOLDER
```

### Rollback recipe

```bash
fly releases --app borjie-api-gateway                              # find the prior release version
fly deploy --image registry.fly.io/borjie-api-gateway:deployment-<sha> \
           --config services/api-gateway/fly.toml \
           --strategy immediate
# OR, faster, via the built-in rollback shortcut:
fly releases rollback <version-number> --app borjie-api-gateway
```

### Smoke test recipe

```bash
fly status --app borjie-api-gateway              # all machines must be "passing"
curl -fsS https://borjie-api-gateway.fly.dev/health
curl -fsS https://borjie-api-gateway.fly.dev/api/v1/meta/version
fly logs   --app borjie-api-gateway              # tail until "ready on :3001"
```

---

## 4. workforce-mobile (EAS)

Expo Router app at `apps/workforce-mobile`. Build/submit driven by
`apps/workforce-mobile/eas.json`.

### Prerequisites

- `eas-cli` 12.0.0+ logged in (`eas login`).
- Expo project linked: `eas init` (one-time) inside
  `apps/workforce-mobile/`.
- Apple Developer + Google Play accounts with credentials uploaded
  (`eas credentials`).
- Required Expo config plugins are already declared in `app.json`:
  - `expo-camera`
  - `expo-location`
  - `expo-image-picker`
  - `expo-local-authentication`
  - `expo-secure-store` (referenced indirectly via Async Storage; document
    add if/when secure-store is added)
  - `expo-av`

### One-command deploy

```bash
# Development (internal distribution, dev-client)
eas build --profile development --platform all --non-interactive

# Internal preview (signed APK + Ad-Hoc IPA, distributable via link)
eas build --profile preview     --platform all --non-interactive

# Production (App Store / Play Store builds, version auto-incremented)
eas build --profile production  --platform all --non-interactive

# Submit the latest production builds to the stores
eas submit --profile production --platform all --non-interactive
```

### Required env vars / EAS secrets

Variables prefixed `EXPO_PUBLIC_` are baked into the JS bundle; everything
else is per-profile in `eas.json` or stored in EAS secrets.

| Variable                          | Source        | Notes                                              |
| --------------------------------- | ------------- | -------------------------------------------------- |
| `EXPO_PUBLIC_API_GATEWAY_URL`     | `eas.json`    | Differs per profile (dev / preview / production).  |
| `EXPO_PUBLIC_USE_LIVE_API`        | `eas.json`    | `false` in development, `true` elsewhere.          |
| `EXPO_PUBLIC_ENV`                 | `eas.json`    | `development` / `staging` / `production`.          |
| `EXPO_PUBLIC_APP_VARIANT`         | `eas.json`    | Hard-coded to `workforce`.                         |
| `EXPO_PUBLIC_SENTRY_DSN`          | EAS secret    | Optional but recommended.                          |
| `SENTRY_AUTH_TOKEN`               | EAS secret    | Required for sourcemap upload during build.        |
| `GOOGLE_SERVICES_JSON_BASE64`     | EAS secret    | Used by EAS for Android FCM/analytics if enabled.  |
| `APPLE_TEAM_ID`                   | EAS credential| Stored in EAS credentials, not raw env.            |

Manage secrets via:

```bash
eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value PLACEHOLDER
eas secret:list   --scope project
```

### Rollback recipe

For OTA-eligible JS changes, publish a previous bundle via EAS Update:

```bash
eas update:list --branch production
eas update:republish --group <previous-update-group-id> --branch production
```

For binary rollbacks (native code), promote the previous version in App
Store Connect / Play Console — these stores keep the previous build
available and a rollback is a re-submit of the prior `.ipa` / `.aab`.

### Smoke test recipe

```bash
# 1. Install the build on a clean test device via the Expo dashboard share URL.
# 2. Verify the splash screen loads, the login screen renders.
# 3. Sign in with a known seeded workforce user.
# 4. Confirm a camera capture round-trips: photo -> upload -> visible on
#    admin-web inspection screen.
# 5. Tail api-gateway logs: requests should arrive with the expected
#    `x-borjie-app: workforce` header.
```

---

## 5. buyer-mobile (EAS)

Same shape as workforce-mobile. Build/submit driven by
`apps/buyer-mobile/eas.json`.

### One-command deploy

```bash
eas build --profile development --platform all --non-interactive --working-directory apps/buyer-mobile
eas build --profile preview     --platform all --non-interactive --working-directory apps/buyer-mobile
eas build --profile production  --platform all --non-interactive --working-directory apps/buyer-mobile
eas submit --profile production --platform all --non-interactive --working-directory apps/buyer-mobile
```

### Required env vars

Identical schema to workforce-mobile (table above), with
`EXPO_PUBLIC_APP_VARIANT=buyer` instead of `workforce`.

### Rollback / smoke test

Same recipes as workforce-mobile, substituting buyer-flavoured smoke checks
(catalog browse, quote request, payment intent creation).

---

## 6. Continuous integration

### borjie-ci

`.github/workflows/borjie-ci.yml` runs on every push and PR to `main`:

1. Setup pnpm 8.15.0 + Node.js 20.
2. `pnpm install --frozen-lockfile`.
3. `pnpm -r typecheck` (best-effort; fails only if the TS error count is
   greater than `TYPECHECK_ERROR_BUDGET` = 50).
4. `pnpm -F @borjie/database build` (must pass).
5. `pnpm -F @borjie/ai-copilot test` (must pass).
6. `pnpm -F @borjie/api-gateway typecheck` (must pass; strict).
7. Uploads `.ci-logs/typecheck.log` as a workflow artifact for triage.
8. Cancels after 15 minutes.

### borjie-db-migrations-check

`.github/workflows/borjie-db-migrations-check.yml` builds the project's
custom Postgres image (`docker/postgres/Dockerfile`, pgvector + PostGIS),
boots it as a side container, and runs
`scripts/apply-borjie-mining-migration.mjs`. Triggered on any change under
`packages/database/drizzle/`, the applier script, or the postgres
Dockerfile.

---

## 7. Secrets management

| Provider | Tool / dashboard                                | Recipe                                                                 |
| -------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| Vercel   | Project -> Settings -> Environment Variables    | `vercel env add NEXT_PUBLIC_API_GATEWAY_URL production`                |
| Fly.io   | `fly secrets` per app                           | `fly secrets set JWT_SECRET=$(openssl rand -base64 48) --app borjie-api-gateway` |
| EAS      | `eas secret` per project / `eas credentials`    | `eas secret:create --scope project --name SENTRY_AUTH_TOKEN --value PLACEHOLDER` |
| GitHub   | Repo -> Settings -> Secrets and variables       | Used only by the inherited workflows; new Borjie CI does not require any. |

Rules of the road:

- Never commit raw secret values to the repo; use the placeholders
  documented above.
- Rotate `JWT_SECRET` and any leaked API keys via the relevant `secrets
  set` recipe — no code change is needed.
- For local dev, copy `.env.example` to `.env` and populate per the
  inherited local-dev runbook (`CONTRIBUTING.md`).

---

## 8. Post-deploy smoke test (cross-surface)

Run after every production deploy of api-gateway, since the web/mobile
surfaces talk to it:

```bash
API=https://api.borjie.example

# Liveness / readiness
curl -fsS "$API/health"
curl -fsS "$API/api/v1/meta/version"

# Authenticated request with a smoke-test API key (from API_KEY_REGISTRY)
curl -fsS -H "x-api-key: $BORJIE_SMOKE_KEY" "$API/api/v1/meta/whoami"

# Vercel surfaces
curl -fsS https://admin.borjie.example/api/health
curl -fsS https://owner.borjie.example/api/health
```

If any of the above returns non-2xx, follow the rollback recipe for the
relevant surface immediately.
