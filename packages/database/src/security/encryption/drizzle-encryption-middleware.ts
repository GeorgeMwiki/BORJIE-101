/**
 * Drizzle field-encryption middleware.
 *
 * Consults the `data-classification.ts` registry on every insert /
 * update / select; encrypts the value before it hits Postgres and
 * decrypts on the way back so callers see plaintext at the service
 * boundary. The on-disk representation is the JSON `enc:v1:{…}` blob
 * defined in `encryption-port.ts`.
 *
 * Design:
 *
 *   - Pure helper functions over Drizzle. We do NOT monkey-patch the
 *     drizzle client; instead each service that needs encryption uses
 *     `encryptRow(row, …)` before `db.insert(table).values(row)` and
 *     `decryptRow(row, …)` after `db.select().from(table)`. This keeps
 *     the surface explicit, type-safe, and friction-free to migrate
 *     incrementally.
 *   - `encryptRow` is a no-op for columns not registered with
 *     `encryptAtRest: true`. Calling it on every insert is safe and
 *     cheap (single Map lookup per column).
 *   - Audit hook: every encrypt event optionally fans out to an
 *     injected `AuditSink` so the operator can reconstruct which rows
 *     were encrypted with which key version (powers rotation auditing).
 *
 * Migration pathway: existing plaintext rows pass through unchanged —
 * the read path detects "no `enc:v1:` prefix" and returns the value
 * as-is. Operators run `scripts/encrypt-existing-rows.mjs` to migrate
 * historical rows asynchronously.
 */

import {
  classify,
  classificationsForTable,
  type FieldClassification,
} from '../data-classification.js';
import { logger } from '../../logger.js';
import {
  deserializeBlob,
  ENCRYPTED_BLOB_PREFIX,
  serializeBlob,
  type EncryptionPort,
} from './encryption-port.js';

/**
 * Sink invoked once per encrypted column write. Implementations
 * persist (tenantId, table, column, rowId, keyVersion) so the operator
 * can audit which rows used the current generation vs. the previous.
 *
 * The hook is fire-and-forget — the middleware never blocks the write
 * on the audit sink completing. Errors are swallowed (logged) so a
 * failing audit table does not break the primary write path.
 */
export interface FieldEncryptionAuditSink {
  recordEncryptedField(args: {
    readonly tenantId: string | null;
    readonly table: string;
    readonly column: string;
    readonly rowId: string | null;
    readonly keyVersion: number;
  }): void | Promise<void>;
}

export interface EncryptRowArgs<T extends Record<string, unknown>> {
  readonly row: T;
  readonly table: string;
  readonly tenantId: string | null;
  readonly rowId?: string | null;
  readonly port: EncryptionPort;
  readonly audit?: FieldEncryptionAuditSink;
  /**
   * Drizzle column-name strategy. Defaults to `snake_case` (matches
   * BOSS schemas). Override for tables that use camelCase column
   * names in the data-classification registry.
   */
  readonly columnNameMap?: (jsKey: string) => string;
}

export interface DecryptRowArgs<T extends Record<string, unknown>> {
  readonly row: T;
  readonly table: string;
  readonly tenantId: string | null;
  readonly port: EncryptionPort;
  readonly columnNameMap?: (jsKey: string) => string;
}

/**
 * Encrypt every `encryptAtRest: true` column in `row`. Returns a NEW
 * object — never mutates the input.
 *
 * `null` / `undefined` field values pass through unchanged. Already-
 * encrypted values (those that start with `enc:v1:`) also pass through
 * unchanged — idempotent on retried inserts.
 */
