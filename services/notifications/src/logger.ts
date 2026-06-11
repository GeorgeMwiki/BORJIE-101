/**
 * Structured logger for notifications service.
 *
 * Backed by pino (the project-canonical structured-log primitive — it
 * owns redaction and serialisation; `console.*` is banned in services).
 * On top of pino's own redaction we keep a conservative PII scrubber that
 * masks phone numbers, email addresses, and credential-looking fields
 * before the payload is handed to pino. The scrubber is intentionally
 * over-eager (it masks rather than risk leaking) because WhatsApp/SMS
 * flows handle raw user identifiers at every hop.
 *
 * The public interface — `LogLevel`, `Logger`, `createLogger`,
 * `scrubMeta` — is unchanged so existing callers keep their
 * `(message, meta)` calling convention.
 */

import pino, { type Logger as PinoLogger } from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const minLevel = (process.env['LOG_LEVEL'] as LogLevel) ?? 'info';

// Keys whose value should always be masked. Lower-cased match.
const PII_KEYS = new Set([
  'phone',
  'phonenumber',
  'phone_number',
  'msisdn',
  'email',
  'to',
  'from',
  'password',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'nationalid',
  'national_id',
  'passport',
  'ssn',
]);

// Mask a phone-number-ish string: keep country prefix + last two digits.
// e.g. "+255712345678" -> "+255*****78"
function maskPhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, '');
  if (digits.length < 5) return '***';
  const last2 = digits.slice(-2);
  const prefix = digits.startsWith('+') ? digits.slice(0, 4) : digits.slice(0, 3);
  return `${prefix}*****${last2}`;
}

// Mask an email: first 2 chars of local part, domain preserved.
// e.g. "alice@example.com" -> "al***@example.com"
function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at < 0) return '***';
  const local = value.slice(0, at);
  const domain = value.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***${domain}`;
}

function scrubValue(key: string, value: unknown): unknown {
  const lowerKey = key.toLowerCase();
  if (typeof value === 'string') {
    if (PII_KEYS.has(lowerKey)) {
      if (lowerKey.includes('email') || value.includes('@')) return maskEmail(value);
      if (lowerKey.includes('phone') || lowerKey === 'to' || lowerKey === 'from' || lowerKey === 'msisdn') {
        return maskPhone(value);
      }
      return '[REDACTED]';
    }
    // Heuristic fallback: any string that looks like a phone number should
    // be masked even if the key is generic (e.g. `user: "+255712345678"`).
    if (/^\+?\d{7,15}$/.test(value)) return maskPhone(value);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length < 200) return maskEmail(value);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return scrubMeta(value as Record<string, unknown>);
  }
  if (Array.isArray(value)) {
    return value.map((item, idx) => scrubValue(String(idx), item));
  }
  return value;
}

/**
 * Deep-clone a metadata object while masking PII.
 * Never mutates the input — safe to call on upstream-shared data.
 */
export function scrubMeta(
  meta: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!meta) return meta;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = scrubValue(k, v);
  }
  return out;
}

/**
 * Root pino instance — the single structured-log primitive for the
 * notifications service. pino owns level filtering and serialisation;
 * it also redacts the well-known PII paths as a defence-in-depth layer
 * beneath the application-level `scrubMeta` pass.
 */
const rootPino: PinoLogger = pino({
  level: minLevel,
  redact: {
    paths: [
      'phone',
      'phoneNumber',
      'phone_number',
      'msisdn',
      'email',
      'to',
      'from',
      'password',
      'secret',
      'token',
      'apiKey',
      'api_key',
      'authorization',
      'nationalId',
      'national_id',
      'passport',
      'ssn',
    ],
    censor: '[REDACTED]',
  },
});

/**
 * Emit one structured log line via pino. Object-first, message-second so
 * downstream aggregators get a redaction-friendly structured payload.
 * Errors from the logging path are swallowed (logging must never throw
 * and take down a notification dispatch).
 */
function emit(
  child: PinoLogger,
  level: LogLevel,
  message: string,
  meta?: Record<string, unknown>
): void {
  try {
    const scrubbed = scrubMeta(meta);
    if (scrubbed) {
      child[level](scrubbed, message);
    } else {
      child[level](message);
    }
  } catch {
    // Defensive: a logging failure must not propagate into the caller's
    // notification flow. Intentionally no console.* fallback (banned).
  }
}

/**
 * Create a logger instance bound to a named module. Returns the same
 * `(message, meta)` interface callers already depend on; under the hood
 * each call routes through a pino child logger tagged with `name`.
 */
export function createLogger(name: string): Logger {
  const child = rootPino.child({ name });
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      emit(child, 'debug', message, meta);
    },
    info(message: string, meta?: Record<string, unknown>) {
      emit(child, 'info', message, meta);
    },
    warn(message: string, meta?: Record<string, unknown>) {
      emit(child, 'warn', message, meta);
    },
    error(message: string, meta?: Record<string, unknown>) {
      emit(child, 'error', message, meta);
    },
  };
}
