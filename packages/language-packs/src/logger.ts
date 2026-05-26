/**
 * Lightweight structured logger — package-local so the registry has
 * zero runtime dependency on `@borjie/observability` (which would
 * drag in pino + OpenTelemetry at install time).
 *
 * Mirrors the same `TelemetryConfig` + `createLogger` shape used by
 * the observability package so a future swap-in is mechanical.
 * Production composition roots can pass a custom emitter that routes
 * through the real pino logger.
 *
 * Sensitive fields are redacted; level filtering is honoured.
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
  'creditCard',
  'ssn',
  'bankAccount',
];

function redact(
  fields: Readonly<Record<string, unknown>>,
  redactPaths: ReadonlyArray<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (redactPaths.includes(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = v;
    }
  }
  return out;
}

export interface CreateLoggerDeps {
  readonly config: TelemetryConfig;
  readonly emit?: LogEmitter['emit'];
}

export function createLogger(deps: CreateLoggerDeps): Logger {
  const cfgLevel = LEVEL_ORDER[deps.config.level];
  const redactPaths = [
    ...DEFAULT_REDACT_FIELDS,
    ...(deps.config.redactFields ?? []),
  ];
  const base = deps.config.baseContext ?? {};
  const emit: LogEmitter['emit'] =
    deps.emit ??
    ((entry): void => {
      // Default emitter routes through process.stdout as a single JSON
      // line. Production composition roots replace this with pino.
      const payload = JSON.stringify({
        ts: new Date().toISOString(),
        level: entry.level,
        service: deps.config.service.name,
        version: deps.config.service.version,
        env: deps.config.service.environment,
        msg: entry.msg,
        ...entry.fields,
      });
      process.stdout.write(`${payload}\n`);
    });

  function log(level: LogLevel, msg: string, fields?: Readonly<Record<string, unknown>>): void {
    if (LEVEL_ORDER[level] < cfgLevel) {
      return;
    }
    const merged = { ...base, ...(fields ?? {}) } as Record<string, unknown>;
    emit({ level, msg, fields: redact(merged, redactPaths) });
  }

  return Object.freeze({
    debug: (msg: string, fields?: Readonly<Record<string, unknown>>): void =>
      log('debug', msg, fields),
    info: (msg: string, fields?: Readonly<Record<string, unknown>>): void =>
      log('info', msg, fields),
    warn: (msg: string, fields?: Readonly<Record<string, unknown>>): void =>
      log('warn', msg, fields),
    error: (msg: string, fields?: Readonly<Record<string, unknown>>): void =>
      log('error', msg, fields),
  });
}
