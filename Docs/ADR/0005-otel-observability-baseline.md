# ADR 0005 — OpenTelemetry observability baseline

- **Status:** Accepted
- **Date:** 2026-Q1 (backfilled 2026-05-18)

## Context

Borjie ships a brain that traverses many providers + many
services per turn. Per-turn cost, latency, drift, and quality must
all be measurable. Three categories of signal:

1. **Operational telemetry** — request latency, error rate, throughput
2. **AI-specific telemetry** — token counts, provider cascade hops,
   tool-call traces, judge verdicts
3. **Product telemetry** — feature adoption, funnel completion

Each category historically had its own tool:

| Category | Common tool |
|---|---|
| Operational | Datadog, NewRelic, Sentry |
| AI-specific | Helicone, LangSmith, Phoenix, Langfuse |
| Product | PostHog, Mixpanel, Amplitude |

Buying three SaaS at our stage was untenable. We needed a unified
substrate.

## Decision

Adopt OpenTelemetry (OTel) as the wire format for all three
categories. Use OTel GenAI semantic conventions for AI-specific
spans (tokens, provider, tool name, judge verdict).

Concrete stack:

- **Instrumentation:** `@opentelemetry/sdk-node` in every service
- **Collector:** OTel collector (self-hosted), fan-outs configured
- **Operational backend:** Sentry (errors) + a future
  Datadog/Tempo (traces) — current state is direct-to-Sentry via OTLP
- **AI backend:** Langfuse (self-hosted) + Arize Phoenix (eval)
- **Product backend:** PostHog (autocapture + custom events)

Each span carries:

- `tenant.id` (PII-safe — tenant id is opaque)
- `user.id.hash` (HMAC of user id, never raw)
- `trace.id` propagated from inbound HTTP → kernel → outbound webhooks
- For GenAI spans: `gen_ai.system`, `gen_ai.request.model`,
  `gen_ai.usage.*`, `gen_ai.response.id`

Helicone is excluded — went to maintenance mode early 2026.

## Consequences

**Positive:**

- Single wire format means swapping backends is a config change, not
  a code change.
- AI-specific GenAI semconv is becoming the industry standard.
- Cost-attribution per tenant is built-in via the `tenant.id`
  attribute — direct query against any backend.
- Local dev can run a collector + Phoenix in Docker for full
  fidelity testing.

**Negative:**

- OTel collector ops adds a service to monitor.
- GenAI semconv is still evolving; field names may shift.
- Some SDKs (especially around streamed responses) require manual
  span management.

## Alternatives considered

Helicone was the easiest to ship but its acquisition + maintenance
status killed momentum. LangSmith requires LangChain — we use Claude
Agent SDK directly. Direct PostHog autocapture without OTel was
considered but the AI-specific data wouldn't unify with traces.

## References

- `packages/observability/`
- `Docs/PERFORMANCE.md`
- `.env.example` § X (Sentry + PostHog)
- `Docs/ARCHITECTURE_CENTRAL_COMMAND.md` § OTel + Phoenix audit fabric