export async function encryptRow<T extends Record<string, unknown>>(
  args: EncryptRowArgs<T>,
): Promise<T> {
  const classifications = registryForTable(args.table);
  if (classifications.length === 0) return args.row;
  const nameMap = args.columnNameMap ?? toSnakeCase;
  // Build a fresh object so we never mutate the caller's input.
  const out: Record<string, unknown> = { ...args.row };
  for (const [jsKey, value] of Object.entries(args.row)) {
    if (value === null || value === undefined) continue;
    const dbColumn = nameMap(jsKey);
    const classification = classify(args.table, dbColumn);
    if (!classification || !classification.encryptAtRest) continue;
    if (typeof value !== 'string' && !(value instanceof Uint8Array)) {
      // Encryption only meaningful for string / bytes columns. Skip
      // numbers, dates, booleans — those should not be in the registry
      // with encryptAtRest=true. Defensive pass-through.
      continue;
    }
    if (typeof value === 'string' && value.startsWith(ENCRYPTED_BLOB_PREFIX)) {
      // Idempotent: already encrypted, leave untouched.
      continue;
    }
    const blob = await args.port.encrypt({
      plaintext: value,
      classification,
      tenantId: args.tenantId,
    });
    out[jsKey] = serializeBlob(blob);
    if (args.audit) {
      // Fire-and-forget — never block the write on audit success.
      Promise.resolve()
        .then(() =>
          args.audit?.recordEncryptedField({
            tenantId: args.tenantId,
            table: classification.table,
            column: classification.column,
            rowId: args.rowId ?? null,
            keyVersion: blob.keyVersion,
          }),
        )
        .catch((error: unknown) => {
          logger.warn('[encryption.audit] sink failure (non-fatal)', {
            table: classification.table,
            column: classification.column,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
  }
  return out as T;
}

/**
 * Decrypt every encrypted-on-disk value in `row`. Returns a NEW
 * object. Plaintext (legacy) values pass through unchanged.
 *
 * Decrypt failures (tampered ciphertext, wrong key) throw
 * `EncryptionAuthenticationError` — the caller should surface 500 to
 * the user and emit a security event. Never log the offending value.
 */
export async function decryptRow<T extends Record<string, unknown>>(
  args: DecryptRowArgs<T>,
): Promise<T> {
  const classifications = registryForTable(args.table);
  if (classifications.length === 0) return args.row;
  const nameMap = args.columnNameMap ?? toSnakeCase;
  const out: Record<string, unknown> = { ...args.row };
  for (const [jsKey, value] of Object.entries(args.row)) {
    if (value === null || value === undefined) continue;
    if (typeof value !== 'string') continue;
    if (!value.startsWith(ENCRYPTED_BLOB_PREFIX)) continue; // legacy plaintext
    const dbColumn = nameMap(jsKey);
    const classification = classify(args.table, dbColumn);
    if (!classification) continue; // unregistered — pass through
    const blob = deserializeBlob(value);
    if (!blob) continue; // malformed; pass through (security event surfaced elsewhere)
    const plain = await args.port.decrypt({
      blob,
      classification,
      tenantId: args.tenantId,
    });
    out[jsKey] = typeof plain === 'string' ? plain : Buffer.from(plain).toString('utf8');
  }
  return out as T;
}

/**
 * Decrypt an array of rows. Convenience for `select()` paths.
 */
export async function decryptRows<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  args: Omit<DecryptRowArgs<T>, 'row'>,
): Promise<ReadonlyArray<T>> {
  if (!rows || rows.length === 0) return rows;
  const out: T[] = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    out.push(await decryptRow({ ...args, row }));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Cache the per-table classification lookup so we don't re-scan on each call. */
const TABLE_CACHE = new Map<string, ReadonlyArray<FieldClassification>>();

function registryForTable(table: string): ReadonlyArray<FieldClassification> {
  const key = table.toLowerCase();
  const cached = TABLE_CACHE.get(key);
  if (cached) return cached;
  const fresh = classificationsForTable(table).filter((c) => c.encryptAtRest);
  TABLE_CACHE.set(key, fresh);
  return fresh;
}

/**
 * Default JS-to-SQL column-name converter. `firstName` → `first_name`.
 * BOSS schemas universally use snake_case in the `data-classification`
 * registry; Drizzle JS keys are camelCase. Match-rate is ~100% across
 * the schemas under `packages/database/src/schemas/`.
 */
export function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * Test seam — empties the per-table classification cache so tests can
 * assert independent behaviour after monkey-patching the registry.
 */
export function __resetTableCacheForTests(): void {
  TABLE_CACHE.clear();
}
