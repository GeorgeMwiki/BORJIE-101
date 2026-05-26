/**
 * PII redactor.
 *
 * Recursively walks an object and replaces values whose KEY name
 * matches a known-PII field with `[REDACTED:<fieldname>]`. Used by:
 *
 *   - the structured logger before pino-redact runs (pino-redact only
 *     supports literal paths, not deep recursive walks)
 *   - the audit-event emitter when capturing request payloads
 *   - any ad-hoc `console.*` replacement (see audit Deliverable 4)
 *
 * The default redaction list is a superset of `pino.redact.paths` to
 * cover region-specific PII (M-Pesa numbers, NIDA numbers, KRA PINs,
 * IBAN). Callers can extend or shrink the list per call site.
 */

const DEFAULT_PII_FIELDS: ReadonlyArray<string> = [
  // Authentication
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'sessionToken',
  'apiKey',
  'authorization',
  'secret',
  'clientSecret',
  // PII — identity
  'email',
  'phone',
  'phoneNumber',
  'recipient',
  'recipientPhone',
  'recipientEmail',
  // Messaging-context aliases — `from`/`to`/`sender`/`receiver` carry
  // phone numbers / emails / WhatsApp ids in services/notifications +
  // services/identity OTP dispatch logs.
  'from',
  'to',
  'sender',
  'receiver',
  'firstName',
  'lastName',
  'fullName',
  'address',
  'street',
  'streetAddress',
  'addressLine1',
  'addressLine2',
  'postalCode',
  'dob',
  'dateOfBirth',
  'ssn',
  'nidaNumber',
  'kraPin',
  'taxId',
  'idNumber',
  'passportNumber',
  'driversLicense',
  // PII — finance
  'iban',
  'bankAccount',
  'bankAccountNumber',
  'routingNumber',
  'cardNumber',
  'cvv',
  'mpesaNumber',
  'mpesaPhone',
  'creditCard',
  // PII — location (gated by tenant policy but redacted by default in logs)
  'gpsLat',
  'gpsLng',
  'latitude',
  'longitude',
];

const DEFAULT_MAX_DEPTH = 12;

export interface RedactOptions {
  /** Override the field list — defaults to {@link DEFAULT_PII_FIELDS}. */
  readonly fields?: ReadonlyArray<string>;
  /** Recursion depth guard — defaults to 12. */
  readonly maxDepth?: number;
  /** Replacement template; receives the field name. */
  readonly format?: (fieldName: string) => string;
  /**
   * When true, comparison is case-insensitive (default true). Logs
   * frequently encode PII under both `firstName` and `first_name`.
   */
  readonly caseInsensitive?: boolean;
}

function buildFieldSet(
  fields: ReadonlyArray<string>,
  caseInsensitive: boolean,
): Set<string> {
  const out = new Set<string>();
  for (const f of fields) {
    out.add(caseInsensitive ? f.toLowerCase() : f);
    // Snake-case variant so `first_name` matches `firstName`.
    const snake = f.replace(/([A-Z])/g, '_$1').toLowerCase();
    out.add(caseInsensitive ? snake.toLowerCase() : snake);
  }
  return out;
}

const REDACTED_TOKEN = '[REDACTED]';
const CIRCULAR = '[CIRCULAR]';

/**
 * Recursively redact PII fields. Returns a new value — never mutates
 * the input.
 *
 * Behaviour:
 *   - Primitives are returned as-is (we only redact based on key
 *     names; we don't pattern-match values).
 *   - Arrays are walked element-by-element.
 *   - For plain objects, each key is checked against the PII set;
 *     matching keys get their value replaced with the redaction
 *     token. Non-matching values recurse.
 *   - Class instances (objects whose prototype is not `Object`) are
 *     treated as opaque — they're stringified via `String(value)` so
 *     we don't reach into internal state.
 *   - Cycles are detected via a WeakSet and replaced with `[CIRCULAR]`.
 *   - Depth limit prevents pathological logs from blowing the stack.
 */
