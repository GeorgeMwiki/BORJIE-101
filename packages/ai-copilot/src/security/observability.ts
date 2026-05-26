/**
 * BORJIE AI security observability — Wave-11 AI security hardening.
 *
 * Thin, dependency-free structured-logging layer. Every security decision
 * (allow / block / redact) is emitted as a SecurityEvent with a trace id so
 * downstream exporters (OpenTelemetry, Supabase log sinks, stderr) can wire
 * it up.
 *
 * Zero-cost when no collectors are registered.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SecurityDecision = 'allow' | 'block' | 'redact' | 'observe';

export type SecurityStage =
  | 'prompt_shield'
  | 'pii_scrub'
  | 'tenant_isolation'
  | 'cost_breaker'
  | 'output_guard'
  | 'canary'
  | 'audit_chain'
  | 'owasp_compliance';

export interface SecurityEvent {
  readonly traceId: string;
  readonly tenantId: string;
  readonly sessionId?: string | undefined;
  readonly turnId?: string | undefined;
  readonly stage: SecurityStage;
  readonly decision: SecurityDecision;
  readonly reason?: string | undefined;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly emittedAt: string;
}

export type SecurityEventCollector = (event: SecurityEvent) => void;

export interface SecurityObservability {
  emit(partial: Omit<SecurityEvent, 'traceId' | 'emittedAt'> & { traceId?: string }): SecurityEvent;
  registerCollector(collector: SecurityEventCollector): () => void;
  collectors(): readonly SecurityEventCollector[];
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface ObservabilityDeps {
  readonly idGenerator?: () => string;
  readonly now?: () => Date;
}

export function createSecurityObservability(
  deps: ObservabilityDeps = {},
): SecurityObservability {
  const genId =
    deps.idGenerator ??
    (() => `trace_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  const now = deps.now ?? (() => new Date());
  const collectors: SecurityEventCollector[] = [];

  return {
    emit(partial) {
      const event: SecurityEvent = {
        traceId: partial.traceId ?? genId(),
        emittedAt: now().toISOString(),
        tenantId: partial.tenantId,
        sessionId: partial.sessionId,
        turnId: partial.turnId,
        stage: partial.stage,
        decision: partial.decision,
        reason: partial.reason,
        metadata: partial.metadata ?? {},
      };
      for (const c of collectors) {
        try {
          c(event);
        } catch {
          // Observability must never throw into the caller.
        }
      }
      return event;
    },
    registerCollector(collector) {
      collectors.push(collector);
      return () => {
        const idx = collectors.indexOf(collector);
        if (idx >= 0) collectors.splice(idx, 1);
      };
    },
    collectors() {
      return [...collectors];
    },
  };
}

/**
 * Convenience collector that pushes events onto an array. Handy for tests.
 */
export function createCaptureCollector(): {
  readonly collector: SecurityEventCollector;
  readonly events: readonly SecurityEvent[];
} {
  const buf: SecurityEvent[] = [];
  return {
    collector: (e) => {
      buf.push(e);
    },
    get events() {
      return [...buf];
    },
  };
}
