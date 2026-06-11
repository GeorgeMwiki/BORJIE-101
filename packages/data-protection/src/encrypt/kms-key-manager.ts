/**
 * KMS-backed KeyManager adapter (DP-06 — data-protection at rest).
 *
 * Implements the package's `KeyManager` port over a pluggable KMS PORT so a
 * region-bound CMK (Customer Master Key) wraps the per-row DEK without the
 * raw KEK ever entering JS memory. The DEK itself is generated in-process
 * (32 random bytes) and sent to KMS to be WRAPPED; KMS returns the wrapped
 * blob. Unwrap reverses it. The `EncryptionContext` (tenant|field|resource)
 * is passed to KMS as its EncryptionContext so a blob minted for one
 * (tenant, field) can NEVER be decrypted under another — AAD binding all the
 * way down to the HSM.
 *
 * Why a PORT, not a direct `@aws-sdk/client-kms` import:
 *   - The AWS SDK is an OPTIONAL peer dep — most workspace packages and all
 *     unit tests must build + run WITHOUT it on the install graph.
 *   - Residency: a single-Region CMK per region is the SOTA choice (AWS KMS
 *     multi-Region keys move key material across borders, defeating
 *     residency). The port is constructed per-region by the composition root
 *     (api-gateway/database) which already resolves the tenant's region.
 *   - Local dev / CI: when no KMS port is supplied we fall back to the
 *     in-memory KEK manager (UNSAFE for prod, explicit in the `kind`).
 *
 * This file reads NO `process.env` — the region + key id + the concrete KMS
 * client are injected by the caller (no-process.env-outside-bootstrap rule).
 *
 * Regulatory anchors: NIST SP 800-57 (KEK wraps DEK), GDPR Art.32, TZ PDPA
 * s.30, AWS KMS data-residency guidance.
 */

import { bytesToHex } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';

import { DataProtectionInvariantError, type KeyKind } from '../types.js';
import { KEY_LENGTH } from './aead-cipher.js';
import {
  createInMemoryKeyManager,
  digestContext,
  type EncryptionContext,
  type KeyManager,
  type WrappedDek,
} from './key-manager.js';

/**
 * The minimal KMS surface this adapter consumes. An AWS-KMS adapter, a GCP
 * EKM adapter, or a test double all conform to this — the data-protection
 * package never imports a concrete cloud SDK.
 *
 * `wrapDek` / `unwrapDek` map onto KMS `Encrypt` / `Decrypt` (the DEK is the
 * plaintext KMS protects). `encryptionContext` becomes the KMS
 * EncryptionContext (additional authenticated data bound to the HSM op).
 */
export interface KmsPort {
  /** Opaque key reference (KMS ARN / alias / key id). */
  readonly keyRef: string;
  /** Region the CMK is bound to — surfaced for residency audit logs. */
  readonly region: string;
  /** Wrap (KMS Encrypt) the raw DEK; returns the opaque ciphertext blob. */
  wrap(input: {
    readonly plaintext: Uint8Array;
    readonly encryptionContext: Readonly<Record<string, string>>;
  }): Promise<Uint8Array>;
  /** Unwrap (KMS Decrypt) the wrapped DEK; throws on context mismatch. */
  unwrap(input: {
    readonly ciphertext: Uint8Array;
    readonly encryptionContext: Readonly<Record<string, string>>;
  }): Promise<Uint8Array>;
}

function contextRecord(
  context: EncryptionContext,
): Readonly<Record<string, string>> {
  // KMS EncryptionContext values must be strings; bind the same three
  // dimensions the in-memory adapter binds into its AAD.
  return Object.freeze({
    tenant: context.tenantId,
    field: context.field,
    resource: context.resource,
  });
}

export interface KmsKeyManagerOptions {
  readonly kms: KmsPort;
  /** KEK residency mode recorded on the manager. Default `customer-managed-byok`. */
  readonly kind?: KeyKind;
}

/**
 * Build a KeyManager whose KEK lives in a KMS / HSM (never in JS). The
 * `WrappedDek.nonce` is unused by this adapter (KMS owns its own envelope),
 * so it is a stable zero-length marker; `ciphertext` is the KMS blob and
 * `keyRef` is the CMK reference. `contextHash` binds the (tenant, field,
 * resource) so an unwrap under a different context fails closed.
 */
export function createKmsKeyManager(opts: KmsKeyManagerOptions): KeyManager {
  const kms = opts.kms;
  const kind: KeyKind = opts.kind ?? 'customer-managed-byok';
  const keyRef = kms.keyRef;

  return Object.freeze({
    kind,
    keyRef,
    async wrapDek({
      dek,
      context,
    }: {
      readonly dek: Uint8Array;
      readonly context: EncryptionContext;
    }): Promise<WrappedDek> {
      if (dek.length !== KEY_LENGTH) {
        throw new DataProtectionInvariantError(
          'dek.key_length',
          `DEK must be ${KEY_LENGTH} bytes, got ${dek.length}.`,
        );
      }
      const ciphertext = await kms.wrap({
        plaintext: dek,
        encryptionContext: contextRecord(context),
      });
      return Object.freeze({
        keyRef,
        algorithm: 'aes-256-gcm' as const,
        // KMS owns the envelope; no app-level wrap nonce.
        nonce: new Uint8Array(0),
        ciphertext,
        contextHash: digestContext(context),
      });
    },
    async unwrapDek({
      wrapped,
      context,
    }: {
      readonly wrapped: WrappedDek;
      readonly context: EncryptionContext;
    }): Promise<Uint8Array> {
      if (wrapped.keyRef !== keyRef) {
        throw new DataProtectionInvariantError(
          'kek.ref_mismatch',
          `Wrapped DEK was minted under ${wrapped.keyRef}, not ${keyRef}.`,
        );
      }
      const expectedHash = digestContext(context);
      if (expectedHash !== wrapped.contextHash) {
        throw new DataProtectionInvariantError(
          'kek.context_mismatch',
          'Encryption context does not match the wrapped DEK.',
        );
      }
      const dek = await kms.unwrap({
        ciphertext: wrapped.ciphertext,
        encryptionContext: contextRecord(context),
      });
      if (dek.length !== KEY_LENGTH) {
        throw new DataProtectionInvariantError(
          'kek.dek_length',
          `KMS returned a DEK of ${dek.length} bytes, expected ${KEY_LENGTH}.`,
        );
      }
      return dek;
    },
    async rotate(): Promise<KeyManager> {
      // CMK rotation is a KMS-side operation (alias re-point / scheduled
      // rotation). The manager identity is the alias, so it is stable; the
      // re-encrypt job (rotation.ts) re-wraps existing DEKs under the new
      // CMK generation. Return self — the alias keeps resolving.
      return createKmsKeyManager(opts);
    },
  });
}

