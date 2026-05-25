/**
 * Libsodium-backed EncryptionPort.
 *
 * AEAD construction: XChaCha20-Poly1305 (libsodium's
 * `crypto_secretbox_easy` is XSalsa20-Poly1305, but we prefer
 * `crypto_aead_xchacha20poly1305_ietf_encrypt` because the 192-bit
 * nonce makes per-row random nonces collision-safe at every scale we
 * will ever hit). When the `libsodium-wrappers` dependency is not
 * present at runtime, the adapter transparently falls back to Node's
 * built-in `aes-256-gcm` so the database package remains testable
 * without an OS-level libsodium toolchain.
 *
 * Properties:
 *   - Per-row 192-bit (libsodium) or 96-bit (AES-GCM fallback) random nonce.
 *   - Authenticated — constant-time decrypt failure when ciphertext is
 *     tampered, key is wrong, or generation is mismatched.
 *   - Pure key material in process memory; never logged.
 *
 * The adapter is constructed with a `MasterKeySnapshot` so unit tests
 * can supply a deterministic key without touching env state.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

import {
  EncryptionAuthenticationError,
  type DecryptArgs,
  type EncryptArgs,
  type EncryptedBlob,
  type EncryptionAlgorithm,
  type EncryptionPort,
  type RotateArgs,
} from './encryption-port.js';
import {
  DEK_LENGTH_BYTES,
  deriveDek,
  type MasterKeySnapshot,
} from './tenant-key-derivation.js';

/** Nonce sizes per AEAD algorithm. */
const NONCE_BYTES_XCHACHA = 24; // libsodium xchacha20poly1305_ietf
const NONCE_BYTES_AES_GCM = 12; // Node's aes-256-gcm
const TAG_BYTES_AES_GCM = 16;

export interface LibsodiumAdapterDeps {
  readonly snapshot: MasterKeySnapshot;
  /** Test seam — inject a pre-loaded libsodium module. */
  readonly sodiumOverride?: SodiumLike | null;
  /** Force the Node-crypto fallback (used by tests). */
  readonly forceFallback?: boolean;
}

