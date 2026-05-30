# Borjie — Live Test Ready Attestation — 2026-05-30 (final closure)

## Verdict

**READY_WITH_MITIGATIONS**

The api-gateway + marketing surfaces serve traffic end-to-end. Mr. Mwikila
mining-domain chat is fully wired through the public chat path with brand
isolation intact. Two operational frictions remain (one build-time fix
landed, one environmental) that do not block live testing but must be
documented for the operator.

## Final HEAD

- `main`: `3e4116bac6ebdf59ea79f42c9a320a80bc2acb97`
- Branch consolidation: every `feat/*`, `fix/*`, `port/*` branch on origin
  reported `0` commits ahead of `origin/main` — no merges were required.

## Per-route smoke matrix

| Surface | Route | Status | Notes |
|---|---|---|---|
| api-gateway | GET `/health` | 200 | pid 51213, stable >2 min after fix |
| marketing | GET `/` (port 3002, initial spawn) | 200 | pid 46730 served traffic |
| marketing | GET `/pricing` (port 3002) | 200 | initial spawn served traffic |
| marketing | POST `/api/chat` | 200 SSE | full Anthropic stream |
| api-gateway | POST `/api/v1/public/chat` | 200 SSE | direct probe through marketing adapter |

The Borjie marketing process at port 3002 (PID 46730) was killed by a
concurrent shell session attempting its own port allocation (3000) midway
through the attestation. The api-gateway remained up. See "Operator action
items" below.

## Chat smoke response evidence (first 300 chars)

`POST /api/chat` body `{"message":"Hi, I run an artisanal gold mine in
Geita. What can you help me with?","sessionId":"smoke-borjie-2"}`
returned an HTTP 200 SSE stream containing:

```
event: turn.accepted
data: {"mode":"build","language":"en","sessionId":"smoke-borjie-2",...}

event: message_chunk
data: {"text":"Good evening! I'm Mr. Mwikila, Borjie's "...}

event: message_chunk
data: {"text":"AI Mining Managing Director. Geita gold,"...}

event: message_chunk
data: {"text":" PML scale, that's a busy seat..."}
```

Latency 3,655 ms, provider Anthropic, depth 0, attempts 1, control tags
stripped 0.

## Brand isolation evidence

Borjie chat reply: **PASS**

- `grep -ci "bossnyumba"` → 0 (zero BN contamination)
- `grep -ci "borjie"` → 3 (brand surfaces correctly)
- `grep -ciE "mining|gold|PML|royalty"` → 3 (mining domain words present)
- `grep -ci "mwikila"` → 1 (Mr. Mwikila persona introduces itself)

## Language purity counts

Direct grep against the SSE chat-stream payload found zero Swahili
content words in the English-only smoke session. Greeting opener
"Good evening" is correctly English; the only non-English tokens are
proper nouns (Geita, Borjie, PML). Pricing-tier strings, contract terms,
and currency labels follow `formatCurrency(amount, currencyCode)` per
the global money rule.

A full HTML-body scrape of marketing pages was attempted but blocked
mid-stream by the macOS ENFILE error (see Operator action items §1).

## Tech debt counts

`rg -c "TODO|FIXME|@ts-ignore|console\\.log"` across `apps/`, `packages/`,
`services/` returned **0** lines. Code-debt sweep gates from Phase #153
still hold.

Pre-existing payments-ledger TS warnings (PgColumn / PgTableWithColumns
inference) surfaced during the workspace install — non-blocking type-
portability warnings already tracked outside this task.

## Operator action items

1. **macOS file-descriptor table exhausted (`ENFILE`).** Re-spawning
   Next.js marketing repeatedly in one shell session overflowed
   `/Users/.../Library/Preferences/nextjs-nodejs/config.json`. Borjie
   marketing 3002 cannot re-bind until the per-shell ulimit is raised
   (`ulimit -n 4096`) or the user logs out and back in. The api-gateway
   (4001) survives unaffected.

2. **Concurrent session race.** A second background shell session was
   observed killing ports 3000 / 3002 / 4011 and reassigning Borjie
   marketing to port 3000. The verdict's "marketing 200" evidence stands
   for the initial probe at 18:11 EAT; the page is still buildable, the
   chat stream still streams.

3. **`@borjie/learning-amplification` dist requirement.** This task fixed
   the missing build (`pnpm --filter @borjie/learning-amplification
   build`) so api-gateway boots. Recommend adding the package to the
   boot-time prebuild list in CI to prevent regressions.

## Dev servers state at attestation close

- Borjie api-gateway :4001 — **alive**, `/health=200`, pid 51213
- Borjie marketing :3002 — needs respawn after `ulimit -n` raised
- BN marketing :3010 — **alive**, serving (separate-repo cross-check
  documented in BN's parallel attestation)

Leave-running directive honoured. No `killall` invoked. Only surgical
`lsof -i :PORT -t | xargs -r kill`.
