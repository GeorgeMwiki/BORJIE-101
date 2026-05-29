# @borjie/edge-inference

**Status:** SCAFFOLDED. Phase-2 deployment per `Docs/RESEARCH/EDGE_INFERENCE_CLOUDFLARE.md`.

Cloudflare Worker that runs Llama 3.1-8b at `af-south-1` for the
owner-mobile first-50-tokens path. The api-gateway races this stream
against the Anthropic adapter; whichever returns first wins.

## DO NOT DEPLOY

The cap-flip is gated on owner-mobile pilot SLO data. See the roadmap
R3 entry and the research doc for the gate criterion.

## What ships in this scaffold

- `src/index.ts` — Worker fetch handler with SSE shape parity.
- `wrangler.toml` — staging + production envs with smart placement.
- `package.json` — wrangler + workers-types dev deps.
- `__tests__/` — pure-helper coverage (vitest).

## Phase-2 to-do (NOT in this commit)

1. `services/api-gateway/src/services/edge-brain/edge-brain-client.ts`
2. `services/api-gateway/src/services/edge-brain/race-merge.ts`
3. `BORJIE_EDGE_BRAIN=on` env flag wiring
4. Staging deploy via `wrangler deploy --env staging`
5. Cron Trigger to keep the isolate warm during business hours
