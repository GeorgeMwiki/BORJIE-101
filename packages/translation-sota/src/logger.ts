/**
 * Structured logger for `@borjie/translation-sota`.
 *
 * Per `~/.claude/rules/coding-style.md` ("No `console.log` in services
 * — Pino logger only — it handles redaction") and the wave 19I spec
 * ("`createLogger` with full TelemetryConfig"), we expose a tiny
 * factory that mirrors the `createLogger(TelemetryConfig)` contract
 * used in `@borjie/observability`. We deliberately do NOT import
 * `@borjie/observability` directly — pulling OpenTelemetry, Sentry,
 * and PostHog into the translation leaf would bloat the bundle. We
 * mirror the public shape so the service-layer wiring is identical.
 *
 * TelemetryConfig fields consumed:
 *   service.name        — service identifier ('@borjie/translation-sota')
 *   service.version     — semver of the binding
 *   service.environment — 'development' | 'staging' | 'production'
 *   logLevel            — 'trace' | 'debug' | 'info' | 'warn' | 'error'
 *                         | 'fatal'
 *   redactFields        — sensitive field path list (default = the
 *                         standard Borjie set)
 *
 * Tests construct a logger with a `silent` log level — no I/O.
 */

export const TRANSLATION_LOG_LEVELS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
  'silent',
] as const;

export type TranslationLogLevel = (typeof TRANSLATION_LOG_LEVELS)[number];

export interface TranslationServiceIdentity {
  readonly name: string;
  readonly version: string;
  readonly environment: 'development' | 'staging' | 'production';
  readonly instanceId?: string;
  readonly namespace?: string;
  readonly region?: string;
}

export interface TranslationTelemetryConfig {
  readonly service: TranslationServiceIdentity;
  readonly enabled: boolean;
  readonly logLevel: TranslationLogLevel;
  readonly traceSampleRatio: number;
  readonly metricsIntervalMs: number;
  readonly consoleExport?: boolean;
  readonly redactFields?: ReadonlyArray<string>;
}

const DEFAULT_REDACT_FIELDS: ReadonlyArray<string> = Object.freeze([
  'password',
  'token',
  'secret',
  'apiKey',
  'authorization',
  'creditCard',
  'ssn',
  'bankAccount',
]);

const LEVEL_ORDER: Record<TranslationLogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: Number.POSITIVE_INFINITY,
};

export interface TranslationLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface LogSinks {
  readonly write: (
    level: TranslationLogLevel,
    payload: Record<string, unknown>,
  ) => void;
}

const NOOP_SINKS: LogSinks = Object.freeze({
  write: () => {},
});

export function createLogger(
  config: TranslationTelemetryConfig,
  sinks: LogSinks = NOOP_SINKS,
): TranslationLogger {
  const level = config.logLevel;
  const redact = new Set(config.redactFields ?? DEFAULT_REDACT_FIELDS);
  const minOrder = LEVEL_ORDER[level];
  const base: Record<string, unknown> = {
    service: config.service.name,
    version: config.service.version,
    environment: config.service.environment,
  };
  if (config.service.instanceId !== undefined) {
    base['instance'] = config.service.instanceId;
  }

  function emit(
    lvl: TranslationLogLevel,
    message: string,
    meta: Record<string, unknown> | undefined,
  ): void {
    if (LEVEL_ORDER[lvl] < minOrder) {
      return;
    }
    if (!config.enabled) {
      return;
    }
    const safeMeta = redactPayload(meta ?? {}, redact);
    sinks.write(lvl, {
      ...base,
      level: lvl,
      message,
      ts: new Date().toISOString(),
      ...safeMeta,
    });
  }

  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
  };
}

function redactPayload(
  meta: Record<string, unknown>,
  redact: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (redact.has(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = redactPayload(value as Record<string, unknown>, redact);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Default config — `production`, `info`, no console export, standard
 * redaction. Tests override with `logLevel: 'silent'`.
 */
export const DEFAULT_TRANSLATION_TELEMETRY_CONFIG: TranslationTelemetryConfig =
  Object.freeze({
    service: Object.freeze({
      name: '@borjie/translation-sota',
      version: '0.1.0',
      environment: 'production' as const,
    }),
    enabled: true,
    logLevel: 'info' as const,
    traceSampleRatio: 0.1,
    metricsIntervalMs: 60_000,
    consoleExport: false,
    redactFields: DEFAULT_REDACT_FIELDS,
  });
