# ADR 0003 — Inngest + Temporal coexistence

- **Status:** Accepted
- **Date:** 2026-Q1 (backfilled 2026-05-18)

## Context

Borjie's durable-execution surface spans two distinct shapes:

1. **Short, event-driven, retry-friendly** — agency-run dispatch,
   webhook fan-out, notification dispatch, consolidation runner ticks,
   wake-loop triggers. Typical run ≤ 30s. Failure model: retry the
   whole step on transient error; idempotency key on the action.

2. **Long-running, multi-day, regulated, destructive** — KRA/MRI
   tenant-data export, evictions, payouts, monthly-close end-to-end.
   Typical run: hours to weeks. Failure model: deterministic replay
   from event history; compensation steps when steps fail mid-flow.

A single tool tried to do both — neither shape was well served. We
needed both Inngest's developer ergonomics (functions, steps,
deterministic retries) AND Temporal's depth (versioning, sticky
workers, native saga compensation).

## Decision

Run both, with a sharp delineation:

- **Inngest** is the primary durable workflow engine. Default for
  every new background job. TypeScript-first router pattern.
- **Temporal** handles the destructive 5%: KRA-MRI file extraction,
  eviction workflow, payout disbursement batch. Workflows live in
  their own packages and never share state with Inngest beyond
  outbox events.

The boundary is enforced by code review: any new Temporal workflow
needs an ADR or a documented justification.

## Consequences

**Positive:**

- Each tool used for what it's strongest at.
- Inngest's local-dev experience is excellent — engineers iterate fast.
- Temporal's deterministic replay + versioning protects money-moving
  flows from drift bugs.
- Cross-talk via the outbox + event bus keeps the two coordinated
  without leaking implementation details.

**Negative:**

- Two operational surfaces to monitor.
- Engineers need to know both tools (we have onboarding docs).
- Cost: two managed services (or two self-hosted clusters).

## Alternatives considered

| Option | Why rejected |
|---|---|
| Inngest only | Long-running deterministic replay is not its sweet spot |
| Temporal only | Operational complexity for every small job; DX too heavy |
| BullMQ only | No deterministic replay; we'd have to build it |
| AWS Step Functions | Vendor lock-in; visual editor doesn't fit our codebase |

## References

- `services/api-gateway/src/composition/background-wiring.ts`
- `Docs/ARCHITECTURE_CENTRAL_COMMAND.md`
- `Docs/RUNBOOKS/cron-supervisor-debug.md`
