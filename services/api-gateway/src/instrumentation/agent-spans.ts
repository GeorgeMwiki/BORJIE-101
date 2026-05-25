/**
 * Agent-span instrumentation helpers.
 *
 * Wraps the four wave-3 AI-agent factories (monthly-close, voice,
 * market-surveillance, predictive-interventions) in a thin
 * `withAgentSpan(...)` helper that:
 *
 *   1. opens a canonical `agent.<name>.<operation>` OpenTelemetry span,
 *   2. records duration in a histogram and call-count in a counter
 *      (both per-agent), so operators can see latency and error rate in
 *      Prometheus,
 *   3. tags errors onto the span and bumps an
 *      `agent_<name>_errors_total` counter,
 *   4. surfaces a `recordDegraded(...)` helper that bumps the platform's
 *      `agent_port_degraded_total` counter so dashboards can flag a
 *      port running in degraded-stub mode.
 *
 * The helpers are designed to be a no-op when telemetry is not
 * configured — `metrics.getMeter` returns a no-op meter pre-init, and
 * `trace.getTracer` returns a no-op tracer until the SDK starts. That
 * keeps the wirings cheap to test (no SDK boot required) and keeps the
 * production hot-path lock-free.
 *
 * Cardinality discipline:
 *   - `agent` is a bounded enum (4 known values).
 *   - `operation` is a small bounded set per agent.
 *   - `tenant_id` is recorded as a SPAN attribute (high-cardinality
 *     traces are fine) but NEVER as a counter label.
 *   - `port` and `reason` on `recordDegraded` are bounded enums.
 *
 * No PII or secrets are ever recorded — only ids, op names, and the
 * structured `degraded_reason` enum.
 */

import {
  metrics,
  trace,
  SpanKind,
  SpanStatusCode,
  type Counter,
  type Histogram,
  type Meter,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

const TRACER_NAME = 'borjie.api-gateway.agents';
const METER_NAME = 'borjie.api-gateway.agents';
const METER_VERSION = '1.0.0';

/**
 * The four agents this module knows about. Bounded so counter
 * cardinality is fixed.
 */
export type AgentName =
  | 'monthly-close'
  | 'voice-agent'
  | 'market-surveillance'
  | 'predictive-interventions';

/**
 * Optional context recorded on the span. None of these fields turn
 * into counter labels — they are span attributes only, so they can
 * carry per-tenant identifiers without exploding Prometheus cardinality.
 */
export interface AgentSpanContext {
  readonly tenantId?: string | null;
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

interface AgentMetricsHandle {
  readonly meter: Meter;
  readonly callDuration: Histogram;
  readonly callTotal: Counter;
  readonly callErrors: Counter;
  readonly portDegraded: Counter;
}

let handle: AgentMetricsHandle | null = null;

/**
 * Lazy-build the per-agent meter handle. Built once per process; safe
 * to call from any hot path because OTel's no-op meter is itself a
 * lock-free constant when the SDK is not initialised.
 */
function getHandle(): AgentMetricsHandle {
  if (handle) return handle;
  const meter = metrics.getMeter(METER_NAME, METER_VERSION);
  handle = {
    meter,
    callDuration: meter.createHistogram('agent.call.duration_ms', {
      description: 'Duration of an agent operation in milliseconds',
      unit: 'ms',
    }),
    callTotal: meter.createCounter('agent.call.total', {
      description: 'Total agent operations executed',
    }),
    callErrors: meter.createCounter('agent.call.errors_total', {
      description: 'Total agent operations that threw an error',
    }),
    portDegraded: meter.createCounter('agent_port_degraded_total', {
      description:
        'Total times an agent port fell back to its degraded-stub mode',
    }),
  };
  return handle;
}

function getAgentTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

/**
 * Build the canonical span name for an agent operation.
 */
export function agentSpanName(
  agentName: AgentName,
  operation: string,
): string {
  return `agent.${agentName}.${operation}`;
}

/**
 * Wrap a Promise-returning function in an OpenTelemetry span tagged
 * with the agent name + operation. Records duration + counter on
 * success, and on error annotates the span and bumps the per-agent
 * error counter before re-throwing. Always re-throws so callers'
 * error semantics are unchanged.
 */
export async function withAgentSpan<T>(
  agentName: AgentName,
  operation: string,
  fn: (span: Span) => Promise<T>,
  context?: AgentSpanContext,
): Promise<T> {
  const tracer = getAgentTracer();
  const metricsHandle = getHandle();
  const spanName = agentSpanName(agentName, operation);

  const baseAttributes: Record<string, string | number | boolean> = {
    'agent.name': agentName,
    'agent.operation': operation,
  };
  if (context?.tenantId) {
    baseAttributes['tenant_id'] = context.tenantId;
  }
  if (context?.attributes) {
    for (const [k, v] of Object.entries(context.attributes)) {
      baseAttributes[k] = v;
    }
  }

  const counterLabels = {
    agent: agentName,
    operation,
  };

  return tracer.startActiveSpan(
    spanName,
    {
      kind: SpanKind.INTERNAL,
      attributes: baseAttributes,
    },
    async (span) => {
      const startedAt = Date.now();
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        metricsHandle.callTotal.add(1, { ...counterLabels, outcome: 'ok' });
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (error instanceof Error) {
          span.recordException(error);
        }
        span.setStatus({ code: SpanStatusCode.ERROR, message });
        metricsHandle.callTotal.add(1, { ...counterLabels, outcome: 'error' });
        metricsHandle.callErrors.add(1, counterLabels);
        throw error;
      } finally {
        const durationMs = Date.now() - startedAt;
        metricsHandle.callDuration.record(durationMs, counterLabels);
        span.end();
      }
    },
  );
}

/**
 * Bump the `agent_port_degraded_total` counter so dashboards can
 * surface ports running in degraded-stub mode (e.g. monthly-close's
 * autonomy port falling back to safe defaults, voice-agent's brain
 * stub when the kernel is not wired, market-surveillance's
 * not-configured comparables stub).
 */
export function recordDegraded(
  agentName: AgentName,
  port: string,
  reason: string,
): void {
  const metricsHandle = getHandle();
  metricsHandle.portDegraded.add(1, {
    agent: agentName,
    port,
    reason,
  });
}

/**
 * Reset the cached meter handle. Test-only — exported so unit tests can
 * re-build the meter against a fresh global meter provider between
 * runs. Not part of the production API surface (callers SHOULD NOT
 * import this in non-test code).
 */
export function __resetAgentMetricsHandleForTests(): void {
  handle = null;
}
