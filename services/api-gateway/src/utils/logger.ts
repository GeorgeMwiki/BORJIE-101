/**
 * Logger Utility
 * 
 * Structured logging for the BORJIE API Gateway.
 * Supports JSON formatting for production and readable format for development.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  timestamp: string;
  service: string;
  message: string;
  [key: string]: unknown;
}

/**
 * Logger contract — overloaded to accept either the project's canonical
 * `(message, meta?)` order OR pino's `(meta, message)` order. The pino
 * order is used by mining/estate route handlers that were authored to
 * match the pino convention; we accept it for ergonomics and rewrite
 * to `(message, meta)` at runtime inside the implementation.
 */
interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  debug(meta: Record<string, unknown>, message: string): void;
  info(message: string, meta?: Record<string, unknown>): void;
  info(meta: Record<string, unknown>, message: string): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  warn(meta: Record<string, unknown>, message: string): void;
  error(message: string, meta?: Record<string, unknown>): void;
  error(meta: Record<string, unknown>, message: string): void;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
};

const RESET_COLOR = '\x1b[0m';

function getMinLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
  if (envLevel && LOG_LEVELS[envLevel] !== undefined) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

function shouldLog(level: LogLevel): boolean {
  const minLevel = getMinLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
}

function formatEntry(entry: LogEntry): string {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    // JSON format for production (easy to parse by log aggregators)
    return JSON.stringify(entry);
  }
  
  // Readable format for development
  const { level, timestamp, service, message, ...rest } = entry;
  const color = LOG_COLORS[level];
  const levelStr = level.toUpperCase().padEnd(5);
  const time = new Date(timestamp).toLocaleTimeString();
  
  let output = `${color}[${levelStr}]${RESET_COLOR} ${time} [${service}] ${message}`;
  
  if (Object.keys(rest).length > 0) {
    output += '\n' + JSON.stringify(rest, null, 2);
  }
  
  return output;
}

// Wave-K W-Data — lazy-import the classification scrubber so the logger
// stays importable in environments where the security registry isn't on
// the path (tests that mock the database barrel). The scrubber is a
// pure function; the lazy resolution + cache means we pay the import
// cost once.
let cachedScrubFn: ((payload: unknown) => unknown) | null = null;
function scrubMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return meta;
  if (!cachedScrubFn) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('../middleware/classification-scrubber');
      cachedScrubFn = typeof mod.scrubPayload === 'function'
        ? (mod.scrubPayload as (p: unknown) => unknown)
        : ((p: unknown) => p);
    } catch {
      cachedScrubFn = (p: unknown) => p;
    }
  }
  const scrubbed = cachedScrubFn(meta);
  return (scrubbed && typeof scrubbed === 'object' && !Array.isArray(scrubbed))
    ? (scrubbed as Record<string, unknown>)
    : meta;
}

function log(level: LogLevel, service: string, message: string, meta?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;

  const safeMeta = scrubMeta(meta);
  const entry: LogEntry = {
    level,
    timestamp: new Date().toISOString(),
    service,
    message,
    ...safeMeta,
  };

  const output = formatEntry(entry);

  // Logger sink — we ARE the structured-log primitive. `console.*` is
  // banned project-wide for callers; here we emit directly to the
  // underlying stream so we don't recurse through our own ban rule.
  if (level === 'error') {
    process.stderr.write(output + '\n');
  } else if (level === 'warn') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

/**
 * Normalise overloaded logger args. Accepts either:
 *   - `(message, meta?)` — the project's canonical order, or
 *   - `(meta, message)` — pino's order (used by routes/estate, etc.)
 *
 * The disambiguator is the first argument's type: a string is treated
 * as the message; an object is treated as the meta bag and the second
 * arg must be the string message.
 */
function normaliseLoggerArgs(
  first: string | Record<string, unknown>,
  second?: string | Record<string, unknown>,
): { message: string; meta?: Record<string, unknown> } {
  if (typeof first === 'string') {
    return {
      message: first,
      ...(second && typeof second === 'object'
        ? { meta: second as Record<string, unknown> }
        : {}),
    };
  }
  // first is the meta bag — second is the message.
  return {
    message: typeof second === 'string' ? second : '',
    meta: first,
  };
}

/**
 * Create a logger instance for a specific service/module
 */
export function createLogger(service: string): Logger {
  const make = (level: LogLevel) =>
    ((
      first: string | Record<string, unknown>,
      second?: string | Record<string, unknown>,
    ): void => {
      const { message, meta } = normaliseLoggerArgs(first, second);
      log(level, service, message, meta);
    }) as Logger['debug'];
  return {
    debug: make('debug'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
  };
}

/**
 * Default logger for quick use
 */
export const logger = createLogger('api-gateway');

/**
 * Request logging middleware context
 */
export interface RequestLogContext {
  requestId: string;
  method: string;
  path: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  tenantId?: string;
}

/**
 * Log an HTTP request
 */
export function logRequest(context: RequestLogContext, durationMs: number, statusCode: number): void {
  const level: LogLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  
  log(level, 'http', `${context.method} ${context.path} ${statusCode} ${durationMs}ms`, {
    requestId: context.requestId,
    ip: context.ip,
    userAgent: context.userAgent,
    userId: context.userId,
    tenantId: context.tenantId,
    durationMs,
    statusCode,
  });
}
