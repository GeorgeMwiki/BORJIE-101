# Workforce Orchestrator Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/workforce-orchestrator/`
**Public entry:** `packages/workforce-orchestrator/src/index.ts`
**Tier scope:** cognitive core (Piece M — agentic workforce management)

## Purpose

Piece M of the master plan. The brain literally manages an estate
company's employees with HITL gates. Wired across nine database tables
(`employees`, `work_assignments`, `work_followups`, `work_check_ins`,
`performance_signals`, `advisory_briefs`, `skill_assessments`,
`coaching_prompts`, `workforce_kpis`) created by migrations
`0241_employees.sql` .. `0250_workforce_indexes.sql`.

The orchestrator does six things:

1. **Assigns** tasks (`work_assignments`) to T4-employees on behalf of
   T3-managers or T2-DG with kernel-derived risk_tier + HITL flag.
2. **Schedules followups** at risk-aware cadence (daily / mid_week /
   end_of_week / one_shot) and dispatches them through the
   notifications service via `ChannelAdapter`.
3. **Receives check-ins** from employees, runs Haiku-cascade
   sentiment analysis, updates the parent assignment status, and emits
   observable performance signals.
4. **Tracks performance** via weighted signals
   (`performance_signals`) and per-employee skill rollups
   (`skill_assessments`).
5. **Escalates** stuck or overdue assignments to T3-managers via the
   tickets table (soft pointer until Pieces D+F land).
6. **Advises** managers through weekly `advisory_briefs` (HITL-gated)
   and per-employee `coaching_prompts` (HITL-gated when disciplinary).

Every AI-written artefact is hash-chained into `ai_audit_chain`.

## Entry points

- `src/index.ts` — barrel.
- `src/types.ts` — Zod schemas + DAL port + composition surface.
- `src/assign-task.ts` — `assignTask(deps, input)` — primary entrypoint.
- `src/followup-scheduler.ts` — `runFollowupSchedulerOnce(deps,
  tenantId)` + `sweepMissedFollowups(...)`.
- `src/check-in-receiver.ts` — `receiveCheckIn(deps, input)`.
- `src/sentiment-analyzer.ts` — `runSentimentAnalysis(deps, args)`.
- `src/performance-tracker.ts` — `runPerformanceTracker(...)`,
  `emitManualSignal(...)`, `runDeadlineMissAudit(...)`.
- `src/escalation-rules.ts` — `runEscalationOnce(deps, tenantId)`.
- `src/coaching-generator.ts` — `generateCoachingPrompt(...)`,
  `autoTriggerCoaching(...)`, `mentionsDisciplinaryLanguage(...)`.
- `src/advisory-brief-engine.ts` — `generateAdvisoryBrief(...)`,
  `rollupStats(...)`.
- `src/skill-inferrer.ts` — `runSkillInferrer(...)`, `sigmoid(...)`,
  `bucketBySkill(...)`, `SKILL_MAP`.

## Internal structure

```
src/
├── index.ts                     — barrel
├── types.ts                     — schemas + ports + DI surface
├── assign-task.ts               — task assignment + risk derivation
├── followup-scheduler.ts        — cron-driven dispatch + missed sweep
├── check-in-receiver.ts         — inbound reply handler
├── sentiment-analyzer.ts        — heuristic → kernel cascade
├── performance-tracker.ts       — observable signal emitter
├── escalation-rules.ts          — blocker/overdue → ticket bridge
├── coaching-generator.ts        — auto coaching + HITL gate
├── advisory-brief-engine.ts     — weekly roll-up briefs
├── skill-inferrer.ts            — signals → skill graph (sigmoid)
└── __tests__/
    ├── fixtures.ts              — in-memory ports + fixture helpers
    ├── assign-task.test.ts
    ├── followup-scheduler.test.ts
    ├── check-in-receiver.test.ts
    ├── sentiment-analyzer.test.ts
    ├── performance-tracker.test.ts
    ├── escalation-rules.test.ts
    ├── coaching-generator.test.ts
    ├── advisory-brief-engine.test.ts
    ├── skill-inferrer.test.ts
    └── integration.test.ts      — full assign→escalate loop
```

## Dependency injection

Every orchestrator entrypoint takes a `WorkforceDeps` bundle. The five
ports:

