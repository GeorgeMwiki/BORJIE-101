# Config Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/config/`
**Public entry:** `packages/config/src/index.ts`
**Tier scope:** platform spine (env + runtime config)

## Purpose

Centralized environment loading, validation, and Redis client
factory. One file (`schemas.ts`) declares the Zod schema for every
env var the platform accepts (DB, Redis, JWT, M-Pesa, Stripe,
Flutterwave, AWS, OpenAI/Anthropic/DeepSeek, Africa's Talking,
Firebase, Sentry, OTel, PII posture). Boot failures here surface as
clear schema errors instead of mysterious `undefined` later.

## Entry points

- `src/index.ts` — barrel.
- `src/schemas.ts` — `envSchema`, `loadEnv()`, type `Env`.
- `src/redis-client.ts` — singleton ioredis factory with Sentinel
  + cluster support.
- `src/constants.ts` — well-known timeouts, retry budgets, magic
  numbers.

## Internal structure

- `schemas.ts` — Zod-validated env (~80 keys).
- `redis-client.ts` — connection factory, retry policy, Sentinel
  failover.
- `constants.ts` — KPI thresholds + system constants.
- `*.test.ts` — schema + redis tests.

## Dependencies

- Upstream: zod, ioredis.
- Downstream: every service that needs env vars or Redis.

## Common workflows

- **Read env safely** → `import { loadEnv } from '@borjie/config'`.
- **Get a Redis client** → `import { getRedisClient } from '@borjie/config'`.
- **Add a new env var** → declare key + Zod type in `schemas.ts`,
  update `.env.example`, document in `Docs/ENV.md`.

## Anti-patterns to avoid

- Never use raw `process.env.X` outside this package.
- Never log secrets — Pino redaction is keyed on these names.
- Never hardcode JWT keys / API keys — they go through env schema.
- Never call `loadEnv()` repeatedly — cache the result.

## Related codemaps

- [api-gateway.md](./api-gateway.md) — first caller of `loadEnv`
- [observability.md](./observability.md) — Pino redaction list
- [database.md](./database.md) — `DATABASE_URL` consumer
