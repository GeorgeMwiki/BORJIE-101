/**
 * OTel exporter binding — composition-root factory.
 *
 * Phase F.7 deliverable: a single env-driven factory that decides which
 * OpenTelemetry span exporter to wire at process start. Operators control
 * the destination via standard OTEL_* environment variables. Dev runs with
 * no env get a no-op exporter that drops spans silently — observability is
 * never required for the code path to function.
 *
 * The factory is intentionally side-effect-free at module load: importing
 * this file does NOT bind anything. Call `createOtelExporter(env)` from
 * the composition root after env validation.
 *
 * Environment contract (subset of the standard OTel env spec):
 *
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — collector URL. Unset → NoopSpanExporter.
 *   OTEL_EXPORTER_OTLP_PROTOCOL  — 'http/protobuf' (default) | 'http/json'.
 *                                  'grpc' is not supported here (use the
 *                                  grpc-exporter package directly if you
 *                                  need it).
 *   OTEL_EXPORTER_OTLP_HEADERS   — comma-separated `key=value` pairs.
 *                                  Standard auth header lives here:
 *                                  e.g. `api-key=…` for Honeycomb.
 *   OTEL_EXPORTER_OTLP_TIMEOUT   — request timeout in milliseconds.
 *                                  Default: 10_000.
 *   OTEL_EXPORTER_OTLP_COMPRESSION — 'gzip' | 'none'. Default: 'gzip'.
 *
 * The Langfuse variant reads:
 *
 *   LANGFUSE_HOST | LANGFUSE_BASEURL — base URL of the Langfuse instance.
 *   LANGFUSE_PUBLIC_KEY  — basic-auth username for the OTLP ingest.
 *   LANGFUSE_SECRET_KEY  — basic-auth password.
 *
 * The Langfuse exporter delegates to the OTLP HTTP exporter pointed at
 * `<LANGFUSE_HOST>/api/public/otel/v1/traces` with a base64 Basic auth
 * header derived from the two keys.
 */

import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { CompressionAlgorithm } from '@opentelemetry/otlp-exporter-base';
import type { ExportResult } from '@opentelemetry/core';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Env keys this module reads. Exported so tests can list the contract. */
export const OTEL_ENV_KEYS = Object.freeze([
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_PROTOCOL',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'OTEL_EXPORTER_OTLP_TIMEOUT',
  'OTEL_EXPORTER_OTLP_COMPRESSION',
] as const);

/** Env keys the Langfuse exporter reads. */
export const LANGFUSE_ENV_KEYS = Object.freeze([
  'LANGFUSE_HOST',
  'LANGFUSE_BASEURL',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
] as const);

/**
 * Build the primary OTLP span exporter from env, or a no-op when the
 * endpoint is unset. Pure factory — does not start the SDK and does not
 * mutate global state.
 */
export function createOtelExporter(
  env: Readonly<Record<string, string | undefined>>,
): SpanExporter {
  const endpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint || endpoint.trim().length === 0) {
    return new NoopSpanExporter();
  }

  const protocol = (env.OTEL_EXPORTER_OTLP_PROTOCOL ?? 'http/protobuf').trim();
  if (protocol !== 'http/protobuf' && protocol !== 'http/json') {
    // Fail-closed: unknown protocol is an operator misconfiguration. We
    // return a noop so the process keeps serving traffic; an alert wired
    // off `otel_exporter_init_errors` should page on this.
    return new NoopSpanExporter({
      reason: `Unsupported OTEL_EXPORTER_OTLP_PROTOCOL='${protocol}'. Use 'http/protobuf' or 'http/json'.`,
    });
  }

  const headers = parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS);
  const timeoutMillis = parseTimeoutMs(env.OTEL_EXPORTER_OTLP_TIMEOUT);
  const compression = parseCompression(env.OTEL_EXPORTER_OTLP_COMPRESSION);

  return new OTLPTraceExporter({
    url: endpoint,
    headers,
    timeoutMillis,
    compression,
  });
}

/**
 * Build the Langfuse-bound OTLP exporter. Returns null when Langfuse is
 * not configured — composition root can fall through to the primary
 * exporter from `createOtelExporter`.
 *
 * Note: Langfuse 3.x speaks vanilla OTLP/HTTP — this is just a thin
 * factory that injects the right basic-auth + URL.
 */
export function createLangfuseExporter(
  env: Readonly<Record<string, string | undefined>>,
): SpanExporter | null {
  const host = env.LANGFUSE_HOST ?? env.LANGFUSE_BASEURL;
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;

  if (!host || !publicKey || !secretKey) {
    return null;
  }

  const url = joinLangfuseUrl(host);
  const auth = Buffer.from(`${publicKey}:${secretKey}`, 'utf8').toString(
    'base64',
  );

  return new OTLPTraceExporter({
    url,
    headers: { Authorization: `Basic ${auth}` },
    timeoutMillis: parseTimeoutMs(env.OTEL_EXPORTER_OTLP_TIMEOUT),
    compression: parseCompression(env.OTEL_EXPORTER_OTLP_COMPRESSION),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the standard OTel `OTEL_EXPORTER_OTLP_HEADERS` value, which is a
 * comma-separated list of `key=value` pairs. Empty / undefined → empty obj.
 * Whitespace around `=` and `,` is tolerated.
 */
export function parseHeaders(
  raw: string | undefined,
): Record<string, string> {
  if (!raw || raw.trim().length === 0) return Object.freeze({}) as Record<string, string>;
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key.length === 0 || value.length === 0) continue;
    out[key] = value;
  }
  return Object.freeze(out);
}

function parseTimeoutMs(raw: string | undefined): number {
  const DEFAULT_MS = 10_000;
  if (!raw) return DEFAULT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 600_000) return DEFAULT_MS;
  return Math.floor(n);
}

function parseCompression(
  raw: string | undefined,
): CompressionAlgorithm {
  const normalised = (raw ?? 'gzip').trim().toLowerCase();
  if (normalised === 'none') return CompressionAlgorithm.NONE;
  return CompressionAlgorithm.GZIP;
}

/**
 * Compose the Langfuse OTLP traces ingest URL from a base host. We accept
 * either a bare host (https://cloud.langfuse.com) or a path-suffixed URL
 * (https://cloud.langfuse.com/api/public/otel) and normalise to the
 * canonical traces endpoint.
 */
export function joinLangfuseUrl(host: string): string {
  const trimmed = host.replace(/\/+$/, '');
  if (trimmed.endsWith('/api/public/otel/v1/traces')) return trimmed;
  if (trimmed.endsWith('/api/public/otel')) return `${trimmed}/v1/traces`;
  return `${trimmed}/api/public/otel/v1/traces`;
}

// ---------------------------------------------------------------------------
// NoopSpanExporter — drops every span. Used as the default when no OTLP
// endpoint is configured (dev / test). Implements the SpanExporter
// interface so the SDK accepts it transparently.
// ---------------------------------------------------------------------------

export class NoopSpanExporter implements SpanExporter {
  readonly reason?: string;

  constructor(opts: { reason?: string } = {}) {
    this.reason = opts.reason;
  }

  export(
    _spans: ReadableSpan[],
    resultCallback: (result: ExportResult) => void,
  ): void {
    // Resolve as SUCCESS so the BatchSpanProcessor doesn't backpressure.
    // We use a microtask so the contract (async callback) is preserved.
    queueMicrotask(() => resultCallback({ code: 0 }));
  }

  async shutdown(): Promise<void> {
    // Nothing to do — no underlying resource.
  }

  async forceFlush(): Promise<void> {
    // Nothing to flush.
  }
}
