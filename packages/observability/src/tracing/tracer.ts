/**
 * OpenTelemetry Tracer Setup
 * 
 * Configures distributed tracing for BORJIE services.
 * Provides span creation utilities with platform-specific context.
 */

import { createHash } from 'node:crypto';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_SERVICE_INSTANCE_ID,
} from '@opentelemetry/semantic-conventions';
// `deployment.environment.name` is the stable replacement for the
// legacy `deployment.environment` resource attribute. Pulled from the
// incubating module so older collectors still receive a recognisable
// key.
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating';
import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  propagation,
  Span,
  Tracer,
  Context,
} from '@opentelemetry/api';
import type { TelemetryConfig } from '../types/telemetry.types.js';
import { SpanAttributes } from '../types/telemetry.types.js';

let sdkInstance: NodeSDK | null = null;

/**
 * Initialize OpenTelemetry SDK
 */
export function initTracing(config: TelemetryConfig): NodeSDK {
  if (sdkInstance) {
    return sdkInstance;
  }

  if (!config.enabled) {
    // Return a no-op SDK
    sdkInstance = new NodeSDK({});
    return sdkInstance;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.service.name,
    [ATTR_SERVICE_VERSION]: config.service.version,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.service.environment,
    ...(config.service.instanceId && {
      [ATTR_SERVICE_INSTANCE_ID]: config.service.instanceId,
    }),
  });

  const traceExporter = config.traceExporter
    ? new OTLPTraceExporter({
        url: config.traceExporter.endpoint,
        headers: config.traceExporter.headers,
        timeoutMillis: config.traceExporter.timeoutMs,
      })
    : undefined;

  sdkInstance = new NodeSDK({
    resource,
    traceExporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-http': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-express': {
          enabled: true,
        },
        '@opentelemetry/instrumentation-pg': {
          enabled: true,
        },
      }),
    ],
  });

  sdkInstance.start();

  // Graceful shutdown
  process.on('SIGTERM', () => {
    sdkInstance
      ?.shutdown()
      .catch((error) => {
        // Shutdown is a process-terminating event; emit to stderr so
        // operators see why tracing failed to drain. Avoid console.log
        // (info-level) per coding style — only diagnostic on failure.
        process.stderr.write(
          `[observability] error terminating tracing: ${
            error instanceof Error ? error.message : String(error)
          }\n`
        );
      })
      .finally(() => process.exit(0));
  });

  return sdkInstance;
}

/**
 * Shutdown tracing SDK
 */
export async function shutdownTracing(): Promise<void> {
  if (sdkInstance) {
    await sdkInstance.shutdown();
    sdkInstance = null;
  }
}

/**
 * Get the tracer for a service
 */
export function getTracer(name: string, version?: string): Tracer {
  return trace.getTracer(name, version);
}

/**
 * Get the current active span
 */
export function getCurrentSpan(): Span | undefined {
  return trace.getSpan(context.active());
}

/**
 * Context for creating spans
 */
export interface SpanContext {
  /** Tenant ID */
  tenantId?: string;
  /** User ID */
  userId?: string;
  /** Request ID */
  requestId?: string;
  /** Additional attributes */
  attributes?: Record<string, string | number | boolean>;
}

/**
 * Options for creating spans
 */
export interface CreateSpanOptions {
  /** Span kind */
  kind?: SpanKind;
  /** Parent context */
  parentContext?: Context;
  /** Initial attributes */
  attributes?: Record<string, string | number | boolean>;
  /** Platform context */
  context?: SpanContext;
}

/**
 * Wrapper for executing code within a span
 */
