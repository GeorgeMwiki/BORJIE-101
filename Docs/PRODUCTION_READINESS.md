# BORJIE Production Readiness

This document tracks production readiness and deployment requirements for the BORJIE platform.

## Pre-deployment checklist

### Build & quality
- [x] Monorepo build passes: `pnpm build`
- [ ] TypeScript check passes: `pnpm typecheck`
- [ ] Lint passes: `pnpm lint`
- [ ] Tests pass: `pnpm test`
- [ ] E2E tests (optional for first release): `pnpm test:e2e` with target URLs configured

### Environment
- [ ] `.env` created from `.env.example` and all **REQUIRED** variables set
- [ ] `DATABASE_URL` points to production PostgreSQL (or Supabase)
- [ ] `REDIS_URL` set for caching/queues (required in production)
- [ ] `JWT_SECRET` / `JWT_REFRESH_SECRET` set (use `make gen-secret` or strong random values)
- [ ] `NEXT_PUBLIC_API_URL` and `API_URL` / `FRONTEND_URL` set for production domains
- [ ] No default or placeholder secrets in production

### Database
- [ ] Migrations applied: `make db-migrate` or `pnpm --filter @borjie/database run db:migrate`
- [ ] Seed (if needed): `make db-seed` only in non-production or with guarded scripts

### Infrastructure
- [ ] Docker images build: `make docker-build` or equivalent
- [ ] Docker Compose (or K8s) runs API gateway, apps, Postgres, Redis as per [ARCHITECTURE.md](./ARCHITECTURE.md)
- [ ] Terraform/K8s applied for target environment (staging/production) per README

### Security
- [ ] API keys and secrets from env or secret manager (no hardcoded credentials)
- [ ] CORS and rate limiting configured for production domains
- [ ] Staff/admin emails and platform admin credentials set via env (e.g. `PLATFORM_ADMIN_EMAILS`, `PLATFORM_ADMIN_PASSWORD`)

### Known production notes (until integrations exist)
- **Payments-ledger**: Tenant resolution uses env defaults (`PLATFORM_FEE_PERCENT`, etc.). Replace with HTTP call to tenant service when available.
- **API Gateway API-key auth**: API keys are validated against `API_KEYS` (comma-separated env). For production at scale, replace with database or secret-manager lookup.

## Quick commands

| Action        | Command |
|---------------|---------|
| Build all     | `pnpm build` |
| Run migrations| `make db-migrate` |
| Seed DB       | `make db-seed` |
| Start stack   | `make docker-up` or `pnpm exec turbo dev` |
| Run tests     | `pnpm test` |

## Documentation

- [README](../README.md) — Quick start, scripts, deployment
- [ARCHITECTURE.md](./ARCHITECTURE.md) — System design, multi-tenant, schema
- [API.md](./API.md) — API reference
- [.env.example](../.env.example) — Full env template with status labels
