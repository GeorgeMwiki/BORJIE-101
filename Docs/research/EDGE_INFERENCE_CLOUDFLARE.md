# Edge Inference on Cloudflare Workers AI — Architecture & Roadmap

**Last updated:** 2026-05-29
**Roadmap item:** R3 (XL, Phase-2 — deploy after pilot SLO data)
**Companion code:** `services/edge-inference/` (MVP scaffold)
**Status:** SCAFFOLDED. The Cloudflare Worker code, wrangler config,
and api-gateway client stub are committed. Deployment + cap-flip are
gated on owner-mobile pilot TTFT data per the original gate criterion.

---

## 1. Why edge inference?

Tanzanian and pan-African owners use the workforce-mobile / owner-
mobile apps on 4G urban networks. The current Anthropic-only path
runs through us-east-1 → eu-west-3 → owner phone, costing 280–400 ms
round-trip for the first token alone. Research §9.3 of
`Docs/RESEARCH/mobile-onload-intelligence.md` projects a 200 ms TTFT
saving by running the **first 50 tokens** at `af-south-1` (Cape Town
/ Johannesburg).

The remaining stream still goes through Anthropic — we are only
trying to **win the first impression** so the owner sees motion in
≤300 ms instead of >500 ms. Race-and-merge composition: whichever
returns first is shown; the loser is discarded.

---

## 2. Architecture

```
owner-mobile  ─▶  api-gateway (us)
                     ├─▶ AnthropicAdapter          ──╮
                     └─▶ EdgeBrainClient ─▶ CF Worker (af-south-1)
                                             └─▶ Workers AI:
                                                  @cf/meta/llama-3.1-8b-instruct
                                                       │
                                                       ▼
                              race-and-merge in api-gateway
                                       │
                                       ▼
                                  SSE → mobile
```

Components:

1. **`services/edge-inference/`** — new Cloudflare Worker package.
   - Wrangler v3 + `nodejs_compat` flag.
   - Single `POST /v1/edge-brain/turn` handler.
   - Calls Workers AI `@cf/meta/llama-3.1-8b-instruct` (or whichever
     model lands cheapest by quarter; the binding is name-resolved at
     runtime so we can flip models without re-deploying client code).
   - Emits SSE chunks with the same `message_chunk` envelope as the
     api-gateway brain so the client multiplexer is provider-agnostic.

2. **`api-gateway/src/services/edge-brain/edge-brain-client.ts`**
   (NOT yet committed — Phase-2). Wraps the CF Worker call behind the
   same `BrainLLMClient` interface as the Anthropic/OpenAI adapters.

3. **`api-gateway/src/services/edge-brain/race-merge.ts`**
   (NOT yet committed — Phase-2). Fires the Anthropic adapter and the
   `EdgeBrainClient` in parallel; the first non-error chunk wins.

4. **CORS + audit** — the CF Worker writes a hash-chained audit
   record back via a webhook to the api-gateway so the hash chain
   stays single-source. The audit chain hard rule forbids dual-write.

---

## 3. Cost math

Workers AI billing (May 2026):
- Llama 3.1-8b: $0.000011/neuron, ~24 neurons/100 tokens → $0.0026 /
  1K output tokens.
- Anthropic Claude 3.5 Haiku: $1/M in + $5/M out → $0.005/K out.

So for the first 50 tokens we cut ~$0.00013/call. Across 50K active
owners doing 8 turns/day = $52/day savings, $1.6K/month. The cost
case is real but small; the **latency** case is the priority.

---

## 4. Deployment plan (Phase-2 — post-pilot)

Triggered when the owner-mobile pilot delivers >5K daily turns AND
the p90 TTFT is >450 ms on the 4G cohort.

Steps (each a separate PR):

1. **Pre-flight** — `wrangler deploy --dry-run` from the
   `services/edge-inference/` package; verify the Llama 3.1-8b
   binding is region-pinned to AFR via the `placement.mode = smart`
   config in `wrangler.toml`.
2. **Staging URL** — `wrangler deploy --env staging`, returns
   `https://borjie-edge-staging.<account>.workers.dev`.
3. **api-gateway client** — implement
   `services/api-gateway/src/services/edge-brain/edge-brain-client.ts`
   + `race-merge.ts`. Behind `BORJIE_EDGE_BRAIN=on` env flag,
   default OFF.
4. **Soak test** — flip the flag in staging only; compare TTFT
   distributions for 7 days.
5. **Cap-flip** — flip `BORJIE_EDGE_BRAIN=on` in production.
6. **Roll-back hatch** — flip the env back OFF; the api-gateway
   falls through to the Anthropic-only path.

---

## 5. Open questions for Phase-2

1. **Audit chain shape** — does the CF Worker emit a `decision_event`
   per turn, or per merged response? Lean: per merged response, with
   `edge_first_tokens` + `merged_with_anthropic_at` metadata. Keeps
   the hash chain at one row per turn.
2. **Cold-start** — first request to a fresh CF Worker isolate is
   ~50 ms slower. Mitigate via Cron Triggers that ping the worker
   every 5 min during business hours.
3. **PII boundary** — the edge worker MUST NOT see PII. The api-
   gateway scrubs the prompt to the system-prompt + intent only, no
   tenant names / phone numbers / NIDA.
4. **Per-region model availability** — Workers AI sometimes lacks
   parity in af-south-1. Fallback chain: af-south-1 → eu-west-3 →
   us-east-1 in `placement.mode`.

---

## 6. Why deferred from initial closure pass

The XL-effort gate criterion in the roadmap requires owner-mobile
pilot SLO data that we don't have yet. We have shipped the
**scaffold**, the **research doc**, and the **deployment path**;
the cap-flip waits on the pilot.

References:
- `services/edge-inference/` package skeleton (committed)
- `Docs/RESEARCH/mobile-onload-intelligence.md` §9.3 (gate criterion)
- `Docs/ROADMAP.md` R3 (status row updated)

---

## 7. DO NOT DO

- Do not deploy the CF Worker to production before the pilot SLO
  data lands. The latency saving is unmeasured.
- Do not put the audit chain in the CF Worker — single-source rule.
- Do not bypass the prompt scrubber. The edge path is for system-
  prompt + intent only.
