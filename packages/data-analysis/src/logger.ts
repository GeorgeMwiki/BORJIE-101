/**
 * Lightweight structured logger for @borjie/data-analysis.
 *
 * Mirrors the TelemetryConfig surface used by the connectors
 * (e.g. `packages/connectors/jira/src/logger.ts`) so a future swap
 * onto `@borjie/observability` is mechanical.
 *
 * Telemetry from this package records ONLY:
 *   - function name + version
 *   - input vector sizes (length, columns) — never values
 *   - result summaries (e.g. mean = 4.123) — never raw output arrays
 *   - wall-clock duration
 *
 * No PII, no full vectors, no row contents.
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
  readonly debug: (msg: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly info: (msg: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly warn: (msg: string, fields?: Readonly<Record<string, unknown>>) => void;
  readonly error: (msg: string, fields?: Readonly<Record<string, unknown>>) => void;
}

const LEVEL_ORDER: Readonly<Record<LogLevel, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const DEFAULT_REDACT_FIELDS: ReadonlyArray<string> = [
  'password',
  'token',
  'secret',
  'apiKey',
  'authorization',
  'accessToken',
  'refreshToken',
];

export interface CreateLoggerDeps {
  readonly config: TelemetryConfig;
  readonly emitter?: LogEmitter;
}

export function createLogger(deps: CreateLoggerDeps): Logger {
  const threshold = LEVEL_ORDER[deps.config.level];
  const redact = new Set(
    (deps.config.redactFields ?? DEFAULT_REDACT_FIELDS).map((f) => f.toLowerCase()),
  );
  const emitter: LogEmitter =
    deps.emitter ?? {
      emit: () => {
        // no-op default — production wires the real sink
      },
    };

  function emit(level: LogLevel, msg: string, fields: Readonly<Record<string, unknown>>): void {
    if (LEVEL_ORDER[level] < threshold) return;
    const merged: Record<string, unknown> = {
      ...deps.config.baseContext,
      service: deps.config.service.name,
      version: deps.config.service.version,
      environment: deps.config.service.environment,
    };
    for (const [k, v] of Object.entries(fields)) {
      merged[k] = redact.has(k.toLowerCase()) ? '[REDACTED]' : v;
    }
    emitter.emit({ level, msg, fields: merged });
  }

  return {
    debug: (msg, fields = {}) => emit('debug', msg, fields),
    info: (msg, fields = {}) => emit('info', msg, fields),
    warn: (msg, fields = {}) => emit('warn', msg, fields),
    error: (msg, fields = {}) => emit('error', msg, fields),
  };
}

/** Default logger used by primitives that do not receive an injected one. */
export const defaultLogger: Logger = createLogger({
  config: {
    service: {
      name: '@borjie/data-analysis',
      version: '0.1.0',
      environment: (process.env['NODE_ENV'] as ServiceIdentity['environment']) ?? 'development',
    },
    level: 'info',
  },
});