- `WorkforceStore` — DAL over the 9 tables; production wires Drizzle,
  tests wire `InMemoryStore`.
- `ChannelAdapter` — `services/notifications/` bridge (WhatsApp / SMS
  / web / mobile).
- `AuditChain` — appends to `ai_audit_chain` (hash-chained, append-only).
- `ContentGenerator` — Haiku-cascade content generation for sentiment,
  coaching, advisory drafts. Wires to `central-intelligence` /
  `ai-copilot`.
- `TicketCreator` — Pieces D+F tickets table (soft pointer; composition
  root resolves once those land).

Plus `clock()` and `uuid()` for determinism.

## Dependencies

- Upstream: `@borjie/central-intelligence` (kernel for
  sentiment + coaching + advisory drafts), `@borjie/ai-copilot`
  (persona scoping), `@borjie/observability` (audit chain),
  `services/notifications` (channel adapter), Pieces D+F `tickets`
  table (soft pointer).
- Downstream: `services/api-gateway` (composition root wires
  routes), `apps/estate-manager-app` (T3 UI), `apps/owner-portal`
  (T1/T2 advisory feed).

## Common workflows

- **Assign a task** →
  `assignTask(deps, { tenantId, title, description, assignedEmployeeId,
  assignedByUserId, priority, dueAt })`. Returns the `work_assignment`
  row, the followup ids, and whether the kick-off notification went
  out. Kernel-derived `risk_tier` + `hitl_required`.

- **Run the followup cron** →
  `runFollowupSchedulerOnce(deps, tenantId)` reads due rows,
  dispatches notifications, flips status → `sent`. Followed by
  `sweepMissedFollowups(deps, tenantId)` to flip stale `sent` →
  `missed` and emit synthetic `no_response` check-ins.

- **Receive an employee reply** →
  `receiveCheckIn(deps, { tenantId, assignmentId, employeeId,
  responseKind, responseText })`. Auto-runs sentiment, updates parent
  assignment status, emits performance signals, flips the parent
  followup → `responded`.

- **Generate coaching** →
  `autoTriggerCoaching(deps, { tenantId, employeeId })` scans recent
  signals and emits one prompt per crossed threshold. Disciplinary
  language → `status='pending'` (HITL).

- **Weekly advisory brief** →
  `generateAdvisoryBrief(deps, { tenantId, audiencePersonaId,
  periodStart, periodEnd })`. Always HITL — caller must confirm
  before broadcast.

- **Daily KPI roll-up** — caller wires
  `WorkforceStore.upsertKpi(row)` from the assignment status state
  machine or a nightly cron.

## HITL gates (canonical list)

- `risk_tier='HIGH'` or `risk_tier='SOVEREIGN'` → `hitl_required=true`
  on the `work_assignment` (the API gateway enforces).
- `coaching_prompts.prompt_text` mentions terminate / fire / dismiss
  / demote / write-up / PIP / final warning → `status='pending'`
  (manager must flip to `sent`).
- `advisory_briefs` — always require manager confirmation before
  broadcast to T1/T2.

## Anti-patterns to avoid

- **Never trust caller-supplied `risk_tier`** — `deriveRiskTier()`
  may escalate upward but never downward.
- **Never insert into `work_check_ins` directly** — the
  check-in-receiver runs sentiment + signal emission + audit append.
- **Never bypass the channel adapter** for follow-up dispatch — it
  carries delivery telemetry the SLO board depends on.
- **Never mutate domain rows in place** — return fresh objects from
  every transformation; the DAL is the only mutator.
- **Never skip the audit append** when writing an
  `advisory_brief`, `coaching_prompt`, or HIGH-risk
  `work_assignment` — the hash chain must be unbroken.
- **Never call `inferSentiment` synchronously in the hot path** —
  it's a kernel round-trip; the heuristic catches >80% of cases.

## Related codemaps

- [database.md](./database.md) — migrations 0241-0250
- [central-intelligence.md](./central-intelligence.md) — kernel for
  sentiment + coaching + advisory content
- [ai-copilot.md](./ai-copilot.md) — personas + few-shots
- [notifications-service.md](./notifications-service.md) — channel
  adapter target
- [agent-platform.md](./agent-platform.md) — idempotency for the
  followup-scheduler dispatch path
- [observability.md](./observability.md) — `ai_audit_chain` writer
