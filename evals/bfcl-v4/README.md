# BFCL v4 — Berkeley Function Calling Leaderboard harness for BORJIE

This is a **continuous, in-tree** runner that scores BORJIE's tool-use
surface against the BFCL v4 protocol (Berkeley, 2026 refresh). It complements
`pms-bench-1` (vertical property-management tasks) by exercising the GENERIC
function-calling behaviour every agent in the platform depends on.

## What BFCL v4 measures

The v4 grading set adds 5 categories on top of v3:

| Category | What it tests |
|----------|---------------|
| `simple` | one-shot call to one function, well-typed args |
| `multiple` | choose between N candidate functions |
| `parallel` | invoke ≥2 functions in one turn |
| `parallel_multiple` | choose AND parallelise |
| `irrelevant` | recognise that no function applies, refuse |
| `multi_turn` | hold state across ≥3 tool calls in a dialogue |
| `live_relevance` | new in v4 — drop tools that returned errors recently |
| `python_complex` | nested kwargs, optional vs required, None vs missing |
| `java_complex` | static-typed analog |
| `chat_able` | answer without a tool when faster |

## How we score

For each category we run `k` independent invocations of the BORJIE tool-
registry through the multi-LLM synthesizer
(`packages/ai-copilot/src/providers/multi-llm-synthesizer.ts`). Each invocation:

1. Receives the BFCL prompt + the BORJIE tool surface (filtered by
   `packages/mcp-server/src/safety/mcp-safe-allowlist.ts`).
2. Returns a tool call (or `chat_able` refusal).
3. The runner grades against the BFCL ground-truth.

Final score per category = pass-rate at k=3 (matches BFCL leaderboard rules).

## Why it's in-tree, not a fork

We do not host the BFCL ground-truth dataset (it's CC BY-NC). We host the
**runner** + **adapters** + the **subset of property-mgmt-shaped tasks** we
care about. The full BFCL dataset can be cloned next to this directory:

```bash
git clone https://github.com/ShishirPatil/gorilla.git /tmp/gorilla
BFCL_DATASET_DIR=/tmp/gorilla/berkeley-function-call-leaderboard/data \
  pnpm --filter @borjie/bfcl-v4 run bench
```

## Files

- `runner/bfcl-runner.ts` — orchestrator
- `runner/adapters.ts` — maps BFCL tool schemas → BORJIE tool surface
- `runner/scorers/` — one file per BFCL category
- `runner/report.ts` — JSON + Markdown report
- `tasks/` — placeholder; real dataset cloned at run time

## Tau-Bench

`evals/tau-bench/` runs a parallel-but-different protocol — **interactive
agent in a simulated property-management environment** (analog of τ2's
retail / airline simulators). See `evals/tau-bench/README.md`.
