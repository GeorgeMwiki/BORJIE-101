# Real-time SOTA — 2026-05-29

**Status:** scouting pass — selected patterns we adopt for Borjie's
cross-actor sub-200ms loop (web ↔ mobile bidirectional).
**Author:** real-time spike agent.
**Companion docs:** `Docs/OPS/REALTIME_NETWORK.md` (operational
runbook), `services/api-gateway/src/services/cockpit-events/*`
(implementation).

## TL;DR — the stack we run

| Layer | Choice | Why |
|-------|--------|-----|
| Server fan-out | In-process `EventEmitter` bus (R6) | Single-node MVP, zero infra, swap-seam to Redis/PG-LISTEN later |
| Wire | Server-Sent Events (HTTP/1.1 long-lived) | Browser-native, no WebSocket auth gymnastics, proxy-friendly |
| Mobile delta | Same SSE via `expo-eventsource` polyfill (#196) | Identical envelope as web |
| Client cache | TanStack Query v5 + `onMutate` optimistic | Immediate sender UI + server reconciliation |
| Telemetry | `event.emittedAt → Date.now()` round-trip POST | Surfaces P50/P95/P99 on cockpit widget |

## Why not the alternatives (now)

### Supabase Realtime (Phoenix Channels)
- **Pros (2026):** PG17 logical replication via WAL, 1M concurrent
  WS per project, native RLS forwarding through publication filters.
- **Cons for Borjie:** Adds a separate Elixir hop we do not own;
  every brain-emitted event would need to land in PG first to be
  fan-out, which adds round-trip + lag. We already do the WebSocket
  semantically (SSE long-lived) and our brain emits events from
  in-process workers that never round-trip the DB.
- **When to revisit:** when api-gateway shards horizontally
  (multi-node) — at that point a pubsub bus (Redis / Supabase
  Broadcast) becomes the seam.

### Liveblocks
- **Pros:** drop-in presence + cursors + Yjs CRDT.
- **Cons:** SaaS dependency, billed per MAU, opinionated about
  React component shape. Borjie is multi-surface (web + 2 Expo
  apps + buyer marketplace); we'd be sending sovereign mining data
  through a third party. Hard "no" for HIGH-policy actions.

### Convex
- **Pros:** TypeScript-first, end-to-end reactive.
- **Cons:** managed backend; we cannot run our Drizzle schema, RLS
  rules, ledger, or 12-agent brain inside Convex. The lock-in is
  total; rejected.

### Replicache
- **Pros:** strong offline-first model; pull-then-push with
  server-truth client cache.
- **Cons:** assumes a sync server (Postgres mutation_id polling) we
  would have to build. Our actions are user-triggered, not
  background-mergeable like a CRDT. Worth re-investigating for the
  buyer-mobile marketplace when offline-first becomes a hard
  requirement.

### Phoenix Channels (raw Elixir)
- Excellent at scale but we are a Node monorepo. Out of band.

### TanStack Query optimistic updates — adopted in full
- The exact pattern below (cancel + snapshot + apply + rollback
  on error + invalidate on settled) is the official
  recommendation and what we implement in
  `apps/owner-web/src/lib/optimistic-mutation.ts` and the two
  mobile mirrors.

## Latency budget (target: < 200 ms end-to-end)

| Hop | Budget | Notes |
|-----|--------|-------|
| Sender click → optimistic cache update | 5 ms | local React state |
| Sender POST → api-gateway | 30 ms | TLS + parse |
| DB transaction commit | 40 ms | indexed insert/update |
| `publishCockpitEvent` fan-out (in-process) | 1 ms | EventEmitter |
| Bus → SSE frame written | 5 ms | queueMicrotask |
| Network egress to receiver | 60 ms | last-mile mobile worst-case |
| Receiver SSE handler → cache update | 5 ms | React batched setState |
| **Total** | **~146 ms** | inside 200 ms SLO |

P95 should hit < 200 ms inside the same region. P99 may breach when
the receiver is on cold cellular (>3 s reconnect) — we drop the
event in that case; the next render fetches fresh.

## What we adopt verbatim from the SOTA

1. **Fire-and-forget publish from request handlers** — every mutating
   route calls `publishCockpitEvent` AFTER successful commit, wrapped
   so SSE failure never reverts the request response (R6 rule).
2. **SSE over WS** for our single-server topology — no auth header
   gymnastics, native `EventSource` API.
3. **`onMutate` optimistic snapshot + rollback** on every TanStack
   `useMutation` we expose on the sender surface.
4. **Server timestamp on every event** so the client can compute
   `Date.now() - new Date(event.emittedAt).valueOf()` and POST a
   measurement back to `/v1/metrics/realtime-latency`.
5. **P50/P95/P99 aggregated** by the daily-brief cron and surfaced
   in `RealtimeLatencyBadge` on the cockpit.

## Hard constraints (carried over from CLAUDE.md)

- No reflective CORS — SSE responses use the same origin allowlist.
- No `console.log` in services — Pino logger only.
- Publish runs AFTER the DB commit (otherwise we leak intent before
  durability) — fire-and-forget so a slow consumer cannot block the
  HTTP response.
- Bilingual sw/en copy for every event kind in `cockpit-sse.ts`.
- RLS untouched — events are filtered server-side by tenantId
  before they ever cross the wire; the bus never cross-publishes.

## Files implementing the above

- `services/api-gateway/src/services/cockpit-events/{bus,types,index}.ts`
- `services/api-gateway/src/routes/cockpit-stream.hono.ts`
- `services/api-gateway/src/routes/metrics/realtime-latency.hono.ts`
- `services/api-gateway/src/routes/observability/realtime.hono.ts`
- `apps/owner-web/src/lib/{cockpit-sse,optimistic-mutation}.ts`
- `apps/owner-web/src/components/cockpit/RealtimeLatencyBadge.tsx`
- `apps/{buyer-mobile,workforce-mobile}/src/lib/optimistic-mutation.ts`

## References (selected)

- Supabase Realtime architecture (PG17 / Phoenix) — https://supabase.com/docs/guides/realtime/architecture
- Supabase 2026 logical replication teardown — https://johal.in/architecture-teardown-supabase-2026-realtime-works-using-postgresql/
- TanStack Query optimistic updates — https://tanstack.com/query/v5/docs/framework/react/guides/optimistic-updates
- Liveblocks presence — https://liveblocks.io/docs/api-reference/liveblocks-react
- Convex sync engine — https://docs.convex.dev/realtime
- Replicache — https://doc.replicache.dev/
- Phoenix Channels — https://hexdocs.pm/phoenix/channels.html
