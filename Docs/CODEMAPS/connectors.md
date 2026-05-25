# Connectors Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/connectors/`
**Public entry:** `packages/connectors/src/index.ts`
**Tier scope:** platform spine (external-system adapters)

## Purpose

The unified adapter layer for external systems — payment providers
(M-Pesa, Stripe, Flutterwave), KYC providers, identity registries,
LPMS imports, SMS gateways. Every concrete adapter implements
`BaseConnector` so the orchestrator can apply uniform retry,
circuit-breaker, audit-emit, and health-scheduler behaviour around
each. In-memory event + audit sinks ship for tests; production wires
the real `@borjie/observability` sinks.

## Entry points

- `src/index.ts` — barrel.
- `src/base-connector.ts` — `BaseConnector`, `ConnectorAuth`,
  `ConnectorConfig`, `ConnectorRequest`, `ConnectorOutcome`,
  `ConnectorEvent`, `CircuitHealth`, `AuditSink`,
  `ConnectorEventSink`.
- `src/orchestrator.ts` — wraps a connector with resilience.
- `src/registry.ts` — discoverable connector registry.
- `src/health-scheduler.ts` — periodic health probes.
- `src/adapters/` — concrete adapters (e.g. M-Pesa).

## Internal structure

- `adapters/mpesa-adapter.ts` — `createMpesaAdapter()` +
  `InitiatePaymentInputSchema`.
- `in-memory-event-sink.ts`, `in-memory-audit-sink.ts` — test doubles.
- `__tests__/` — unit + contract tests.

## Dependencies

- Upstream: `@borjie/observability`, `@borjie/config`, zod,
  external provider SDKs.
- Downstream: services/payments, services/payments-ledger,
  api-gateway, mcp servers.

## Common workflows

- **Create a connector** → implement `BaseConnector`, register.
- **Wrap with orchestrator** → `orchestrator.wrap(connector)`.
- **Probe health** → `healthScheduler.run(connector)`.
- **Initiate a payment (M-Pesa)** →
  `createMpesaAdapter(deps).initiatePayment(input)`.

## Anti-patterns to avoid

- Never call a provider SDK directly from a service — go via adapter.
- Never bypass the audit sink — every outbound call emits.
- Never share a connector instance across tenants without scoping.
- Never log raw provider responses (may contain secrets).

## Related codemaps

- [payments-ledger.md](./payments-ledger.md) — primary consumer
- [observability.md](./observability.md) — audit + metrics
- [enterprise-hardening.md](./enterprise-hardening.md) — circuit breaker
