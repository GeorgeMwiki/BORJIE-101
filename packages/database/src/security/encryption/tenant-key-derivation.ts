/**
 * Per-tenant key derivation.
 *
 * The platform stores ONE master key (`ENCRYPTION_MASTER_KEY`, 32 random
 * bytes encoded as base64). Per-tenant data-encryption keys (DEKs) are
 * derived deterministically from the master via HKDF-SHA256 with a
 * structured `info` parameter:
 *
 *     info = "borjie/encryption/v<keyVersion>/tenant/<tenantId|_platform>/table/<table>/column/<column>"
 *
 * Properties:
 *
 *   - Per-tenant isolation: Tenant A's DEK is cryptographically
 *     independent from Tenant B's. Compromising tenant A's blobs
 *     yields no information about tenant B's blobs.
 *   - Per-field isolation: Bonus defence-in-depth — an oracle on
 *     `customers.email` does not yield `customers.kra_pin`.
 *   - Stateless: No DEK persistence; the master + the row's metadata
 *     is sufficient to re-derive on read.
 *   - Versioned: Bumping `ENCRYPTION_MASTER_KEY_VERSION` (and supplying
 *     `ENCRYPTION_MASTER_KEY_V<n>` for each generation) yields a new
 *     DEK domain — rotation does not need to touch the DEKs directly.
 *
 * Uses Node's built-in `crypto.hkdfSync` so the derivation works
 * without libsodium being installed (tests + dev environments).
 */

import { hkdfSync } from 'node:crypto';

import { EncryptionKeyUnavailableError } from './encryption-port.js';

/** Length of every derived DEK in bytes. 32 ⇒ XChaCha20-Poly1305 / AES-256-GCM key. */
export const DEK_LENGTH_BYTES = 32;

/**
 * Snapshot of the platform master-key material. Holds one or more
 * generations so we can rotate without dropping legacy ciphertext.
 *
 * `current` is the generation new writes use. `previous` (optional) is
 * still accepted by `decrypt` so rows persisted under the old key
 * remain readable during the soak window described in `Docs/SECURITY/
 * ENCRYPTION_AT_REST.md`.
 */
export interface MasterKeySnapshot {
  readonly current: { readonly version: number; readonly bytes: Uint8Array };
  readonly previous?: { readonly version: number; readonly bytes: Uint8Array };
}

/**
 * Build a MasterKeySnapshot from environment variables. The reader is
 * lenient on the inputs so unit tests can construct the snapshot
 * directly without env mutation.
 *
 *   ENCRYPTION_MASTER_KEY            — required; 32-byte base64
 *   ENCRYPTION_MASTER_KEY_VERSION    — optional integer (default 1)
 *   ENCRYPTION_MASTER_KEY_PREV       — optional 32-byte base64
 *   ENCRYPTION_MASTER_KEY_PREV_VERSION — optional integer
 */
export interface EncryptionEnv {
  readonly ENCRYPTION_MASTER_KEY?: string;
  readonly ENCRYPTION_MASTER_KEY_VERSION?: string;
  readonly ENCRYPTION_MASTER_KEY_PREV?: string;
  readonly ENCRYPTION_MASTER_KEY_PREV_VERSION?: string;
}

export function loadMasterKeySnapshot(
  env: EncryptionEnv,
): MasterKeySnapshot {
  const rawCurrent = env.ENCRYPTION_MASTER_KEY;
  if (!rawCurrent) {
    throw new EncryptionKeyUnavailableError(
      'ENCRYPTION_MASTER_KEY not configured — refusing to start without master key (see Docs/SECURITY/ENCRYPTION_AT_REST.md)',
    );
  }
  const currentBytes = decodeBase64Key(rawCurrent, 'ENCRYPTION_MASTER_KEY');
  const currentVersion = parsePositiveInt(
    env.ENCRYPTION_MASTER_KEY_VERSION,
    1,
  );

  if (!env.ENCRYPTION_MASTER_KEY_PREV) {
    return {
      current: { version: currentVersion, bytes: currentBytes },
    };
  }
  const previousBytes = decodeBase64Key(
    env.ENCRYPTION_MASTER_KEY_PREV,
    'ENCRYPTION_MASTER_KEY_PREV',
  );
  const previousVersion = parsePositiveInt(
    env.ENCRYPTION_MASTER_KEY_PREV_VERSION,
    Math.max(1, currentVersion - 1),
  );
  return {
    current: { version: currentVersion, bytes: currentBytes },
    previous: { version: previousVersion, bytes: previousBytes },
  };
}

