# Observability Conventions

Every BORJIE service wires three cross-cutting concerns via `@borjie/observability`:

## 1. Logger — tenant-scoped

```ts
import { createLogger } from '@borjie/observability'

const log = createLogger({
  service: 'payments',
  // orgId is attached per-request via a child logger
})

// Per request:
const reqLog = log.child({ orgId, requestId })
reqLog.info('payment.received', { provider, amount, currency })
```

**Required context keys** on every log line originating from a request path: `orgId`, `requestId`, `service`. Job workers add `jobId`.

## 2. Metrics — platform registry

Always pull metric definitions from `PLATFORM_METRICS` in `@borjie/observability` to keep names consistent. When adding a new metric, extend `PLATFORM_METRICS` rather than defining ad-hoc counters.

Core registry:

| Metric | Used by |
|--------|---------|
| `HTTP_REQUESTS_TOTAL`, `HTTP_REQUEST_DURATION` | api-gateway middleware |
| `PAYMENTS_TOTAL`, `PAYMENT_AMOUNT` | payments, payments-ledger |
| `NOTIFICATIONS_SENT`, `NOTIFICATION_LATENCY` | notifications |
| `LLM_CALLS_TOTAL`, `LLM_TOKENS_TOTAL`, `LLM_LATENCY` | ai-copilot, any persona callsite |
| `DOCUMENTS_RENDERED` | domain-services document renderers |
| `MAINTENANCE_REQUESTS`, `MAINTENANCE_RESOLUTION_TIME` | domain-services, work orders |
| `AUTH_ATTEMPTS`, `ACTIVE_SESSIONS` | identity |
| `AUDIT_EVENTS` | any write path |
| `ERROR_COUNT` | every service (top-level error handler) |

## 3. Trace spans — naming convention

Format: `<service>.<domain>.<operation>`

Examples:

- `payments.mpesa.stk-push`
- `payments-ledger.post-entry`
- `notifications.dispatch`
- `identity.otp.verify`
- `ai-copilot.persona.negotiation.run`
- `domain-services.inspections.move-out.finalize`
- `api-gateway.<resource>.<verb>` (auto-instrumented by middleware)

**Required span attributes**: `SpanAttributes.TENANT_ID`, `SpanAttributes.REQUEST_ID`. Add `USER_ID` when the span runs inside an authenticated request.

## Service checklist

When creating or auditing a service, confirm:

- [ ] Top-level `createLogger({ service: '<name>' })` instantiated once.
- [ ] Every request/job handler creates a child logger with `orgId` + `requestId`.
- [ ] Top-level error handler increments `ERROR_COUNT` and logs with context.
- [ ] External calls (DB writes, HTTP to third-party providers, LLM invocations) wrapped in a named span.
- [ ] Counters incremented for domain events the service emits.
- [ ] Dashboards / alerts reference metric names from `PLATFORM_METRICS`.

## Services currently wired

| Service | Logger | Metrics | Tracing |
|---------|--------|---------|---------|
| api-gateway | yes | yes | yes |
| payments-ledger | yes | partial | partial |
| reports | yes (worker) | partial | partial |
| payments | yes | needs wiring | needs wiring |
| notifications | needs wiring | needs wiring | needs wiring |
| identity | needs wiring | needs wiring | needs wiring |
| domain-services | needs wiring | needs wiring | needs wiring |
| document-intelligence | needs wiring | needs wiring | needs wiring |
| webhooks | needs wiring | needs wiring | needs wiring |

Tracked under `Docs/TODO_BACKLOG.md` for per-service wiring tickets.