interface SodiumLike {
  readonly crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
  readonly crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
  randombytes_buf(length: number): Uint8Array;
  crypto_aead_xchacha20poly1305_ietf_encrypt(
    message: Uint8Array,
    additionalData: Uint8Array | null,
    secretNonce: Uint8Array | null,
    publicNonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;
  crypto_aead_xchacha20poly1305_ietf_decrypt(
    secretNonce: Uint8Array | null,
    ciphertext: Uint8Array,
    additionalData: Uint8Array | null,
    publicNonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;
}

/**
 * Build a libsodium-backed EncryptionPort. The libsodium module is
 * imported lazily so callers that pin to the Node-crypto fallback do
 * not pay the WASM init cost.
 *
 * Resolves to the AES-256-GCM fallback when libsodium fails to load.
 */
export async function createLibsodiumAdapter(
  deps: LibsodiumAdapterDeps,
): Promise<EncryptionPort> {
  const sodium = deps.forceFallback
    ? null
    : deps.sodiumOverride ?? (await tryLoadSodium());

  if (sodium) {
    return buildXChaChaAdapter(deps.snapshot, sodium);
  }
  return buildAesGcmFallback(deps.snapshot);
}

/**
 * Try to load `libsodium-wrappers`. Returns `null` (rather than
 * throwing) when the dep is not installed — callers fall back to the
 * Node-crypto path so the database package stays test-runnable without
 * the native module.
 */
async function tryLoadSodium(): Promise<SodiumLike | null> {
  try {
    // Dynamic import keeps this off the typecheck dependency graph.
    const moduleName = 'libsodium-wrappers';
    const mod = (await import(/* @vite-ignore */ moduleName)) as {
      default?: SodiumLike & { ready?: Promise<void> };
    } & Partial<SodiumLike> & { ready?: Promise<void> };
    const sodium = (mod.default ?? mod) as SodiumLike & {
      ready?: Promise<void>;
    };
    if (sodium.ready) {
      await sodium.ready;
    }
    if (
      typeof sodium.crypto_aead_xchacha20poly1305_ietf_encrypt !== 'function'
    ) {
      return null;
    }
    return sodium;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// XChaCha20-Poly1305 (libsodium) implementation
// ─────────────────────────────────────────────────────────────────────

function buildXChaChaAdapter(
  snapshot: MasterKeySnapshot,
  sodium: SodiumLike,
): EncryptionPort {
  const algorithm: EncryptionAlgorithm = 'xchacha20-poly1305';
  return {
    kind: 'libsodium',
    currentKeyVersion: snapshot.current.version,
    async encrypt({ plaintext, classification, tenantId }: EncryptArgs) {
      const dek = deriveDek({
        snapshot,
        keyVersion: snapshot.current.version,
        tenantId,
        table: classification.table,
        column: classification.column,
      });
      const nonce = sodium.randombytes_buf(NONCE_BYTES_XCHACHA);
      const message = toBytes(plaintext);
      const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        message,
        null,
        null,
        nonce,
        dek,
      );
      return {
        keyVersion: snapshot.current.version,
        algorithm,
        nonce: bytesToBase64(nonce),
        ciphertext: bytesToBase64(ciphertext),
      };
    },
    async decrypt({ blob, classification, tenantId }: DecryptArgs) {
      if (blob.algorithm !== 'xchacha20-poly1305') {
        // Mixed-adapter run: AES blob with libsodium adapter — re-route
        // through the AES path so reads still work.
        return decryptAesGcmBlob(snapshot, blob, classification, tenantId);
      }
      const dek = deriveDek({
        snapshot,
        keyVersion: blob.keyVersion,
        tenantId,
        table: classification.table,
        column: classification.column,
      });
      const nonce = base64ToBytes(blob.nonce);
      const ciphertext = base64ToBytes(blob.ciphertext);
      try {
        const plain = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          ciphertext,
          null,
          nonce,
          dek,
        );
        return Buffer.from(plain).toString('utf8');
      } catch {
        throw new EncryptionAuthenticationError();
      }
    },
    async rotate({ blob, classification, tenantId }: RotateArgs) {
      if (blob.keyVersion === snapshot.current.version) return blob;
      const plain = await this.decrypt({ blob, classification, tenantId });
      return this.encrypt({
        plaintext: plain,
        classification,
        tenantId,
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// AES-256-GCM (Node built-in) fallback implementation
// ─────────────────────────────────────────────────────────────────────

function buildAesGcmFallback(snapshot: MasterKeySnapshot): EncryptionPort {
  const algorithm: EncryptionAlgorithm = 'aes-256-gcm';
  return {
    kind: 'libsodium',
    currentKeyVersion: snapshot.current.version,
    async encrypt({ plaintext, classification, tenantId }: EncryptArgs) {
      const dek = deriveDek({
        snapshot,
        keyVersion: snapshot.current.version,
        tenantId,
        table: classification.table,
        column: classification.column,
      });
      const nonce = randomBytes(NONCE_BYTES_AES_GCM);
      const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek), nonce);
      const message = toBytes(plaintext);
      const enc = Buffer.concat([
        cipher.update(Buffer.from(message)),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      // Concatenate (ciphertext || tag) so the on-disk shape mirrors
      // libsodium's combined output.
      const combined = Buffer.concat([enc, tag]);
      return {
        keyVersion: snapshot.current.version,
        algorithm,
        nonce: bytesToBase64(nonce),
        ciphertext: bytesToBase64(combined),
      };
    },
    async decrypt({ blob, classification, tenantId }: DecryptArgs) {
      return decryptAesGcmBlob(snapshot, blob, classification, tenantId);
    },
    async rotate({ blob, classification, tenantId }: RotateArgs) {
      if (blob.keyVersion === snapshot.current.version) return blob;
      const plain = await this.decrypt({ blob, classification, tenantId });
      return this.encrypt({
        plaintext: plain,
        classification,
        tenantId,
      });
    },
  };
}

function decryptAesGcmBlob(
  snapshot: MasterKeySnapshot,
  blob: EncryptedBlob,
  classification: { readonly table: string; readonly column: string },
  tenantId: string | null,
): string {
  if (blob.algorithm !== 'aes-256-gcm') {
    throw new EncryptionAuthenticationError();
  }
  const dek = deriveDek({
    snapshot,
    keyVersion: blob.keyVersion,
    tenantId,
    table: classification.table,
    column: classification.column,
  });
  const nonce = base64ToBytes(blob.nonce);
  if (nonce.length !== NONCE_BYTES_AES_GCM) {
    throw new EncryptionAuthenticationError();
  }
  const combined = base64ToBytes(blob.ciphertext);
  if (combined.length < TAG_BYTES_AES_GCM) {
    throw new EncryptionAuthenticationError();
  }
  const ciphertext = combined.subarray(0, combined.length - TAG_BYTES_AES_GCM);
  const tag = combined.subarray(combined.length - TAG_BYTES_AES_GCM);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(dek),
    Buffer.from(nonce),
  );
  decipher.setAuthTag(Buffer.from(tag));
  try {
    const out = Buffer.concat([
      decipher.update(Buffer.from(ciphertext)),
      decipher.final(),
    ]);
    return out.toString('utf8');
  } catch {
    throw new EncryptionAuthenticationError();
  }
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function toBytes(value: string | Uint8Array): Uint8Array {
  if (typeof value === 'string') return new Uint8Array(Buffer.from(value, 'utf8'));
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Test introspection — exposes the DEK length constant. */
export const __TEST_ONLY__ = {
  DEK_LENGTH_BYTES,
  NONCE_BYTES_XCHACHA,
  NONCE_BYTES_AES_GCM,
};
