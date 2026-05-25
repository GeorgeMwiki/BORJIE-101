# Central Intelligence Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/central-intelligence/`
**Public entry:** `packages/central-intelligence/src/index.ts`
**Tier scope:** all tiers (kernel enforces compatibility)

## Purpose

The embodied-agent kernel — Borjie's brain. A disciplined 14-step
cognitive pipeline above the streaming agent loop, mirroring LITFIN's
brain-kernel patterns scoped to property management. Eight personas
(tenant, owner, estate-manager, org-admin, platform-sovereign, sovereign-
admin, marketing-guide, classroom-tutor) speak grounded in their own
knowledge graphs with tool-using extended thinking.

## Entry points

- `createCentralIntelligenceAgent({ llm, tools, memory, voice })` —
  streaming agent loop (`src/agent/agent-loop.ts`).
- `createBrainKernel({ sensors, cohort, cotReservoir, ... }).think(req)` —
  the 14-step disciplined pipeline (`src/kernel/kernel.ts`).
- `createToolRegistry([...])` — graph query, forecast, audit, platform
  aggregate, docs search (`src/tools/registry.ts`).
- All persona constants + `selectPersona` + `runPolicyGate` +
  `inferMindState` re-exported flat from `src/kernel/index.ts`.

## Internal structure

- `kernel/` — 71 files. `kernel.ts` orchestrates 14 steps: killswitch,
  cache, inviolable, scope/tier check, memory recall, cohort signal,
  identity preamble + theory-of-mind, sensor failover, normalize,
  judge + regen, drift, policy-gate, uncertainty-policy, confidence,
  provenance + CoT capture.
- `kernel/sensors/`, `kernel/critics/`, `kernel/debate/`, `kernel/reflexion/`,
  `kernel/cot-reservoir/`, `kernel/persona-drift/`, `kernel/agency/`,
  `kernel/counter-model/`, `kernel/orchestrator/`, `kernel/world-model/`,
  `kernel/skill-library/`, `kernel/self-rag/`, `kernel/shadow-mode/`,
  `kernel/rollout/`, `kernel/security/`, `kernel/streaming/`.
- `agent/agent-loop.ts` — SSE event stream emitter.
- `memory/in-memory-memory.ts` — dev fallback; production uses Drizzle
  adapter wired in `services/api-gateway/src/composition/`.
- `screening/`, `maintenance-triage/`, `credit-scoring/`, `voice/`,
  `tools/registry.ts`, `audit/conversation-audit.ts`.

## Dependencies

- Upstream: `services/api-gateway` (composition root wires sensors,
  ports, memory adapters, cohort source). Apps consume via SSE.
- Downstream: `packages/database` (Drizzle schemas for memory, CoT,
  audit), `packages/observability` (OTel spans), `packages/genui`
  (ui_block contracts).

## Common workflows

- **Add a new persona** → append to `kernel/identity.ts` `ALL_PERSONAS`
  + extend `selectPersona`. Re-export from `kernel/index.ts`.
- **Add a new sensor** → implement `Sensor` from `kernel/kernel-types.ts`;
  register in api-gateway composition via `brain-kernel-wiring.ts`.
- **Add an inviolable rule** → extend `kernel/inviolable.ts` /
  `kernel/public-inviolable.ts`. HIGH-risk surfaces must use literal
  matching, no reason-resolver generalisation.
- **Add a new tool** → factory in `tools/registry.ts`; bind in api-gateway
  `composition/hq-tool-port-bindings.ts`.
- **Trace a decision** → every `think()` call writes a `DecisionTrace`;
  `decision-trace.ts` + `cot-reservoir.ts` persist via injected sinks.

## Anti-patterns to avoid

- Never bypass `kernel.think()` for high-stakes writes — always emit a
  `DecisionTrace` and check inviolable.
- Never wire sensors directly in apps — only through api-gateway
  composition root.
- Never mutate the `MdSubagents`-style bundle inside the kernel; it is
  frozen per request.
- Belief / persona-drift writes are gated by confidence delta thresholds —
  do not write directly to the underlying tables.
- HIGH-risk policy prefixes (sovereign / kill_switch / four_eye /
  policy_rollout) must hit a literal policy rule; never rely on
  reason-resolver generalisation.

## Related codemaps

- [api-gateway.md](./api-gateway.md) — composition + wiring
- [ai-copilot.md](./ai-copilot.md) — personas / prompts substrate
- [observability.md](./observability.md) — decision trace + OTel
- [database.md](./database.md) — memory + CoT + audit tables
