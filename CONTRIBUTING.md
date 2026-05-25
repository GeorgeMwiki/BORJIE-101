# Contributing to BORJIE

Welcome. This guide covers the day-to-day workflow and the conventions that keep the codebase coherent.

## Ground rules

1. **Spec before code.** Non-trivial features land a doc in `Docs/` (or amend an existing one) before the first PR.
2. **Tenant isolation is absolute.** Every query, event, log line, and metric carries `orgId`. If a function touches data, it accepts `orgId` explicitly — never read it from ambient context.
3. **Ledger immutability.** `services/payments-ledger` writes append-only rows. Never mutate or delete; always post compensating entries.
4. **Deterministic before LLM.** AI personas in `@borjie/ai-copilot` run *after* policy checks pass. Never let an LLM decide whether a deterministic rule applies.
5. **Immutability in code.** Favor spread/return-new over mutation (see `~/.claude/rules/coding-style.md`).

## Local development

```bash
# First time
pnpm install
cp .env.example .env    # fill in required vars

# Infra
docker compose up -d postgres redis
pnpm --filter @borjie/database migrate
pnpm --filter @borjie/database seed --org=trc

# All apps
pnpm dev
```

Dev URLs: admin 3000, owner 3001, customer 3002, estate-manager 3003, api 4000.

## Adding a new feature

1. **Open an issue** describing the user-visible change and the acceptance criteria.
2. **Write or amend the spec** in `Docs/` (or the relevant subdirectory). Link the issue.
3. **Branch** from `main`: `git checkout -b feat/<scope>-<short-name>`.
4. **Write tests first.** 80% coverage floor (see `~/.claude/rules/testing.md`).
   - Unit tests next to the code (`__tests__/` or `*.test.ts`).
   - Integration tests hit a real Postgres in Docker.
   - E2E in `e2e/` for cross-portal journeys.
5. **Implement.** Prefer many small files (<400 lines typical, 800 hard cap).
6. **Lint + typecheck + test** locally before pushing: `pnpm lint && pnpm typecheck && pnpm test`.
7. **Conventional commits**: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `perf:`, `ci:`.
8. **PR** with clear summary, screenshots/recordings for UI changes, and a test plan checklist.

## Coding conventions

### File organization
- Organize by feature/domain, not by type. A feature folder contains its route, service, tests, and types together.
- Extract utilities when a component exceeds 400 lines.

### Types
- Exported types live in `@borjie/domain-models`. Service-internal types stay in the service.
- No `any` in public APIs. Internal `any` gets a `TODO: tighten` comment.
- Validate every boundary with Zod.

### Errors
- Throw with user-friendly messages. Log with context. Never leak PII or secrets.
- Map domain errors to HTTP at the gateway, not inside services.

### Logs + metrics + traces
- Get your logger from `@borjie/observability`. Always pass `orgId`.
- Counters for every external call (payments, notifications, LLM).
- Span names: `<service>.<operation>`, e.g. `payments.mpesa.stk-push`.

### Secrets
- Never hardcode. Read from env via `@borjie/config`.
- Never log secrets. Scrub request headers in middleware.

## How to add a new AI persona

1. Add a persona module under `packages/ai-copilot/src/personas/<persona-name>/`:
   - `prompt.ts` — system prompt + templates (pure strings, no logic).
   - `schema.ts` — Zod input + output shapes.
   - `persona.ts` — exports `run(input)` that validates input, invokes the provider, validates output.
   - `__tests__/persona.test.ts` — snapshot the prompt; mock the provider.
2. Register in `packages/ai-copilot/src/registry.ts` so `BrainRegistry.forTenant(orgId).persona(name)` resolves it.
3. Add an eval case under `packages/ai-copilot/evals/<persona-name>/`.
4. Callsite in a domain service runs deterministic policy first, then invokes the persona. Log latency + token count via `@borjie/observability`.
5. Document the persona in `Docs/ARCHITECTURE_BRAIN.md`.

## How to add a new Postgres repo

1. **Schema**: add or extend a file in `packages/database/src/schemas/<entity>.schema.ts` using Drizzle. Export the table.
2. **Migration**: create `packages/database/src/migrations/<next-nnnn>_<name>.sql`. Migrations are immutable once merged.
3. **Repository**: add `packages/database/src/repositories/<entity>-repository.ts` implementing the `Repository<T>` interface (`findAll`, `findById`, `create`, `update`, `delete`). **Every query takes `orgId` and filters on it.**
4. **Wire into `createRepos`**: add to `packages/database/src/repositories/index.ts`.
5. **Tests**: integration test against a fresh Docker Postgres — cover tenant isolation explicitly (querying with the wrong `orgId` must return empty).
6. **Consumers**: update `services/api-gateway` routes and any domain services.

## Pull request checklist

- [ ] Tests green: `pnpm test && pnpm test:e2e`
- [ ] Typecheck green: `pnpm typecheck`
- [ ] Lint green: `pnpm lint`
- [ ] No `console.log` / no `any` in public APIs / no hardcoded secrets
- [ ] `orgId` threaded through every new query/service call
- [ ] Spec/docs updated
- [ ] CHANGELOG entry under `[Unreleased]`
- [ ] Observability: new external calls have counters + spans

## Getting help

- Architecture questions: `Docs/ARCHITECTURE.md`, `Docs/ARCHITECTURE_BRAIN.md`.
- Domain model questions: `Docs/DOMAIN_MODEL.md`.
- Open-item tracking: `Docs/TODO_BACKLOG.md`.
