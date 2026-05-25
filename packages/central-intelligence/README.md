# @borjie/central-intelligence

> The Brain. Borjie's central-intelligence kernel — a 13-step
> sense → think → actuate pipeline that runs on every conversational
> turn across all four portals (admin, owner, estate-manager, customer).

## Why this package exists

This is the *kernel* in the OS-as-brain metaphor: the deterministic,
policy-bound, auditable runtime that sits between the conversational
surface (AI SDK + AG-UI) and Borjie's business actions. The kernel
guarantees:

- **Identity** — every turn carries a verified `(tenantId, userId, surface)` triple.
- **Inviolability** — the killswitch + policy gate fire BEFORE any LLM call.
- **Tier-aware actuation** — destructive actions cannot bypass four-eye approval.
- **Tenant isolation** — memory, embeddings, audit are all tenant-scoped at the storage layer.
- **Tamper-evident audit** — every transition emits a hash-chained row.

## The 13-step pipeline

Implemented in `src/kernel/kernel.ts`. Step order is invariant.

| # | Step | Module | Purpose |
|---|---|---|---|
| 1 | Cache check | `brain-cache.ts` | Short-circuit identical recent turns |
| 2 | Inviolable | `inviolable.ts`, `killswitch.ts` | Reject if killswitch is `paused`/`locked` |
| 3 | Tier classification | `risk-tier.ts` | Decide read / mutate / destroy / billing / external-comm |
| 4 | Memory recall | `memory/` (4-tier hierarchy) | Pull episodic + semantic + procedural + reflective |
| 5 | Cohort signal | `cohort-signal.ts` | Add DP-bounded peer-tenant signal |
| 6 | Persona binding | `persona.ts`, `branding.ts` | Apply per-tenant branding & voice |
| 7 | Sensor failover | `sensor-failover.ts` | Provider cascade Claude → OpenAI → DeepSeek |
| 8 | Normalize | `normalizer.ts` | Strip PII, format unified prompt |
| 9 | Judge / generate | `sensors/` | Run the LLM call |
| 10 | Drift detection | `persona-drift/`, `drift-detector.ts` | Compare output to expected persona signature |
| 11 | Policy gate | `policy-gate.ts`, `four-eye-approval.ts` | Apply tier-aware approval requirements |
| 12 | Confidence | `confidence.ts`, `uncertainty-policy.ts` | Tag output uncertainty for surface rendering |
| 13 | Provenance + audit | `decision-trace.ts` | Hash-chain the transition |

After step 13, control returns to the orchestrator (agency executor).

## Key submodules

### `kernel/agency/`

Goal-stack persistence + executor. The brain decomposes a high-level
intent into a goal tree (`kernel_goals` table), then steps the
executor row-by-row in `kernel_action_audit`. Sub-system:

- `goals/` — persistent goal stack with JSON-serialised steps
- `executor/` — step machine: open → planning → awaiting_approval → executing → done
- `initiative/wake-loop.ts` — proactive triggers (arrears spike, vacancy jump)

### `kernel/critics/`

Multi-critic review (LLM-as-judge) for high-stakes outputs.
Currently: safety, accuracy, completeness, persona-adherence.
Critic verdicts become an input to step 12 confidence.

### `kernel/counter-model/`

Anti-sycophancy: an opposing model that argues against the primary
output. Activated for tier `destroy` / `billing`.

### `kernel/persona-drift/`

Detects when the brain "drifts" from its expected persona (voice,
register, capability boundary). On a drift event the kernel writes
to `kernel_persona_drift_events` and surfaces a flag on step 12.
Cron `personaDriftCron` aggregates per-session signals (see
`Docs/RUNBOOKS/cron-supervisor-debug.md`).

### `kernel/prompt-evolution/`

Weekly DSPy GEPA/MIPROv2 optimiser. Memory-only; the base model
weights are immutable. Generates a new prompt artefact, A/B-tests
against the current, promotes on win.

### `kernel/reflexion/`

Per-session retrospective. After N turns, the brain reflects on
what worked, what didn't, and writes one row to
`kernel_memory_reflective`. Implements Shinn et al. (NeurIPS 2023).

### `kernel/skill-library/`

Voyager-style skill registry. Each skill = (NL description, embedding,
implementation tool-spec, success/fail counts, tenant scope). The
brain retrieves applicable skills before planning.

### `kernel/cot-reservoir/`

Sampled chain-of-thought reservoir. Stores per-think provenance for
later inspection + privacy-budget accounting.

## Extension points

### Add a new persona

1. Add the persona record to `persona-branding` seed data.
2. Define voice + opening-preamble overrides per surface.
3. Register persona-specific tools (optional) in `tool-spec/hq-tools/`.
4. Add a critic specialisation if needed.
5. Validate by chatting from the owner portal — drift detector will
   complain loudly if the persona signature is unstable.

### Add a new HQ tool

1. Create the tool file under `src/kernel/tool-spec/hq-tools/`.
2. Implement the tool function with `(input, ctx) => Promise<output>`.
3. Annotate with risk tier, side-effect taxonomy, purpose string.
4. Register in `src/kernel/tool-spec/hq-tools/index.ts`.
5. Add unit tests under `src/__tests__/`.
6. If tier is `destroy`/`billing`/`external-comm`, document the
   compensation path.

### Add a new wake trigger

1. Implement `WakeTrigger` from `kernel/agency/initiative/types.ts`.
2. Define `detect({ tenantId, clock })` returning `WakeTriggerDetectedGoal[]`.
3. Set an optional preferred `cron` cadence field.
4. Register in the wake-loop registry.
5. Wire a `CronJob` matching the trigger's preferred cadence.

## Configuration

The kernel reads:

- `ANTHROPIC_API_KEY` — primary LLM provider (required for non-stub mode)
- `OPENAI_API_KEY` — fallback provider
- `DEEPSEEK_API_KEY` — second fallback
- `SESSION_HASH_SECRET` — audit-chain HMAC key (required)
- `PRIVACY_BUDGET_EPSILON` — DP budget for cohort-signal queries
- `ENCRYPTION_MASTER_KEY` — for tenant-scoped DEK derivation

Full env reference: `.env.example`.

## Testing

```bash
pnpm -F @borjie/central-intelligence test
pnpm -F @borjie/central-intelligence test:coverage
```

Test categories:

- Unit: per-module logic with mocked LLMs
- Integration: full kernel turn with stubbed providers
- Replay: re-runs from `decision-trace.ts` payloads (deterministic)

## Related

- `Docs/ARCHITECTURE_CENTRAL_COMMAND.md` — system view
- `Docs/ARCHITECTURE_BRAIN.md` — earlier high-level architecture
- `.planning/RUNBOOK.md` — kernel boot + smoke
- `Docs/RUNBOOKS/four-eye-approval-review.md`
- `Docs/RUNBOOKS/cron-supervisor-debug.md`
