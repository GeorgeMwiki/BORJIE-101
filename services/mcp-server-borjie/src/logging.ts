/**
 * MCP `logging/*` protocol — server-pushed structured logs.
 *
 * Per MCP 2024-11-05:
 *   - Client invokes `logging/setLevel` with one of {debug, info, notice,
 *     warning, error, critical, alert, emergency} (RFC 5424 levels).
 *   - Server emits `logging/message` JSON-RPC notifications scoped to
 *     that session, filtered by level.
 *
 * The dispatcher wires each tool call to push an info-level message on
 * start and an info/warn/error on completion, providing the same
 * Pino-style structured observability the api-gateway already emits.
 *
 * No `console.log` — every server-side observation flows through the
 * `LogSink` interface so the api-gateway adapter can fan it into the
 * existing Pino logger.
 */

export type LogLevel =
  | 'debug'
  | 'info'
  | 'notice'
  | 'warning'
  | 'error'
  | 'critical'
  | 'alert'
  | 'emergency';

export const LOG_LEVEL_RANK: Readonly<Record<LogLevel, number>> = Object.freeze({
  debug: 0,
  info: 1,
  notice: 2,
  warning: 3,
  error: 4,
  critical: 5,
  alert: 6,
  emergency: 7,
});

export const ALL_LOG_LEVELS: ReadonlyArray<LogLevel> = Object.freeze([
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
]);

export interface LogMessage {
  readonly level: LogLevel;
  readonly logger?: string;
  readonly data: unknown;
}

export interface LogSink {
  emit(message: LogMessage): void;
}

/**
 * In-memory log sink. Tests use this; the api-gateway adapter passes a
 * sink that fans into the Pino logger AND pushes a `notifications/message`
 * JSON-RPC envelope onto the SSE channel.
 */
export interface MemoryLogSink extends LogSink {
  readonly messages: ReadonlyArray<LogMessage>;
}

export function createMemoryLogSink(): MemoryLogSink {
  const messages: LogMessage[] = [];
  const sink: MemoryLogSink = {
    emit(message: LogMessage): void {
      messages.push(message);
    },
    get messages(): ReadonlyArray<LogMessage> {
      return Object.freeze([...messages]);
    },
  };
  return Object.freeze(sink);
}

/**
 * Per-session log level controller. The dispatcher consults this on
 * every emit. Defaults to `info`.
 */
export interface LogLevelController {
  get(): LogLevel;
  set(level: LogLevel): void;
}

export function createLogLevelController(initial: LogLevel = 'info'): LogLevelController {
  let current: LogLevel = initial;
  const controller: LogLevelController = {
    get(): LogLevel {
      return current;
    },
    set(level: LogLevel): void {
      current = level;
    },
  };
  return Object.freeze(controller);
}

export function shouldEmit(controller: LogLevelController, level: LogLevel): boolean {
  return LOG_LEVEL_RANK[level] >= LOG_LEVEL_RANK[controller.get()];
}

export function isValidLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in LOG_LEVEL_RANK;
}
