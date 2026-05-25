# Observability Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/observability/` + `evals/`
**Public entry:** `packages/observability/src/index.ts`
**Tier scope:** all (audit + traces are cross-cutting)

## Purpose

Cross-cutting telemetry, audit, eval, and red-team substrate. Three
layers: **audit** (typed events with hash-chained AI audit trail),
**telemetry** (Pino logs, OpenTelemetry traces + metrics, Sentry),
**eval** (online judge, decision-trace OTel, forecasting benchmark,
adversarial corpora). Every kernel decision and every money-path
event lands here.

## Entry points

- `audit-logger.ts` — fluent + simple function interface; writes
  `AuditEvent` with `category`, `outcome`, `severity`, `actor`,
  `target`.
- `event-bus.ts` — domain event bus with outbox pattern.
- `tracing/` — OTel SDK bootstrap (called from api-gateway
  `index.ts`).
- `metrics/` — OTel metrics + `PLATFORM_METRICS` registry.
- `logging/` — Pino logger factory.
- `sentry.ts` — error capture.
- `eval/` — online judge for sampled production traffic.
- `evals/forecasting-bench/` at repo root — `pnpm bench:forecast`.
- `health/` — `/healthz/dependencies` aggregator.
- `wrappers/` — service-side wrappers (auto-emit on call).

## Internal structure

- `types/` — `AuditEvent`, telemetry config, `LogLevel`,
  `MetricType`.
- `audit/` — audit query + sink + retention.
- `tracing/` — OTel exporter + propagator wiring.
- `metrics/` — metric registry + counters.
- `logging/` — Pino + redaction.
- `security/` — security event subset.
- `eval/` — online sampling + judge (mirror of LITFIN
  `online-sampler`).

## Dependencies

- Upstream: every service (api-gateway, payments-ledger, all workers,
  all MCP servers).
- Downstream: Postgres (`audit-events` + `ai-audit-chain` schemas),
  OTLP collector, Sentry, Pino sinks. Eval traffic samples from kernel.

## Common workflows

- **Emit an audit event** → `createAuditEvent({ category:
  AuditCategory.PAYMENT, outcome: AuditOutcome.SUCCESS, ... })`. Sink
  is wired by api-gateway composition.
- **Add an OTel span** → `tracer.startActiveSpan(name, fn)`. Kernel
  spans propagate via context.
- **Add a metric** → register in `PLATFORM_METRICS`; emit through
  `meter.createCounter(...)`.
- **Run online judge** → `eval/online-sampler` selects k random
  prod turns + replays judge prompt; persists score deltas.
- **Forecast benchmark** → `pnpm bench:forecast` runs
  `evals/forecasting-bench/run.ts`.
- **Red-team** → adversarial corpora at `evals/red-team/`; tool-call
  attacks + dialect set (mirror of LITFIN pattern).

## Anti-patterns to avoid

- Never `console.log` inside a service — use the Pino logger
  (hooks audit + redaction).
- Never log a webhook secret, API key, or raw JWT — Pino redaction
  paths configured in `logging/`.
- Never bypass the OTel bootstrap — it runs first in api-gateway
  `index.ts`; otherwise spans are dropped.
- AI audit chain is hash-chained; never mutate a row, only append.
- Sentry breadcrumbs must not include PII — use scrubbers.

## Related codemaps

- [api-gateway.md](./api-gateway.md) — wires OTel + audit sinks
- [central-intelligence.md](./central-intelligence.md) — decision
  trace
- [database.md](./database.md) — audit + AI audit chain schemas
- [ai-copilot.md](./ai-copilot.md) — cost ledger + eval
