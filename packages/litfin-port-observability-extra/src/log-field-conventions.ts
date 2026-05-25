/**
 * Structured logging field conventions.
 *
 * LITFIN ref: src/core/telemetry/* — defines a normalised field set
 * that downstream pipelines (Loki, Datadog, GCP Logs) can index
 * predictably. We provide:
 *   - a builder for a canonical record shape
 *   - a redactor for known-sensitive keys (PII, auth tokens)
 *   - a tenant-scoped enricher
 */

import type { CorrelationId, SpanId, TenantId, TraceId } from './types.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface CanonicalLog {
  readonly level: LogLevel;
  readonly tsMs: number;
  readonly message: string;
  readonly service: string;
  readonly env: 'dev' | 'staging' | 'prod' | 'test';
  readonly tenantId?: TenantId;
  readonly correlationId?: CorrelationId;
  readonly traceId?: TraceId;
  readonly spanId?: SpanId;
  readonly httpRoute?: string;
  readonly httpStatus?: number;
  readonly httpMethod?: string;
  readonly durationMs?: number;
  readonly errorClass?: string;
  readonly errorMessage?: string;
  readonly fields: Readonly<Record<string, unknown>>;
}

export interface CanonicalLogInput
  extends Omit<CanonicalLog, 'tsMs' | 'fields'> {
  readonly tsMs?: number;
  readonly fields?: Readonly<Record<string, unknown>>;
}

export const canonicalLog = (input: CanonicalLogInput): CanonicalLog => ({
  ...input,
  tsMs: input.tsMs ?? Date.now(),
  fields: input.fields ?? {},
});

// ----------------------------------------------------------------------
// Redaction
// ----------------------------------------------------------------------

const DEFAULT_REDACT_KEYS: readonly string[] = [
  'password',
  'passwd',
  'secret',
  'authorization',
  'auth',
  'cookie',
  'token',
  'api_key',
  'apiKey',
  'ssn',
  'national_id',
  'pan',
  'card_number',
  'cvv',
  'mpesa_passkey',
];

export interface RedactConfig {
  readonly keys?: readonly string[];
  readonly placeholder?: string;
}

export const redactFields = (
  fields: Readonly<Record<string, unknown>>,
  cfg: RedactConfig = {},
): Readonly<Record<string, unknown>> => {
  const keys = cfg.keys ?? DEFAULT_REDACT_KEYS;
  const placeholder = cfg.placeholder ?? '[REDACTED]';
  const lowerKeys = new Set(keys.map((k) => k.toLowerCase()));
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (lowerKeys.has(k.toLowerCase())) {
      next[k] = placeholder;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      next[k] = redactFields(v as Record<string, unknown>, cfg);
    } else {
      next[k] = v;
    }
  }
  return next;
};

// ----------------------------------------------------------------------
// Enrichment
// ----------------------------------------------------------------------

export interface EnrichmentCtx {
  readonly tenantId?: TenantId;
  readonly correlationId?: CorrelationId;
  readonly traceId?: TraceId;
  readonly spanId?: SpanId;
}

const stripUndefined = <T extends Record<string, unknown>>(obj: T): T => {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
};

export const enrich = (log: CanonicalLog, ctx: EnrichmentCtx): CanonicalLog =>
  stripUndefined({
    ...log,
    tenantId: log.tenantId ?? ctx.tenantId,
    correlationId: log.correlationId ?? ctx.correlationId,
    traceId: log.traceId ?? ctx.traceId,
    spanId: log.spanId ?? ctx.spanId,
  }) as CanonicalLog;
