# Realtime Network Operations — RT-4

**Last updated:** 2026-05-29
**Companion:** `Docs/RESEARCH/REALTIME_SOTA_2026-05-29.md` (architecture).
**Audience:** SRE + on-call. This is the operational runbook for
keeping the cross-actor SSE loop inside the 200 ms SLO.

## SLO

- **P95 round-trip < 200 ms** (sender click → receiver UI flip).
- **P99 round-trip < 500 ms.**
- **P50 round-trip < 100 ms.**

Measured by the `realtime-latency` store fed by every cockpit SSE
consumer (`apps/owner-web/src/lib/realtime-latency-reporter.ts`).
Surfaced on the owner cockpit "Live sync" badge.

## Server-side checklist

| Item | Status | Notes |
|------|--------|-------|
| Hono `streamSSE` on `/api/v1/cockpit/stream` | ✓ enabled | `services/api-gateway/src/routes/cockpit-stream.hono.ts` |
| `setMaxListeners(0)` on the bus EventEmitter | ✓ enabled | `services/api-gateway/src/services/cockpit-events/bus.ts` lifts the default 10-listener cap |
| SSE heartbeat every 25 s | ✓ enabled | Prevents Cloudflare / NLB idle-timeout (60 s default) from killing the socket |
| Publish runs AFTER DB commit | ✓ enforced | Otherwise we leak intent before durability |
| Publish wrapped in `setImmediate(...)` | ✓ enforced | Fire-and-forget so a slow consumer cannot block the HTTP response |
| Brotli compression on JSON responses | ✓ enabled | `@borjie/performance-toolkit/cache` |
| HTTP/2 keep-alive on the upstream proxy | required at deploy | Vercel / Cloudflare default; verify in staging before rollout |

### What we deliberately do NOT do on SSE responses

- **No compression.** `Content-Encoding: br` on `text/event-stream`
  triggers buffering in most proxies — each event would batch
  before flushing and the latency budget evaporates. The cache
  middleware skips streaming responses by default.
- **No `Cache-Control` `public`.** SSE is per-user; we set
  `private-revalidate` globally and let the SSE handler keep the
  socket open.
- **No reflective CORS.** The origin allowlist (`CLAUDE.md` hard
  rule) covers SSE too — `EventSource` uses the same CORS rules as
  `fetch`.

## Client-side checklist

| Item | Surface | Status |
|------|---------|--------|
| `EventSource(..., { withCredentials: true })` | owner-web | ✓ `apps/owner-web/src/lib/cockpit-sse.ts` |
| Reconnect backoff < 1 s on disconnect | mobile (#196) | inflight |
| `staleTime: 1_000` on the cockpit queries | owner-web | tuned via `apps/owner-web/src/lib/queries/*` |
| `gcTime: 30_000` for hot caches | owner-web | tuned per query |
| Optimistic mutation helper applied at 10+ surfaces | all | shipping per `apps/*/src/lib/optimistic-mutation.ts` |
| Latency reporter batches every 5 s / 25 events | owner-web | `apps/owner-web/src/lib/realtime-latency-reporter.ts` |

## Burst-volume math

Worst-case publish volume in MVP:
- 1 owner cockpit subscribed per tenant (browser EventSource).
- 1 manager mobile + N worker mobiles subscribed per tenant.
- Cross-actor events: tasks (~20/h), shifts (~50/h), incidents (~5/h),
  approvals (~10/h), bids (~30/h) → ~115 events/h/tenant.

At 100 tenants live concurrently that's ~11.5 k events/h, or
~3.2 events/s globally. The `EventEmitter` fan-out is O(subscribers)
per publish — with ~5 subscribers per tenant the system handles
~16 listener invocations/s, two orders of magnitude inside Node's
single-thread event loop budget.

When we hit 1 000 tenants the in-process bus becomes a bottleneck —
swap-seam is the singleton `emitter` in `cockpit-events/bus.ts`.
Replace with a Redis stream or Supabase Broadcast adapter; the
publisher / subscriber API stays identical (`publishCockpitEvent`
and `subscribeCockpitEvents`).

## Failure modes + responses

### "Live sync" badge stays red (P95 > 500 ms)

1. Check the owner cockpit dev tools `Network` tab for the SSE
   socket — confirm the connection is open and heartbeats are
   arriving every 25 s.
2. Check api-gateway logs for `cockpit-events` warnings — slow
   subscriber callbacks log their listener count.
3. If a single tenant is breaching, suspect a wedged subscriber:
   force-reload the cockpit, the bus will drop the listener.
4. If global: check api-gateway CPU + event-loop lag in OTel
   (`process.event_loop.lag.p95`). Restart only if lag is wedged
   above 100 ms for 5+ minutes.

### SSE socket disconnects every ~60 s

Proxy idle timeout is firing. Verify the 25 s heartbeat is leaving
the gateway (`tcpdump`/Wireshark on the SSE connection); if it's
present the proxy is overriding our keep-alive. Raise the proxy's
idle-timeout to 90 s.

### Cockpit shows 0 events but the API ingested mutations

`publishCockpitEvent` is fire-and-forget — if the EventEmitter has 0
listeners the publish is a no-op (returns 0). Check that the cockpit
SSE handler is subscribed: there should be exactly one listener per
connected cockpit, visible in
`emitter.listenerCount('cockpit:${tenantId}')`. If 0, the SSE handler
crashed on connect; check api-gateway error logs.

## Capacity planning trigger

When P95 latency exceeds 200 ms for 3 consecutive daily-brief windows,
file an SRE ticket. The remediation in order of cost:

1. **Throttle non-critical event kinds** (drop opportunity scans on
   the wire — they can be polled instead).
2. **Move the bus to Redis pubsub** — swap the singleton emitter
   for a Redis client; publisher / subscriber API stays identical.
3. **Shard api-gateway horizontally** — at that point we need the
   Redis pubsub for cross-node fan-out anyway.