export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  options: CreateSpanOptions,
  fn: (span: Span) => Promise<T>
): Promise<T> {
  const parentCtx = options.parentContext ?? context.active();
  
  return tracer.startActiveSpan(
    name,
    {
      kind: options.kind ?? SpanKind.INTERNAL,
      attributes: {
        ...options.attributes,
        ...(options.context?.tenantId && {
          [SpanAttributes.TENANT_ID]: options.context.tenantId,
        }),
        ...(options.context?.userId && {
          [SpanAttributes.USER_ID]: options.context.userId,
        }),
        ...(options.context?.requestId && {
          [SpanAttributes.REQUEST_ID]: options.context.requestId,
        }),
        ...options.context?.attributes,
      },
    },
    parentCtx,
    async (span) => {
      try {
        const result = await fn(span);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        if (error instanceof Error) {
          span.recordException(error);
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
        }
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

/**
 * Synchronous version of withSpan
 */
export function withSpanSync<T>(
  tracer: Tracer,
  name: string,
  options: CreateSpanOptions,
  fn: (span: Span) => T
): T {
  const parentCtx = options.parentContext ?? context.active();
  
  const span = tracer.startSpan(
    name,
    {
      kind: options.kind ?? SpanKind.INTERNAL,
      attributes: {
        ...options.attributes,
        ...(options.context?.tenantId && {
          [SpanAttributes.TENANT_ID]: options.context.tenantId,
        }),
        ...(options.context?.userId && {
          [SpanAttributes.USER_ID]: options.context.userId,
        }),
        ...(options.context?.requestId && {
          [SpanAttributes.REQUEST_ID]: options.context.requestId,
        }),
        ...options.context?.attributes,
      },
    },
    parentCtx
  );
  
  const ctx = trace.setSpan(parentCtx, span);
  
  return context.with(ctx, () => {
    try {
      const result = fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      if (error instanceof Error) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
      }
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Add tenant context to the current span
 */
export function setTenantContext(tenantId: string, tenantName?: string): void {
  const span = getCurrentSpan();
  if (span) {
    span.setAttribute(SpanAttributes.TENANT_ID, tenantId);
    if (tenantName) {
      span.setAttribute(SpanAttributes.TENANT_NAME, tenantName);
    }
  }
}

/**
 * Hash a user email for safe span emission. Uses `USER_HASH_SALT` from
 * the environment so an attacker who steals the trace store can't run
 * a rainbow-table lookup against the world's email corpus to deanonymise
 * the user. Returns the first 16 hex chars of `sha256(email + salt)` —
 * enough entropy to keep collision pressure negligible for cross-trace
 * correlation while being short enough to read in logs.
 *
 * Production posture: salt MUST be set. Without it we fall back to a
 * fixed redaction token so the raw email NEVER ships, but operators get
 * a clear signal that the salt is missing.
 *
 * Exported for unit-testability — pure function over (email, env).
 */
export function hashUserEmailForSpan(
  email: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const salt = (env.USER_HASH_SALT ?? '').trim();
  const nodeEnv = (env.NODE_ENV ?? '').trim().toLowerCase();
  if (!salt) {
    if (nodeEnv === 'production') {
      throw new Error(
        'USER_HASH_SALT must be configured in production before any OTel spans tag user emails',
      );
    }
    return '<email:redacted>';
  }
  return createHash('sha256')
    .update(`${email}${salt}`, 'utf8')
    .digest('hex')
    .slice(0, 16);
}

/**
 * Add user context to the current span. The email — if provided — is
 * hashed via {@link hashUserEmailForSpan} before it ever touches a span
 * attribute. Raw emails MUST NOT appear in trace storage; SOC 2 CC6.1.
 */
export function setUserContext(
  userId: string,
  email?: string,
  roles?: string[]
): void {
  const span = getCurrentSpan();
  if (span) {
    span.setAttribute(SpanAttributes.USER_ID, userId);
    if (email) {
      span.setAttribute(SpanAttributes.USER_EMAIL, hashUserEmailForSpan(email));
    }
    if (roles) {
      span.setAttribute(SpanAttributes.USER_ROLES, roles.join(','));
    }
  }
}

/**
 * Extract trace context from headers (for incoming requests)
 */
export function extractTraceContext(
  headers: Record<string, string | string[] | undefined>
): Context {
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value) {
      normalizedHeaders[key.toLowerCase()] = Array.isArray(value)
        ? value[0] ?? ''
        : value;
    }
  }
  return propagation.extract(context.active(), normalizedHeaders);
}

/**
 * Inject trace context into headers (for outgoing requests)
 */
export function injectTraceContext(
  headers: Record<string, string>
): Record<string, string> {
  propagation.inject(context.active(), headers);
  return headers;
}

// ─────────────────────────────────────────────────────────────────────
// Langfuse-conventioned span helpers (Phase D D6)
//
// Adapter-agnostic helpers so any code path can emit OTel spans that
// Langfuse will recognise. We never depend on the `langfuse` SDK at
// build time — the `langfuse-adapter.ts` lazy-imports the SDK when
// `LANGFUSE_HOST` / `LANGFUSE_BASEURL` is set. These helpers attach the
// standard Langfuse attribute conventions on the active OTel span;
// when no Langfuse collector is configured the attributes are
// harmless noise that downstream OTel collectors ignore.
// ─────────────────────────────────────────────────────────────────────

/** Recognised Langfuse observation types. */
export type LangfuseObservationKind =
  | 'generation'
  | 'tool-call'
  | 'retrieval'
  | 'span';

/** Typed attribute payload for a Langfuse-conventioned span. */
export interface LangfuseSpanAttributes {
  readonly traceName?: string;
  readonly userId?: string;
  readonly tenantId?: string;
  readonly sessionId?: string;
  readonly environment?: string;
  readonly modelName?: string;
  readonly usage?: Record<string, unknown>;
  readonly level?: 'DEBUG' | 'DEFAULT' | 'WARNING' | 'ERROR';
  readonly metadata?: Record<string, unknown>;
  readonly raw?: Record<string, string | number | boolean>;
}

/**
 * Map a Langfuse-recognised kind to the canonical
 * `langfuse.observation.type` attribute value. Langfuse only recognises
 * `'generation'` and `'span'` natively; tool-call / retrieval are
 * collapsed to `'span'` and the original kind is preserved via the
 * `langfuse.observation.metadata.borjie_kind` attribute.
 */
export function mapLangfuseObservationType(
  kind: LangfuseObservationKind,
): 'generation' | 'span' {
  return kind === 'generation' ? 'generation' : 'span';
}

/**
 * Build a Langfuse-attribute key/value record from a typed payload.
 * Pure function — used to set attributes on a fresh span AND to
 * round-trip via tests without touching the OTel span machinery.
 */
export function buildLangfuseSpanAttributes(
  kind: LangfuseObservationKind,
  attrs: LangfuseSpanAttributes,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {
    'langfuse.observation.type': mapLangfuseObservationType(kind),
  };
  // Preserve the original kind for non-span types so Langfuse-side
  // queries can still distinguish tool-call vs retrieval.
  if (kind !== 'span') {
    out['langfuse.observation.metadata.borjie_kind'] = kind;
  }
  if (attrs.traceName) out['langfuse.trace.name'] = attrs.traceName;
  if (attrs.userId) out['langfuse.user.id'] = attrs.userId;
  if (attrs.tenantId) out['langfuse.tenant.id'] = attrs.tenantId;
  if (attrs.sessionId) out['langfuse.session.id'] = attrs.sessionId;
  if (attrs.environment) out['langfuse.environment'] = attrs.environment;
  if (attrs.modelName) out['langfuse.observation.model.name'] = attrs.modelName;
  if (attrs.usage) {
    try {
      out['langfuse.observation.usage_details'] = JSON.stringify(attrs.usage);
    } catch {
      // ignore unserialisable usage
    }
  }
  if (attrs.level) out['langfuse.observation.level'] = attrs.level;
  if (attrs.metadata) {
    for (const [k, v] of Object.entries(attrs.metadata)) {
      if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        typeof v === 'boolean'
      ) {
        out[`langfuse.observation.metadata.${k}`] = v;
      } else {
        try {
          out[`langfuse.observation.metadata.${k}`] = JSON.stringify(v);
        } catch {
          // ignore unserialisable metadata key
        }
      }
    }
  }
  if (attrs.raw) {
    for (const [k, v] of Object.entries(attrs.raw)) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Emit a span tagged with Langfuse attribute conventions. Wraps
 * `tracer.startActiveSpan` so callers don't have to manage span
 * lifecycle. The `fn` receives the live span so callers can
 * record events / set status / add custom attrs. Span ended
 * automatically on resolve OR reject (records exception + sets ERROR
 * status on reject). When `attrs.traceName` is absent we stamp the
 * span name into `langfuse.trace.name` so Langfuse always has a trace
 * label.
 */
export function emitLangfuseSpan<T>(
  tracer: Tracer,
  name: string,
  kind: LangfuseObservationKind,
  attrs: LangfuseSpanAttributes,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  const attributes = buildLangfuseSpanAttributes(kind, {
    traceName: attrs.traceName ?? name,
    ...attrs,
  });
  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      try {
        span.recordException(
          err instanceof Error ? err : new Error(message),
        );
      } catch {
        // ignore — recordException is best-effort
      }
      try {
        span.setStatus({ code: SpanStatusCode.ERROR, message });
      } catch {
        // ignore — setStatus is best-effort
      }
      throw err;
    } finally {
      span.end();
    }
  });
}
