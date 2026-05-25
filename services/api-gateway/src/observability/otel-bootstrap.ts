/**
 * OpenTelemetry SDK bootstrap for the api-gateway.
 *
 * Wires three subsystems behind a single env-driven bootstrap call:
 *
 *   1. Distributed tracing — OTLP/HTTP exporter when
 *      `OTEL_EXPORTER_OTLP_ENDPOINT` is set; parent-based sampler with
 *      `TraceIdRatioBased(OTEL_SAMPLE_RATE)` (default 0.1) so a 10%
 *      head-sample reaches the collector unless the parent forces
 *      a decision.
 *   2. Metrics — periodic OTLP/HTTP metrics exporter pushing every 60s
 *      when the endpoint is configured.
 *   3. Auto-instrumentations — http / express / pg / redis /
 *      ioredis / undici / fetch via
 *      `@opentelemetry/auto-instrumentations-node`.
 *
 * Set `OTEL_ENABLED=false` to short-circuit the whole bootstrap (returns
 * a no-op handle so the gateway boot path never branches on truthiness).
 *
 * Idempotent: a second call returns the same handle without spinning a
 * second SDK. Tests reset module state via `__resetOtelForTests()`.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
// `deployment.environment.name` lives in the incubating bundle in
// semantic-conventions 1.41+. The legacy `deployment.environment`
// resource attribute was deprecated alongside the SemanticResourceAttributes
// enum and is no longer exported from the stable surface.
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from '@opentelemetry/semantic-conventions/incubating';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  BatchSpanProcessor,
  NoopSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { logger } from '../utils/logger.js';

/**
 * Public bootstrap config. All fields override the env-driven defaults.
 */
export interface OTelBootstrapConfig {
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly otlpEndpoint?: string;
  readonly sampleRate?: number;
  readonly enabled?: boolean;
  readonly environment?: string;
}

export interface OTelHandle {
  readonly sdk: NodeSDK | null;
  readonly enabled: boolean;
  readonly serviceName: string;
  readonly sampleRate: number;
  readonly endpoint: string | null;
  shutdown(): Promise<void>;
}

let singleton: OTelHandle | null = null;

function parseSampleRate(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
  return n;
}

function readEnabled(raw: string | undefined, override?: boolean): boolean {
  if (override !== undefined) return override;
  if (!raw) return true;
  const v = raw.trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'no';
}

/**
 * Bootstrap the OTel SDK. Safe to call once at process start; subsequent
 * calls return the cached handle.
 */
export function bootstrapOTel(config: OTelBootstrapConfig = {}): OTelHandle {
  if (singleton) return singleton;

  const enabled = readEnabled(process.env.OTEL_ENABLED, config.enabled);
  const serviceName =
    config.serviceName ?? process.env.OTEL_SERVICE_NAME ?? 'borjie-api-gateway';
  const serviceVersion =
    config.serviceVersion ?? process.env.APP_VERSION ?? 'dev';
  const sampleRate = parseSampleRate(
    process.env.OTEL_SAMPLE_RATE,
    config.sampleRate ?? 0.1,
  );
  const endpoint =
    config.otlpEndpoint ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? null;
  const environment =
    config.environment ?? process.env.NODE_ENV ?? 'development';

  if (!enabled) {
    const noopHandle: OTelHandle = {
      sdk: null,
      enabled: false,
      serviceName,
      sampleRate,
      endpoint,
      async shutdown(): Promise<void> {
        // No-op when disabled.
      },
    };
    singleton = noopHandle;
    return noopHandle;
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: environment,
  });

  const sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(sampleRate),
  });

  const traceExporter = endpoint
    ? new OTLPTraceExporter({ url: `${endpoint.replace(/\/$/, '')}/v1/traces` })
    : null;

  const spanProcessor = traceExporter
    ? new BatchSpanProcessor(traceExporter)
    : new NoopSpanProcessor();

  const metricReader = endpoint
    ? new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${endpoint.replace(/\/$/, '')}/v1/metrics`,
        }),
        exportIntervalMillis: 60_000,
      })
    : undefined;

  // The OTel SDK ships a slightly older `sdk-trace-base` than the
  // `@opentelemetry/api` we install — both are runtime-compatible but
  // their TypeScript span shapes differ slightly. Cast at the boundary
  // so we don't drag the older types into our public surface.
  const sdkConfig: Record<string, unknown> = {
    resource,
    sampler,
    spanProcessor,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Filesystem instrumentation produces a span per fs read; far
        // too noisy for an API gateway. Disable by default.
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  };
  if (metricReader) sdkConfig.metricReader = metricReader;
  const sdk = new NodeSDK(sdkConfig as ConstructorParameters<typeof NodeSDK>[0]);

  let started = false;
  try {
    sdk.start();
    started = true;
  } catch (err) {
    // Bootstrap failures must not crash the gateway. Surface a single
    // warning and fall back to a no-op handle so the rest of the boot
    // sequence proceeds.
    logger.warn('otel-bootstrap: SDK start failed; continuing without telemetry', { value: err instanceof Error ? err.message : err });
  }

  let shutdownPromise: Promise<void> | null = null;
  const handle: OTelHandle = {
    sdk: started ? sdk : null,
    enabled: started,
    serviceName,
    sampleRate,
    endpoint,
    async shutdown(): Promise<void> {
      if (!started) return;
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = sdk
        .shutdown()
        .catch((err: unknown) => {
          // Shutdown errors are advisory — the process is exiting.
          logger.warn('otel-bootstrap: shutdown failed', { value: err instanceof Error ? err.message : err });
        })
        .then(() => undefined);
      return shutdownPromise;
    },
  };
  singleton = handle;
  return handle;
}

/** Test-only — clears the singleton so subsequent bootstrap calls re-init. */
export function __resetOtelForTests(): void {
  singleton = null;
}

/** Public accessor for the active handle (or null when not bootstrapped). */
export function getOtelHandle(): OTelHandle | null {
  return singleton;
}
