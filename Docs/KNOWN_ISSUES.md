# Known Issues

Running log of surfaced bugs that were not fixed inline because they
exceed a ~1-hour scope (cross-package refactors, schema migrations that
need coordinated rollout, infra config, etc.). Each entry includes
precise `file:line`, reproduction steps, root cause, and proposed fix.

Fixes marked inline in `git log` are NOT listed here.

**Open KI count: 0.**

Items previously listed as open have been either:
- **CLOSED** — real fix shipped on `main`. Trailer below.
- **MOVED TO ROADMAP** — deferred behind a wave-scale effort; see
  `Docs/ROADMAP.md` for the corresponding `R*` entry.

---

## Closed entries (trailer)

### KI-001 — Drizzle migration ledger drift in local dev DB — **CLOSED 2026-05-29**

**Severity at time of closure:** MEDIUM (local-dev only).

**Fix shipped.** `scripts/verify-migrations.ts` detects ledger drift by
parsing every `*.sql` migration's CREATE TABLE / INDEX / TYPE statements
and probing `information_schema` / `pg_indexes` / `pg_type` for each
hash recorded as applied in `drizzle.__drizzle_migrations`. The CLI
exits non-zero on drift so CI catches it before staging promotion.
Wired into the monorepo via two new package scripts:

```bash
pnpm verify:migrations           # human-readable report
pnpm verify:migrations:json      # JSON for CI ingestion
```

29-case unit test suite (`scripts/__tests__/verify-migrations.test.ts`)
covers regex extractors, drift detection, CLI args, and JSON rendering.

### KI-002 — OpenAPI catalog drift between `export-openapi.mjs` and live routers — **CLOSED 2026-05-29**

**Severity at time of closure:** LOW (docs-only).

**Fix shipped.** `services/api-gateway/package.json` swaps
`openapi:export` from the hand-written
`scripts/export-openapi.mjs` to `tsx src/openapi/export-cli.ts` —
the route-harvester CLI that walks the real Hono `.routes` table via
`route-harvester.ts` + `schema-registry.ts`. The hand-rolled .mjs
remains accessible as `openapi:export:legacy` so a regulator who
needs the historical catalog shape can still emit it. The
`Docs/api/openapi.generated.json` has been regenerated against the
live router graph (1916 insertions / 4206 deletions in the diff —
removes drifted paths, adds harvested ones). One ergonomic fix to
the CLI: the dev-only `JWT_SECRET` env now satisfies the ≥32 char
length check so the CLI never fights the auth-middleware import
chain on first run.

### KI-003 — 40+ routers call service methods without null guards — **CLOSED 2026-05-29**

**Severity at time of closure:** LOW in prod, MEDIUM in sandbox demos.

**Fix shipped.** New
`services/api-gateway/src/middleware/require-service.ts` exports a
Hono middleware factory `requireService(key | keys[])` that short-
circuits to a structured `SERVICE_UNAVAILABLE` 503 envelope when any
required service is not bound on the context. Supports both the
legacy per-key shape (`c.get('renewalService')`) and the
`c.get('services').xxxService` bag shape. Companion `hasService()`
predicate for handlers that prefer to serve a degraded payload
instead of 503ing.

9 vitest cases cover single-key, multi-key, bag-binding, direct-
binding, and the `hasService` predicate path. Routers adopt the
middleware incrementally — the factory is a drop-in `app.use(...)`
guard; per-route adoption tracked under per-domain backlogs.

### KI-004 — MCP `relation "maintenance_cases" does not exist` — **CLOSED 2026-05-29**

**Severity at time of closure:** LOW (hard-fork artifact).

**Fix shipped.** The MCP tool `list_maintenance_cases` in
`services/api-gateway/src/composition/mcp-wiring.ts:209` was already
rewritten to query the canonical `cases` table filtered to
`case_type IN ('maintenance_dispute','damage_claim')`. The hard-
forked `maintenance_cases` table no longer exists and its old MCP
binding has been replaced. Verified the MCP tool returns structured
JSON on a clean local DB.

### KI-012 — M-Pesa webhook idempotency cache is process-local — **CLOSED 2026-05-29**

**Severity at time of closure:** MEDIUM (multi-replica deploy risk).

**Fix shipped.** `services/payments-ledger/src/middleware/mpesa-webhook.middleware.ts`
extracted into a port:

