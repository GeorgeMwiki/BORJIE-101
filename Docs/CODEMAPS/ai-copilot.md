# AI-Copilot Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/ai-copilot/`
**Public entry:** `packages/ai-copilot/src/index.ts`
**Tier scope:** all (tier inferred from caller context)

## Purpose

The application-level copilot layer above the central-intelligence
kernel. Owns personas, prompts, knowledge graphs, copilot workflows
(maintenance triage, churn risk, occupancy health, arrears risk,
property grading, rent-credit building), governance (autonomy, audit
trail, four-eye), security (PII scrubbers, prompt-injection guards),
and the always-on "ambient brain" + proactive-loop.

## Entry points

- `createAICopilot({ openai })` — `src/ai-copilot.ts` (main facade;
  `triageMaintenance`, `predictArrearsRisk`, etc.).
- `brain.ts` — singular-intelligence wrapper above the kernel.
- `cost-ledger.ts` — token / cost accounting.
- Configurable via `config/index.ts`.

## Internal structure

- `personas/` — 8 personas matching kernel identity.ts.
- `prompts/` — versioned prompt library (governed; immutable per
  version, like LITFIN model registry).
- `orchestrator/`, `orchestrators/`, `task-agents/`, `workflows/`.
- `predictions/` — arrears, churn, occupancy, maintenance recurrence
  scorers.
- `proactive-insights/`, `proactive-loop/`, `ambient-brain/`,
  `background-intelligence/`.
- `property-grading/`, `rent-credit-building/`, `risk-recompute/`,
  `org-awareness/`, `progressive-intelligence/`.
- `security/` — PII scrubbers, prompt-injection guards.
- `governance/` — autonomy + audit-trail + approval-grants +
  autonomy-caps.
- `agent-certification/`, `learning-engine/`, `learning-journeys/`,
  `learning-loop/`.
- `memory/`, `dp-memory/`, `eval/`, `shadow-mode/`, `skills/`,
  `voice/`, `voice-persona-dna/`, `multi-script-harness/`.
- `document-analysis/`, `estate-glossary/`, `credit-rating/`,
  `classroom/`, `onboarding/`, `branding/`, `graph-signals/`,
  `conversation-state/`, `thread/`, `training/`.

## Dependencies

- Upstream: `services/api-gateway`, `services/document-intelligence`,
  workers.
- Downstream: `packages/central-intelligence` (kernel), Anthropic +
  OpenAI providers (`providers/`), `packages/database` (AI semantic
  memory, AI audit chain, AI intelligence feedback, AI cost).

## Common workflows

- **Triage a maintenance request** → `copilot.triageMaintenance(input,
  tenant, actor, context)` → routes through kernel with
  `MAINTENANCE_TRIAGE` persona → returns ranked actions + confidence.
- **Predict arrears risk** → `predictions/arrears-risk` consumes
  ledger + lease features; output appended (not replacing) rule-based
  collections scoring.
- **Run nightly proactive insights** → `proactive-loop/` runs cron;
  ambient-brain emits hints via `proactive-insights/` → surfaced
  through `chat-ui` ProactiveHint.
- **Add a prompt** → ship a new versioned file under `prompts/v.../`;
  never edit a shipped version.
- **Audit a copilot decision** → `audit-trail/` writes to
  `ai_audit_chain` (hash-chained, see migration in `packages/database`).

## Anti-patterns to avoid

- Never edit a shipped prompt version — append a new version.
- Never bypass `security/pii-scrubber` on user-facing output —
  PII-leak risk.
- Never call Anthropic/OpenAI directly from app code — go through
  the copilot or kernel; otherwise cost-ledger + audit + autonomy
  are bypassed.
- Predictions APPEND to rule-based decisions — never replace.
- Persona prompts are not user-overridable — branded persona is
  applied through `branding/`.

## Related codemaps

- [central-intelligence.md](./central-intelligence.md) — kernel
- [api-gateway.md](./api-gateway.md) — wires the copilot
- [observability.md](./observability.md) — audit + eval
- [database.md](./database.md) — AI tables
