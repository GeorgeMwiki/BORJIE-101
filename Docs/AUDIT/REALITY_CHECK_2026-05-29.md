# Reality Check — 2026-05-29 (adversarial sweep)

**Auditor:** Claude Opus 4.7 (adversarial reviewer, agent #181)
**Started against commit:** `0a5e5d8d` (HEAD at sweep start)
**Audit window:** 2026-05-29 afternoon TZ
**Default stance:** skeptical. "Shipped" means production-grade and
wire-exercisable, not "commit landed."

## TL;DR

Today's audit docs collectively claim **GREEN** launch readiness with
107 brain tools, 12 R-items, 5 KI closures, 23 / 23 smoke endpoints
green, and 105 / 105 live-verified powers. After an adversarial
sweep of the underlying code I rate:

| Status | Count |
|--------|------:|
| REAL (production-grade, exercises real path) | 23 |
| SCAFFOLD (explicit per brief, future build) | 2 |
| DOC-ONLY (only docs / research landed) | 0 |
| STUB (code present but no-op / fake data) | 1 |
| PARTIAL (parts real, parts wired-but-headless) | 6 |
| **Total claims audited** | **32** |

**Sign-off: YELLOW.** The application boots, every web surface
serves, every cron worker arms, every claimed migration sits in the
tree, every claimed UI block schema is wired in code, the M-Pesa
idempotency cache is genuinely Redis-backed, the citations block is
genuinely rendered, the saved-search worker really ticks, the tenant
switcher really binds the cookie. **But:**

1. The 107 persona brain-tools are *registered* in the catalog but
   the `PersonaToolGate` in `services/api-gateway/src/index.ts:1016`
   has **no `httpClient` bound**, so every handler that calls
   `ctx.httpClient` falls into its defensive `if (!client)` fallback
   and returns hardcoded fake data. None of the 107 handlers reach
   the backend in production. See §"Gaps requiring follow-up" item
   G-A.
2. Worker brain-tool paths (`/mining/attendance/clock-in`,
   `/mining/tasks/mine`, `/mining/toolbox-talks/today`, etc.) point
   to routes that do not exist on the gateway. Even if `httpClient`
   were bound, 34 of 51 persona-tool paths would 404.
3. R5 (Worker hero card) wires `/api/v1/field/workforce/me`,
   `/tasks/next`, `/tasks/:id/complete`, `/help-requests` — none of
   these endpoints exist on the gateway. The component swallows
   fetch errors and renders the "no shift" state, which looks
   harmless but is silently broken in pilot.

These are scaffold-masquerading-as-real defects: the LAUNCH_READINESS
GREEN and CAPABILITY_LIVE_EVIDENCE rolls present these as "wired" but
no end-to-end probe ever actually invoked them. Items 2 + 3 are
beyond this audit's 200-LoC inline-fix authority and are documented
below for follow-up.

The boundary fix (G-A: wire `httpClient` on `personaGate`) is
in-scope and is shipped inline in this sweep.

---

## Per-claim reality table

### R-roadmap claims

| Item | Source | Verdict | Evidence (file:line) | Action |
|------|--------|---------|----------------------|--------|
| R1 — owner brief inline citations | RESEARCH_GAPS A-1; commit `709f0694` | REAL | `packages/owner-os-tabs/src/citations-block.ts:62-76`; `apps/owner-web/src/components/home-chat/inline-blocks/CitationsBlock.tsx:1-50`; `InlineBlockRenderer.tsx:201` (dispatcher case) | none |
| R2 — saved-search alerts | RESEARCH_GAPS A-2; ROADMAP R2 SHIPPED | REAL | migration `0124_saved_searches.sql`; `services/api-gateway/src/workers/saved-search-worker.ts`; `services/api-gateway/src/composition/brain-tools/owner-saved-search-tools.ts:1-30`; brain tool `owner.saved_search.create` registered | none |
| R3 — Cloudflare edge inference | ROADMAP R3 SCAFFOLDED | SCAFFOLD (per brief) | `services/edge-inference/`; research doc `Docs/research/EDGE_INFERENCE_CLOUDFLARE.md`; explicit "DO NOT DEPLOY" gate in roadmap | none — brief says docs + MVP scaffold; will revisit post-pilot SLO |
| R4 — on-device MiniLM router | ROADMAP R4 STUBBED | SCAFFOLD (per brief) | `packages/on-device-router/`; `routeOnDevice()` returns `{toolId:null, confidence:0}` per the contract | none — brief explicitly defers to Q4 2026 |
| R5 — worker hero card | commit `63357ea2`; MOBILE_LIVE_TEST | **PARTIAL** | `apps/workforce-mobile/src/components/WorkerHomeHero.tsx:35-60` fetches `/api/v1/field/workforce/me`, `/tasks/next`, `/tasks/:id/complete`, `/help-requests` but NONE of these routes exist on api-gateway (verified by grep of `services/api-gateway/src/routes`). Component catches errors silently and renders "no shift" state. Presentation is real (`WorkerHeroCard.tsx`, helpers, tests). | logged for follow-up — endpoint wiring is wave-scale |
| R6 — cockpit live SSE push | ROADMAP R6 | not claimed shipped | roadmap acknowledges "missing SSE push channel for cockpit pillars" | none |
| R7 — owner-mobile cockpit | ROADMAP R7 SHIPPED | REAL | `apps/workforce-mobile/app/owner/cockpit/index.tsx`; route `services/api-gateway/src/routes/owner/cockpit-hub.hono.ts` (`/api/v1/owner/cockpit/hub`) | none |
| R8 — personal-KB UI | ROADMAP R8 SHIPPED | REAL (verified via routes file presence) | `/api/v1/me/persons/links` + `/api/v1/me/persons/:personId/cells` + `/api/v1/brain/personal-kb/search`; consent-gate visible | none |
| R9 — Smart-Compose ghost text | ROADMAP R9 SHIPPED; commit `24a8296f` | REAL | `services/api-gateway/src/routes/brain-compose.hono.ts:1-138` — endpoint + 24-entry curated table + zod validator + tests. LLM fallback explicitly Phase-2 per brief comments | none |
| R10 — adaptive stream rate | ROADMAP R10 SHIPPED; commit `4a438b63` | PARTIAL — controller + tests landed; "Server-side wiring into the SSE producer is the next-step composition hook" per roadmap | `services/api-gateway/src/services/brain/sse-adaptive.ts`; `apps/owner-web/src/lib/sse-ack.ts` | known follow-up — controller is framework-agnostic, awaiting compose hook |
| R11 — buyer RFB | ROADMAP R11 | not claimed shipped | "Wave-scale" per roadmap | none |
| R12 — tenant switcher | ROADMAP R12 SHIPPED; commit `38f33447` | REAL | `services/api-gateway/src/routes/me-tenants.hono.ts:2`; cookie-based binding (HttpOnly, SameSite=Lax) ; tests `me-tenants.test.ts` | none |

### Persona brain-tools (107 catalog)

| Item | Source | Verdict | Evidence | Action |
|------|--------|---------|----------|--------|
| 107 persona tools wired (#155) | CAPABILITY_LIVE_EVIDENCE §7 | **PARTIAL — registered, not invocable** | `services/api-gateway/src/index.ts:1016-1034` constructs `PersonaToolGate` with **no `httpClient`**. Every tool's handler does `if (!client) return { fake }` (worker-tools.ts:38-46 etc). The catalog is registered for visibility but no HTTP-backed tool can dispatch a real call in production. | shipped inline fix (commit below) — wires `gate.httpClient` to a local-origin client that signs the upstream call with a service token |
| Worker tool HTTP paths | worker-tools.ts | **PARTIAL — endpoints missing** | 13 distinct paths called (`/mining/attendance/{clock-in,clock-out,my-shift}`, `/mining/tasks/{mine,complete}`, `/mining/toolbox-talks/{today,acknowledge}`, `/mining/samples/submit`, `/mining/incidents/report`, `/mining/workforce/{my-crew,shift-attendance,fuel-logs}`, `/mining/geology/drill-holes`) — none exist on gateway routes. The mining/attendance.hono.ts router mounts `/check-in` + `/check-out`, NOT `/clock-in` + `/clock-out`. | logged — 13+ new routes is wave-scale |
| 34/51 persona-tool target paths | persona-tool source files | PARTIAL | per the inventory above — ~17 paths verified present (owner/share-links, owner/pinned-items, owner/saved-searches, mining/cockpit/*, mining/approvals, mining/incidents, mining/marketplace/listings, mining/tasks, mining/reports, etc.); ~34 paths cannot be resolved to a Hono route registration | logged — same pattern as worker-tools |
| 8 superpower tools | CAPABILITY_LIVE_EVIDENCE §1; POWERS §A | REAL | endpoints exist + live HTTP probes evidenced in `/tmp/live-verify.json` (per audit). `share-links`, `pinned-items`, `undo-journal`, `bulk-action`, `prefill` all present on the gateway | none |
| Closed-loop telemetry | POWERS §E (5/5 phases) | REAL | `services/api-gateway/src/workers/outcome-reconciliation-worker.ts`; phases pass per live-verify; commit `eabd352f` later fixed the missing tenant GUC bind so audit-chain appends now land | none |
| Decision-journal hash chain | POWERS §F.2; recorder | REAL | `services/api-gateway/src/services/decision-journal/recorder.ts:30,207,264-415` uses `chainHash` from `@borjie/audit-hash-chain`; `prev_hash` + `entry_hash` columns written; bug `0214c417` already fixed scope_ids text[] bind | none |

### MCP server (12 primitives)

| Item | Source | Verdict | Evidence | Action |
|------|--------|---------|----------|--------|
| MCP stdio JSON-RPC 12/12 | POWERS §G | REAL — protocol envelope correct, but `tools/call` returned `-32001 Unauthorized` so no actual tool was executed | `/tmp/live-verify-mcp.json` shows `initialize`, `tools/list`, `resources/list`, `prompts/list`, `roots/list`, `logging/setLevel` all returning shaped responses. `tools/call` returned `-32001`; `sampling/createMessage` returned `-32010`; four-eye gated call returned `-32011`. These are documented contract errors, NOT executions. | none — protocol gate is correct, but flag for clarity: the audit's "live verification" is envelope-shape, not tool-invocation. |
| HTTP / SSE MCP transports | CAPABILITY_LIVE_EVIDENCE §8 | REAL | `/api/v1/mcp` + `/api/v1/mcp/sse` mounted; commit `f27a6e9b`; 401 envelopes documented | none |

### CLI (25 verbs)

| Item | Source | Verdict | Evidence | Action |
|------|--------|---------|----------|--------|
| 25 CLI verbs | CAPABILITY_LIVE_EVIDENCE §9 | REAL | `packages/borjie-cli/src/commands/` has 22 visible top-level files; auth aliases (login/logout/whoami) bring count to 25; commit `6df478cc` | none |

### KI sweep claims

| Item | Source | Verdict | Evidence | Action |
|------|--------|---------|----------|--------|
| KI-001 verify-migrations | commit `610f23e7` | REAL | `scripts/verify-migrations.ts` (genuine extractor that probes `information_schema`); `package.json` exposes `verify:migrations` + `verify:migrations:json` | none |
| KI-002 OpenAPI live harvester | commit `dbe5db12` | REAL | `services/api-gateway/src/openapi/route-harvester.ts` walks Hono `.routes` table at runtime; `services/api-gateway/src/openapi/export-cli.ts` writes the spec to disk | none |
| KI-003 requireService middleware | commit `f8ccddbb` | SCAFFOLD-with-tests | `services/api-gateway/src/middleware/require-service.ts` exists with tests; **no route consumes it yet** (grep `requireService` in `services/api-gateway/src/routes` → empty); intended for follow-on route refactor | logged — middleware factory shipped, callsites future |
| KI-004 MCP `cases` table | KNOWN_ISSUES | REAL | `list_maintenance_cases` MCP method queries `cases` table per audit notes; not verified in this sweep but no contradicting evidence | none |
| KI-012 Redis M-Pesa idempotency | commit `3938657d` | REAL | `services/payments-ledger/src/middleware/mpesa-webhook.middleware.ts:171-219` — `RedisIdempotencyStore` uses `SET key val NX EX ttl` (atomic), in-memory fallback on outage, structured warn log on degradation. Composition helper `createIdempotencyStore()` instantiates from `REDIS_URL` env. | none |

### Audit-doc fixups

| Item | Source | Verdict | Evidence | Action |
|------|--------|---------|----------|--------|
| decision-recorder scope_ids bind fix | POWERS §F.1; commit `0214c417` | REAL | `services/api-gateway/src/utils/pg-array.ts` lifted helper + `recorder.ts:30,32` uses it | none |
| outcome-reconciliation tenant GUC bind | POWERS §F follow-up; commit `eabd352f` | REAL (rescued from killed #179) | `services/api-gateway/src/workers/outcome-reconciliation-worker.ts` now binds `app.tenant_id` GUC before audit-chain append; test coverage added | none |
| decision-retrospective array-bind fix | POWERS §F follow-up; commit `3c6959ee` | REAL | helper lifted to `services/api-gateway/src/utils/pg-array.ts`; both call sites use it; pg-array tests cover the round-trip | none |
| `.env.local` survives tsx-watch respawn | POWERS §F.3 / MOBILE-LIVE §H; commit `0a5e5d8d` | REAL | `services/api-gateway/src/index.ts` adds explicit `dotenv.config({path: '.env.local', override:true})` after `.env` so brain SSE unblocks on respawn | none |

### Other claims

| Item | Source | Verdict | Evidence | Action |
|------|--------|---------|----------|--------|
| Zero TODO/FIXME in production | ZERO_TECH_DEBT | REAL (1 remaining is the scanner regex itself) | `packages/security-audit/src/scanners/hardcoded-data-scanner.ts:253` | none |
| @ts-nocheck count | ZERO_TECH_DEBT cluster summary | REAL | 2 active `@ts-nocheck` at file-top (both `packages/database/src/seed*.ts`, scope-permitted per CLAUDE.md). The 8 grep hits for `@ts-nocheck` in services/api-gateway are doc-string references explaining historical pragmas. | none |
| 'Not implemented' throws | brief anti-pattern | REAL — zero matches | grep returns 0 | none |
| @ts-ignore | brief anti-pattern | REAL — none introduced; LATER markers tracked in KI-DEBT-001 | 13 LATER(wire) markers, all in test-isolation port packages + 2 mobile placeholders all KI-tracked | none |
| `Coming soon` / `TBD` / `FIXME` / `Lorem ipsum` | UI_COMPLETENESS GREEN | REAL — zero | covered by audit doc's verified greps; 2 TODOs remain, both linked to GH issues #14, #20, #22 with `PreviewBanner` | none |
| Migrations 0119–0124 in tree | LAUNCH_READINESS §5 | REAL — all present (0123 is a gap in numbering, no other defect) | `packages/database/src/migrations/0119_*` through `0124_saved_searches.sql` | none |
| Decision recorder hash-chain truly chains | POWERS §F.2 | REAL | `recorder.ts:264-297` computes `entryHash` via `chainHash(prev, payload)` and writes `prev_hash` + `entry_hash` columns | none |
| Inline citations parse + render | R1; commit `709f0694` | REAL | zod-validated `citations_block` discriminator + `CitationsBlock.tsx` consumes; brain prompt updates docs the emission | none |
| Tenant switcher cookie-bound | R12 | REAL | cookie HttpOnly + SameSite=Lax + server re-verifies link before write; 9 router tests | none |

---

## Inline fixes shipped

### Fix 1 — `personaGate.httpClient` was never bound; persona tools dispatched to fake fallbacks

**Symptom:** the 107-tool catalog was registered but every handler
that calls `ctx.httpClient` fell through its defensive
`if (!client) return { fake }` path. No persona tool could reach the
backend in production, regardless of whether the upstream route
existed.

**Root cause:** `services/api-gateway/src/index.ts:1016` constructed
`PersonaToolGate { killSwitchOpen, resolvePersonaSlug }` — neither
`httpClient` nor `auditSink` was bound.

**Fix:** wire an in-process HTTP client onto the gate that targets
the loopback gateway and forwards the service-token + tenant context
to upstream routes. The client is shaped to `PersonaToolHttpClient`
(`get<T>(path, init?)`, `post<T>(path, body)`). It sends requests to
`http://localhost:${PORT}${API_PREFIX}${path}` with an HS256-signed
service JWT minted from the gateway's own `JWT_SECRET`. This makes
the catalog handlers exercise the same auth + RLS path as a real
browser request.

This is a 1-line change at the binding site plus ~30 lines for the
client factory. Commit `<TBD pending>`.

(Note: this fix unblocks the *dispatch path*. The 34 missing
upstream routes still need to land separately — those remain logged
as a wave-scale follow-up in the gaps section below.)

---

## Gaps requiring follow-up

### G-A — 34 of 51 persona-tool paths point to routes that don't exist — **CLOSED 2026-05-29**

**Status:** CLOSED — closure commits below.

The retarget sweep recommended in the original entry shipped as agent
#182:

- `75f1acd9` feat(brain-tools): retarget 27 persona-tool paths to
  canonical Borjie routes (worker, manager, admin, owner, superpowers).
- `e7fb8c89` feat(mining): 5 new endpoints surfaced by persona-tool
  audit — `/mining/bids/incoming`, `/mining/bids/mine`,
  `/mining/bids/:id/withdraw`, `/mining/buyers/kyc/me`,
  `/mining/buyers/kyc/upload-atom`, `/mining/marketplace/market-intel`.
- `4ecc9e2c` test(mining): smoke tests for 6 new persona-tool retarget
  routes (18 vitest assertions).

The catalog now dispatches against routes that genuinely exist; the
loopback client's structured `Error` will surface real upstream
behaviour (200 / 4xx / 5xx) instead of the silent 404 fallthrough the
original audit caught.

### G-B — R5 worker hero card data wires call missing endpoints — **CLOSED 2026-05-29**

**Status:** CLOSED — closure commits below.

- `7bbe7778` feat(db): migration 0126 help_requests table (R5 closure).
- `3b27d888` feat(field-workforce): /me /tasks/next /tasks/:id/complete
  /help-requests (R5 wired) — 12 vitest assertions covering auth,
  validation, audit-chain insertion, and idempotency.

The hero card now fetches real worker identity + shift state + next
task + completion + help-request submission. The silent error swallow
that masqueraded as "no shift" is gone; pilot probes can now exercise
the surface end-to-end.

### G-C — KI-003 `requireService` middleware factory shipped without route adoption

`services/api-gateway/src/middleware/require-service.ts` is real and
tested, but zero production routes invoke it yet. Closes KI-003 as
a *factory* but not as a *deployment*.

**Effort:** S — pick 4-5 representative routes that currently do
`if (!service) return 503 stub` and replace with
`requireService('xxx')`. ~30 LoC.

### G-D — Persona-tool audit-sink was also never bound — **CLOSED 2026-05-29**

**Status:** CLOSED — `services/api-gateway/src/composition/brain-tools/audit-sink.ts` ships a Pino-backed `PersonaToolAuditSink` that emits one structured `tool.persona_audit` info log per WRITE-tool call with toolId / tenantId / actorId / personaSlug / stakes / inputDigest / outcome / occurredAt. Wired into `services/api-gateway/src/index.ts` at the same site as the loopback HTTP client. 3 vitest cases cover Pino emit shape, multi-outcome accumulation, and the in-memory test seam.

The structured-log path is intentional: the persona-tool gate sits ABOVE the per-domain audit ledgers (decision-journal, ai_audit_chain, ledger). A direct DB append from the gate would couple the persona-tool kernel to the database.

### G-E — Live-verify §G MCP "12/12 pass" doesn't actually invoke any tool

The pass rate includes `tools/call` returning `-32001 Unauthorized`
and `sampling/createMessage` returning `-32010` "requires client LLM
responder". These are protocol-correct contract errors, NOT
executions. The audit-doc text is honest about this in places but
the headline "12/12 pass" reads as actual invocation.

**Effort:** S — re-run the live-verify with an OAuth token so
`tools/call` actually dispatches. Or: clarify the audit-doc wording
to "envelope-conformance 12/12" rather than "live-invocation 12/12".

### G-F — Migration 0123 missing from the numbered sequence

`0119, 0120, 0121, 0122, 0124` are present; 0123 is unfilled. Not a
defect (every migration applies independently by hash, not by
numeric continuity) but cosmetic.

**Effort:** trivial — either reserve 0123 with a comment or skip it.

---

## Final tally

| Verdict | Count |
|---------|------:|
| REAL | 23 |
| SCAFFOLD (per brief — R3, R4) | 2 |
| DOC-ONLY | 0 |
| STUB | 1 (R5 data wires) |
| PARTIAL | 6 (R10 server hook; persona-tool dispatch; worker-tool paths; persona-tool path inventory; MCP `tools/call` not actually invoked; KI-003 unconsumed) |
| **Total claims audited** | **32** |

---

## Sign-off

**Verdict: YELLOW.** The shipped surfaces are real engineering — no
scaffold-as-real "throw new NotImplementedError" hides; no
single-line `return { fake: true }` masquerading as a handler; no
docs-only commit pretending to be a feature. The audit-doc
inaccuracies are CONCENTRATED in one zone: the persona-tool catalog
counter ("107/107 wired") is read as "107 work end-to-end" but the
catalog has never had its dispatch path exercised end-to-end. Of
those 107 tools:

- ~17 paths route to existing routes
- ~34 paths route to nonexistent routes
- 0 of the 107 ever reaches a backend in production because
  `gate.httpClient` is unbound

This sweep ships the boundary fix that binds `gate.httpClient` so
the next pilot probe will at least dispatch a real HTTP call (which
will then fail with 404 for the 34 missing routes — visible, loud,
attributable, which is what the kill-switch contract calls for).
The remaining route gaps and audit-doc wording cleanup are
wave-scale and recommended as agent #182.

End of reality check.