/**
 * Lazily build an AWS-KMS-backed `KmsPort` from `@aws-sdk/client-kms`. The
 * SDK is an OPTIONAL peer dep — this function dynamic-imports it so the
 * package builds + unit-tests WITHOUT the SDK on the graph. Returns `null`
 * when the SDK is absent so the caller can fall back to the local manager.
 *
 * The KMS key id + region come from the caller (composition root), never
 * from `process.env` here.
 */
export async function tryCreateAwsKmsPort(input: {
  readonly keyId: string;
  readonly region: string;
}): Promise<KmsPort | null> {
  let mod: unknown;
  try {
    // Indirected so bundlers do not hard-require the optional SDK.
    const specifier = '@aws-sdk/client-kms';
    mod = await import(/* @vite-ignore */ specifier);
  } catch {
    return null;
  }
  const sdk = mod as {
    KMSClient?: new (cfg: { region: string }) => unknown;
    EncryptCommand?: new (input: unknown) => unknown;
    DecryptCommand?: new (input: unknown) => unknown;
  };
  if (!sdk.KMSClient || !sdk.EncryptCommand || !sdk.DecryptCommand) {
    return null;
  }
  const client = new sdk.KMSClient({ region: input.region }) as {
    send: (cmd: unknown) => Promise<{ CiphertextBlob?: Uint8Array; Plaintext?: Uint8Array }>;
  };
  const EncryptCommand = sdk.EncryptCommand;
  const DecryptCommand = sdk.DecryptCommand;

  return Object.freeze({
    keyRef: input.keyId,
    region: input.region,
    async wrap({
      plaintext,
      encryptionContext,
    }: {
      readonly plaintext: Uint8Array;
      readonly encryptionContext: Readonly<Record<string, string>>;
    }): Promise<Uint8Array> {
      const out = await client.send(
        new EncryptCommand({
          KeyId: input.keyId,
          Plaintext: plaintext,
          EncryptionContext: { ...encryptionContext },
        }),
      );
      if (!out.CiphertextBlob) {
        throw new DataProtectionInvariantError(
          'kms.wrap_empty',
          'KMS Encrypt returned no CiphertextBlob.',
        );
      }
      return out.CiphertextBlob;
    },
    async unwrap({
      ciphertext,
      encryptionContext,
    }: {
      readonly ciphertext: Uint8Array;
      readonly encryptionContext: Readonly<Record<string, string>>;
    }): Promise<Uint8Array> {
      const out = await client.send(
        new DecryptCommand({
          KeyId: input.keyId,
          CiphertextBlob: ciphertext,
          EncryptionContext: { ...encryptionContext },
        }),
      );
      if (!out.Plaintext) {
        throw new DataProtectionInvariantError(
          'kms.unwrap_empty',
          'KMS Decrypt returned no Plaintext.',
        );
      }
      return out.Plaintext;
    },
  });
}

/**
 * Resolve a KeyManager for a tenant's residency region.
 *
 * Tries the AWS-KMS port first (single-Region CMK bound to `region`). When
 * the optional SDK is absent OR no `keyId` is configured (local dev / CI),
 * falls back to the in-memory KEK manager whose `keyRef` is derived from a
 * deterministic seed so the SAME region resolves the SAME local KEK within a
 * process (round-trips stay consistent). The `kind` makes the degraded mode
 * explicit in audit logs.
 *
 * IMPORTANT: the in-memory fallback is UNSAFE for production — the caller
 * MUST treat a `platform-managed` (fallback) manager in prod as a
 * misconfiguration and surface it on the deep-health probe.
 */
export async function resolveRegionKeyManager(input: {
  readonly region: string;
  readonly keyId?: string;
  /** Deterministic local seed (dev fallback only). Defaults to the region. */
  readonly localSeed?: string;
}): Promise<{ readonly manager: KeyManager; readonly backedByKms: boolean }> {
  if (input.keyId) {
    const port = await tryCreateAwsKmsPort({
      keyId: input.keyId,
      region: input.region,
    });
    if (port) {
      return Object.freeze({
        manager: createKmsKeyManager({ kms: port }),
        backedByKms: true,
      });
    }
  }
  // Fallback: a deterministic per-region in-memory KEK (dev / CI only).
  const seed = input.localSeed ?? input.region;
  const kek = sha256(utf8ToBytes(`borjie-local-kek:${seed}`));
  const manager = createInMemoryKeyManager({
    kind: 'platform-managed',
    keyRef: `local-region:${input.region}:${bytesToHex(kek).slice(0, 12)}`,
    kek,
  });
  return Object.freeze({ manager, backedByKms: false });
}