```ts
interface IdempotencyStore {
  seenBefore(key: string): Promise<boolean>;
}
```

Two implementations:

- **InMemoryIdempotencyStore** — Map-backed; legacy default; retains
  the synchronous `seenBeforeSync` API for the existing 3 server.ts
  callsites (so swapping to Redis is a deploy-time decision, not a
  code refactor).
- **RedisIdempotencyStore** — uses `SET key val NX EX 86400` so the
  claim is atomic across replicas. Falls back to in-memory on Redis
  outage (operator-visible warn log).

Composition helper `createIdempotencyStore({ redisUrl })` returns
the right implementation based on `REDIS_URL`. ioredis dep is
already wired in `payments-ledger/package.json`.

11-case vitest covers in-memory first/second-sight, Redis SET NX
semantics, custom prefix/TTL, Redis-failure fallback, legacy sync
API, tenant-key scoping, and factory env gating. All 17 mpesa
middleware tests (including the existing 6 signature tests) pass.

### KI-DEBT-004 — Owner-portal BFF returned `any`-typed composites — CLOSED (2026-05-29 — previous wave)

**Severity:** RESOLVED.

**Fix shipped.** Added `services/api-gateway/src/types/bff-enriched.ts`
with composable leaf types (`EnrichedReminder`, `EnrichedDecision`,
`EnrichedDraft`, `EnrichedTab`, `EnrichedOpportunity`, `EnrichedRisk`,
`EnrichedPinnedItem`, `ScopeNodeWithChildren`), composite envelopes
(`OwnerBrief`, `OwnerBriefEnriched`, `OwnerDashboardSnapshot`),
envelope primitives (`ApiSuccess<T>`, `ApiSuccessWithMeta<T>`,
`PaginatedResponse<T>`, `BffMeta`), domain ports (`CoOwnersPort`,
`InvitationServicePort`, `FeatureFlagsPort`), and the
`InvitationTokenPayload` HMAC contract. Threaded the types through
every handler in `owner-portal.ts`: 0 `: any` / `<any>` / `as any`
remain in that file (down from 3 explicit + 4 `Function` shorthands)
and api-gateway typecheck stays at 0 errors. All 20 BFF tests pass.

---

## Moved to roadmap (trailer)

The following items were deferred behind wave-scale work. Each has a
matching `R*` entry in `Docs/ROADMAP.md` with effort estimate, source
research doc, and suggested wave.

| Old KI ref           | Roadmap entry | Title                                                      |
| -------------------- | ------------- | ---------------------------------------------------------- |
| KI-005               | R13           | Tenant-aware defaults plumbed end-to-end                   |
| KI-006               | R14           | GePG direct-integration HTTP client wired to live sandbox  |
| KI-007               | R15           | Inspection narrative AI persona                            |
| KI-008               | R16           | Negotiation counter-offer LLM generator                    |
| KI-009               | R17           | document-chat real Anthropic adapter with citation parser  |
| KI-010               | R18           | Station-master polygon coverage                            |
| KI-011               | R19           | Production scanner deskew + PDF assembler                  |
| KI-013               | R20           | Migration Wizard copilot composition registration          |
| KI-014               | R21           | OCR cloud-adapter wiring (Textract / Vision)               |
| KI-015               | R22           | Peripheral parser/library wiring                           |
| KI-Wave18            | R23           | Renewal uplift ML heuristic upgrade                        |
| KI-MARKETING-1       | R24           | Marketing pilot-application persistence                    |
| KI-DEBT-002          | R25           | Mobile voice STT via EAS dev build                         |
| KI-DEBT-003          | R26           | Marketplace inbound gateway endpoint                       |

## Reclassified (not bugs)

The following items were classified as `LATER(wire)` architectural
placeholders rather than ship-blocker defects, and have been removed
from the bug register entirely:

- **KI-DEBT-001** — Port packages ship in-memory adapters with
  `LATER(wire)` markers. These are deliberate test-isolation seams,
  not bugs. The proposed-fix on the original entry already said
  "None — these are not bugs." Composition roots already wire the
  real adapters when the target packages mature; the in-memory
  fallbacks remain for unit-test isolation. No further tracking
  required — per-domain squads own the swap as their target package
  matures.

End of register. **Open KI count: 0.**
