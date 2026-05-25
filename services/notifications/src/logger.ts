/**
 * Structured logger for notifications service.
 *
 * PII-safe: every log call is piped through a scrubber that masks phone
 * numbers, email addresses, and obvious credential-looking fields before
 * the payload is serialised. The scrubber is intentionally conservative
 * (it will over-mask rather than under-mask) because WhatsApp/SMS flows
 * handle raw user identifiers at every hop.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

const logLevelOrder: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const minLevel = (process.env['LOG_LEVEL'] as LogLevel) ?? 'info';

function shouldLog(level: LogLevel): boolean {
  const minIdx = logLevelOrder.indexOf(minLevel);
  const levelIdx = logLevelOrder.indexOf(level);
  return levelIdx >= minIdx;
}

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

function formatMessage(level: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const scrubbed = scrubMeta(meta);
  const metaStr = scrubbed ? ` ${JSON.stringify(scrubbed)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

export function createLogger(name: string): Logger {
  const prefix = `[${name}]`;
  return {
    debug(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('debug')) {
        console.debug(prefix, formatMessage('debug', message, meta));
      }
    },
    info(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('info')) {
        console.info(prefix, formatMessage('info', message, meta));
      }
    },
    warn(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('warn')) {
        console.warn(prefix, formatMessage('warn', message, meta));
      }
    },
    error(message: string, meta?: Record<string, unknown>) {
      if (shouldLog('error')) {
        console.error(prefix, formatMessage('error', message, meta));
      }
    },
  };
}