export function redactPII<T>(input: T, opts: RedactOptions = {}): T {
  const caseInsensitive = opts.caseInsensitive ?? true;
  const fields = buildFieldSet(opts.fields ?? DEFAULT_PII_FIELDS, caseInsensitive);
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const format =
    opts.format ?? ((name: string) => `${REDACTED_TOKEN}:${name}`);
  const seen = new WeakSet<object>();
  return walk(input, fields, caseInsensitive, maxDepth, 0, format, seen) as T;
}

function walk(
  value: unknown,
  fields: Set<string>,
  caseInsensitive: boolean,
  maxDepth: number,
  depth: number,
  format: (fieldName: string) => string,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t !== 'object') return value;
  if (depth > maxDepth) return '[DEPTH_LIMIT]';

  if (Array.isArray(value)) {
    if (seen.has(value)) return CIRCULAR;
    seen.add(value);
    return value.map((item) =>
      walk(item, fields, caseInsensitive, maxDepth, depth + 1, format, seen),
    );
  }

  // Treat Date / RegExp / Map / Set + non-plain objects as opaque.
  const proto = Object.getPrototypeOf(value);
  if (proto !== null && proto !== Object.prototype) {
    if (value instanceof Date) return value.toISOString();
    // Buffer-like — never reveal payload bytes
    if (typeof (value as { byteLength?: number }).byteLength === 'number') {
      return '[BUFFER]';
    }
    // Error objects — keep name + message; drop stack to avoid leaking PII
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
      };
    }
    return String(value);
  }

  if (seen.has(value as object)) return CIRCULAR;
  seen.add(value as object);

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(obj)) {
    const probe = caseInsensitive ? key.toLowerCase() : key;
    const keyMatches = fields.has(probe);
    // If the key matches AND the value is a primitive, replace the
    // value. If the key matches but the value is itself an
    // object/array, recurse — so nested PII like `address.street`
    // still gets redacted under its own field name rather than
    // collapsed to `[REDACTED]:address` and losing the child labels.
    if (keyMatches && (v === null || v === undefined || typeof v !== 'object')) {
      out[key] = format(key);
      continue;
    }
    out[key] = walk(v, fields, caseInsensitive, maxDepth, depth + 1, format, seen);
  }
  return out;
}

/**
 * Convenience wrapper: tag a logger method so every call automatically
 * redacts PII in the payload. Use this when adopting the redactor into
 * an existing logger without changing every call site:
 *
 *   const safeLog = wrapLoggerWithRedaction(logger);
 *   safeLog.info('user created', { email: 'a@b.com' });
 *   //  -> logger.info('user created', { email: '[REDACTED]:email' });
 */
export function wrapLoggerWithRedaction<L extends LoggerLike>(
  logger: L,
  opts?: RedactOptions,
): L {
  const wrap = (
    method: 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'fatal',
  ) => {
    const original = logger[method];
    if (typeof original !== 'function') return undefined;
    return (...args: unknown[]) => {
      const redactedArgs = args.map((a) => redactPII(a, opts));
      return (original as (...a: unknown[]) => unknown).apply(
        logger,
        redactedArgs,
      );
    };
  };
  const proxy = Object.create(logger) as L;
  const methods: Array<keyof LoggerLike> = [
    'info',
    'warn',
    'error',
    'debug',
    'trace',
    'fatal',
  ];
  for (const m of methods) {
    const wrapped = wrap(m as 'info');
    if (wrapped) {
      (proxy as Record<string, unknown>)[m] = wrapped;
    }
  }
  return proxy;
}

export interface LoggerLike {
  info?: (...args: unknown[]) => unknown;
  warn?: (...args: unknown[]) => unknown;
  error?: (...args: unknown[]) => unknown;
  debug?: (...args: unknown[]) => unknown;
  trace?: (...args: unknown[]) => unknown;
  fatal?: (...args: unknown[]) => unknown;
}

export { DEFAULT_PII_FIELDS };