/**
 * Derive the per-(tenant, table, column, version) DEK. Pure function —
 * no I/O. Safe to call on every encrypt; HKDF is cheap (a single HMAC).
 *
 * When `tenantId` is null/empty, the platform-default scope is used.
 * Per-tenant rows MUST always pass a non-empty tenantId.
 */
export function deriveDek(args: {
  readonly snapshot: MasterKeySnapshot;
  readonly keyVersion: number;
  readonly tenantId: string | null;
  readonly table: string;
  readonly column: string;
}): Uint8Array {
  const masterBytes = pickMasterForVersion(args.snapshot, args.keyVersion);
  const info = formatInfo({
    keyVersion: args.keyVersion,
    tenantId: args.tenantId,
    table: args.table,
    column: args.column,
  });
  // `hkdfSync` requires a non-empty salt; we use a fixed application
  // tag so derivations are deterministic across deploys. Salt is NOT
  // a secret — its purpose is domain separation.
  const salt = Buffer.from('borjie.encryption.v1', 'utf8');
  const derived = hkdfSync(
    'sha256',
    masterBytes,
    salt,
    Buffer.from(info, 'utf8'),
    DEK_LENGTH_BYTES,
  );
  // hkdfSync returns ArrayBuffer; wrap as Uint8Array (no copy).
  return new Uint8Array(derived as ArrayBuffer);
}

/**
 * Pick the master bytes for a given generation. Throws when the
 * blob refers to a generation neither current nor previous — the
 * operator must re-supply the older key material to read it.
 */
function pickMasterForVersion(
  snapshot: MasterKeySnapshot,
  version: number,
): Uint8Array {
  if (snapshot.current.version === version) {
    return snapshot.current.bytes;
  }
  if (snapshot.previous && snapshot.previous.version === version) {
    return snapshot.previous.bytes;
  }
  throw new EncryptionKeyUnavailableError(
    `encryption: no master key material for key_version=${version}`,
  );
}

function formatInfo(args: {
  readonly keyVersion: number;
  readonly tenantId: string | null;
  readonly table: string;
  readonly column: string;
}): string {
  const tenantScope =
    args.tenantId && args.tenantId.length > 0 ? args.tenantId : '_platform';
  return [
    'borjie/encryption',
    `v${args.keyVersion}`,
    'tenant',
    tenantScope,
    'table',
    args.table.toLowerCase(),
    'column',
    args.column.toLowerCase(),
  ].join('/');
}

function decodeBase64Key(value: string, name: string): Uint8Array {
  // Accept base64 OR base64url. Reject anything shorter than 32 bytes.
  const trimmed = value.trim();
  if (!trimmed) {
    throw new EncryptionKeyUnavailableError(`${name}: empty value`);
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(trimmed, 'base64');
  } catch {
    throw new EncryptionKeyUnavailableError(`${name}: invalid base64`);
  }
  if (buf.length < DEK_LENGTH_BYTES) {
    throw new EncryptionKeyUnavailableError(
      `${name}: must decode to at least ${DEK_LENGTH_BYTES} bytes (got ${buf.length})`,
    );
  }
  // Always take the first 32 bytes — caller can supply a longer
  // value (e.g. 64-byte CSPRNG output) without breaking compatibility.
  return new Uint8Array(buf.subarray(0, DEK_LENGTH_BYTES));
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return fallback;
  return n;
}
