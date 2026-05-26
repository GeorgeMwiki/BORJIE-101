/**
 * Package-local structured logger — zero runtime dependency on
 * `@borjie/observability`. Mirrors the TelemetryConfig surface so a
 * future swap-in is mechanical. The production composition root wires
 * this through the real observability sink via the `emit` port.
 *
 * SEC-4 design note: redacted fields are aggressive by default because
 * a security-guard logger that leaks the very signals it observes is
 * its own attack surface.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface ServiceIdentity {
  readonly name: string;
  readonly version: string;
  readonly environment: 'development' | 'staging' | 'production' | 'test';
  readonly instanceId?: string;
}

export interface TelemetryConfig {
  readonly service: ServiceIdentity;
  readonly level: LogLevel;
  readonly pretty?: boolean;
  readonly redactFields?: ReadonlyArray<string>;
  readonly baseContext?: Readonly<Record<string, unknown>>;
}

export interface LogEmitter {
  readonly emit: (entry: {
    readonly level: LogLevel;
    readonly msg: string;
    readonly fields: Readonly<Record<string, unknown>>;
  }) => void;
}

export interface Logger {
  readonly debug: (
    msg: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly info: (
    msg: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly warn: (
    msg: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
  readonly error: (
    msg: string,
    fields?: Readonly<Record<string, unknown>>,
  ) => void;
}

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
});

/**
 * Aggressive redaction list — anything that *could* end up in a
 * security signal must not leak through the log sink.
 */
const DEFAULT_REDACT_FIELDS: ReadonlyArray<string> = Object.freeze([
  'password',
  'token',
  'secret',
  'apiKey',
  'authorization',
  'accessToken',
  'refreshToken',
  'rawInput',
  'rawOutput',
  'evidence',
  'attemptedArgs',
]);

export interface CreateLoggerDeps {
  readonly config: TelemetryConfig;
  readonly emitter?: LogEmitter;
}

export function createLogger(deps: CreateLoggerDeps): Logger {
  const threshold = LEVEL_ORDER[deps.config.level];
  const redact = new Set(
    (deps.config.redactFields ?? DEFAULT_REDACT_FIELDS).map((f) =>
      f.toLowerCase(),
    ),
  );
  const emitter: LogEmitter = deps.emitter ?? {
    emit: () => {
      // no-op default — production wires the real sink
    },
  };

  function emit(
    level: LogLevel,
    msg: string,
    fields: Readonly<Record<string, unknown>>,
  ): void {
    if (LEVEL_ORDER[level] < threshold) return;
    const merged: Record<string, unknown> = {
      ...(deps.config.baseContext ?? {}),
      service: deps.config.service.name,
      version: deps.config.service.version,
      environment: deps.config.service.environment,
    };
    for (const [k, v] of Object.entries(fields)) {
      merged[k] = redact.has(k.toLowerCase()) ? '[REDACTED]' : v;
    }
    emitter.emit({ level, msg, fields: merged });
  }

  return Object.freeze({
    debug: (msg: string, fields: Readonly<Record<string, unknown>> = {}) =>
      emit('debug', msg, fields),
    info: (msg: string, fields: Readonly<Record<string, unknown>> = {}) =>
      emit('info', msg, fields),
    warn: (msg: string, fields: Readonly<Record<string, unknown>> = {}) =>
      emit('warn', msg, fields),
    error: (msg: string, fields: Readonly<Record<string, unknown>> = {}) =>
      emit('error', msg, fields),
  });
}
