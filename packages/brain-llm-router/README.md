# @borjie/brain-llm-router (Phase N-C)

**LLM-as-Soul Architecture** — the brain layer that owns accuracy regardless of which LLM is plugged in.

## Why

Models change. The brain doesn't. Pin a universal client, route by task, cascade by cost,
fall back across providers, vote for consistency, verify for facts. LLMs become
*replaceable souls*; the load-bearing intelligence lives in this package.

## 10 modules

| # | Module | Role |
|---|---|---|
| 1 | `universal-client/` | LiteLLM-style adapter over Anthropic, OpenAI, Google, Ollama, vLLM |
| 2 | `task-ladder/` | declarative per-task model preference (`plan | tool-use | critic | classify | chat | longdoc | codegen`) |
| 3 | `provider-fallback/` | `[Anthropic Direct -> Bedrock -> Vertex -> OpenAI]` with circuit-breaker + backoff |
| 4 | `cost-cascade/` | Haiku -> Sonnet -> Opus escalation gated by `evalFn(response) >= threshold` |
| 5 | `dspy-compile/` | port of MIPROv2 — compiled prompts cached under `compiled-prompts/<task>/<model>.json` |
| 6 | `hedged-requests/` | race 2 providers, take first to return — p99 drop 30-60% for ~10% spend |
| 7 | `prompt-portability/` | XML-tag standard (`<role>`, `<task>`, `<tools>`) -> per-provider translation |
| 8 | `cost-cap/` | per-tenant per-conversation budget enforcement |
| 9 | `eval-drift-logger/` | every `brainCall` logs `{task, model, prompt_hash, response_hash, confidence, latency, cost}` |
| 10 | `brain-call-orchestrator/` | THE single entry point. Pipeline: TaskLadder -> DSPy -> fallback -> Self-Consistency -> CoVe -> eval-drift |

## Quick start

```ts
import { brainCall } from '@borjie/brain-llm-router';

const res = await brainCall({
  task: 'plan',
  prompt: '<task>Draft inspection plan for unit 3B</task>',
  tenantId: 'tnt_123',
  options: { consistencyN: 3, cove: true, costCapUsd: 0.5 },
});
```

## Tests

```bash
pnpm -F @borjie/brain-llm-router test
```

100+ unit + 15 integration tests covering each adapter, ladder selection,
fallback cascade, cost cascade savings, DSPy cache hit, hedged win/no-double-bill,
prompt portability across 3 models, and full orchestrator pipeline.
