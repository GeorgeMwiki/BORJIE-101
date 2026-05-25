# @borjie/reasoning-substrate

> Phase M-A — the deep-reasoning substrate the BORJIE MD agent
> runs on. Closes L1-audit top-3 picks: **adaptive thinking +
> interleaved tool use**, **Plan-and-Solve+**, **Self-Discover** task
> structures cached in K-D's TemporalKG.

## Why this package exists

The MD agent makes high-stakes, multi-step, policy-bound decisions
about real people's housing (rent, repairs, eviction, lease renewal,
dispute escalation). Reasoning cost is bounded by Anthropic per-
tenant cost-of-serve. The reasoning substrate gives the MD:

- **Adaptive thinking** (Claude 4.6+) — native API, zero glue
- **Plan-and-Solve+ skeleton** — eliminates "missing-step" errors
- **Self-Discover structures** — discover once per task class,
  replay forever; 10-40× cheaper than CoT-SC
- **Thinking-block continuity** — the runtime invariant that lets
  interleaved thinking + tool use actually work across turns

Each is independently swappable; each is backed by a published
paper; each is cheap enough to run on Anthropic.

## API quirks closed by this package

Verbatim from the L1 audit:

> Opus 4.7 returns 400 on manual `thinking: { enabled: true }` — MUST
> use `thinking: { type: 'adaptive' }`

> Must pass prior thinking blocks back alongside `tool_use` blocks in
> the next turn — otherwise reasoning continuity is lost.

The wrapper at `./adaptive-thinking/createThinkingMessage` makes the
first impossible (the legacy shape is unrepresentable). The builder at
`./continuity/prepareNextTurn` enforces the second (orphaned thinking
or tool_use blocks throw on assembly).

## Surface

```ts
import {
  // L1 #1 — Adaptive thinking + interleaved tools
  createThinkingMessage,
  prepareNextTurn,
  assertThinkingBlockOrder,

  // L1 #2 — Plan-and-Solve+
  wrapWithPlanAndSolve,

  // L1 #3 — Self-Discover
  discoverReasoningStructure,
  createInMemoryReasoningStructureCache,
  EVICTION_TZ_DSM_STRUCTURE,
  ALL_PRIMITIVES,

  // K-D / K-E integration shims
  buildReasoningPrefix,
  scoreWithKEConstitutional,
  recordTaggedReflection,
} from '@borjie/reasoning-substrate';
```

## Composition pattern

```ts
// 1. Look up (or discover) the reasoning structure for this task class.
const { structure } = await discoverReasoningStructure({
  taskClass: 'eviction',
  jurisdiction: 'TZ-DSM',
  samples: [{ description: '4 missed payments; mediation_opt_in=true' }],
  cache,         // bound to K-D's TemporalKG at composition root
  discoverer,    // bound to Anthropic Opus 4.7 at composition root
});

// 2. Build the system prefix (prefix-cache friendly).
const sys = buildReasoningPrefix({
  structure,
  callerVoice: 'You are BORJIE MD. Tone: firm but non-threatening.',
  planAndSolveConfig: {
    extractionStrictness: 'all-or-fail',
    requiredVariables: ['tenantId', 'jurisdiction', 'unpaidAmount', 'curePeriodDays'],
  },
});

// 3. Send the turn with adaptive thinking.
const { response } = await createThinkingMessage({
  client,        // @anthropic-ai/sdk
  model: 'claude-opus-4-7',
  system: sys,
  messages: [{ role: 'user', content: userMessage }],
  tools,         // get_lease, query_rent_history, check_mediation_status, ...
  effort: 'high',
});

// 4. If response has tool_use blocks, run them and assemble next turn.
const next = prepareNextTurn({
  priorMessages: [{ role: 'user', content: userMessage }],
  priorResponse: response,
  toolResults,
});
// → next.messages now correctly retains every prior thinking block.

// 5. After session end, write a task-class-tagged reflection.
await recordTaggedReflection(reflexionWriter, {
  tenantId, userId, sessionId,
  structure,
  outcome: 'success',
  body: 'Tenant accepted mediation offer.',
  lessons: ['Always verify mediation clause before drafting eviction notice.'],
});
```

## Folder layout

```
src/
  adaptive-thinking/         # createThinkingMessage, types, telemetry
  plan-and-solve/            # wrapWithPlanAndSolve skeleton
  self-discover/             # SELECT / ADAPT / IMPLEMENT + 39+6 primitives + cache
  continuity/                # prepareNextTurn + assertThinkingBlockOrder
  integrations/              # K-D + K-E duck-typed shims
  index.ts                   # public barrel
```

## Tests

- Adaptive: 12 fixture wire-shape tests + 5 tool-interleave cases
- Plan-and-Solve+: 10 task scenarios + edge cases
- Self-Discover: 8 task-class fixtures + cache hit + invalidation +
  validation
- Continuity: 6 multi-turn sequences with interleaved tools

Run: `pnpm --filter @borjie/reasoning-substrate test`
