/**
 * Default local Ed25519 signer + verifier (LP-19).
 *
 * A zero-dependency `SignerPort` backed by `node:crypto`. Suitable for
 * dev, tests, and air-gapped signing. PRODUCTION should inject a
 * KMS/HSM-backed `SignerPort` instead (the orchestrator does not care
 * which) so the private key never lives in process memory. This signer
 * exists so the package is usable out of the box and so the signature
 * round-trip is verifiable in unit tests.
 *
 * Ed25519 is chosen over RSA/ECDSA: deterministic signatures (no RNG
 * malleability), small keys, fast verify — ideal for a transparency
 * checkpoint a regulator re-verifies offline.
 *
 * @module @borjie/ledger-attestor/signers/ed25519-signer
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto';
import type { Signature, SignerPort } from '../types.js';

const ALGORITHM = 'ed25519';

/** Stable key id = sha256(SPKI DER) truncated — a key fingerprint. */
function fingerprint(publicKey: KeyObject): string {
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return `ed25519:${createHash('sha256').update(der).digest('hex').slice(0, 16)}`;
}

export interface Ed25519SignerConfig {
  /** PEM-encoded PKCS#8 private key. Generated if omitted. */
  readonly privateKeyPem?: string;
  /** Override the derived key id (e.g. a KMS alias). */
  readonly keyId?: string;
}

export interface Ed25519SignerHandle {
  readonly signer: SignerPort;
  /** PEM-encoded SPKI public key — hand to verifiers / publish alongside. */
  readonly publicKeyPem: string;
}

/**
 * Build a local Ed25519 `SignerPort`. When no key is supplied a fresh
 * keypair is generated (dev/test). The handle exposes the public key
 * PEM so a verifier can be constructed from it.
 */
export function createEd25519Signer(
  config: Ed25519SignerConfig = {},
): Ed25519SignerHandle {
  let privateKey: KeyObject;
  if (config.privateKeyPem !== undefined) {
    privateKey = createPrivateKey(config.privateKeyPem);
  } else {
    privateKey = generateKeyPairSync('ed25519').privateKey;
  }
  const publicKey = createPublicKey(privateKey);
  const keyId = config.keyId ?? fingerprint(publicKey);
  const publicKeyPem = publicKey
    .export({ type: 'spki', format: 'pem' })
    .toString();

  const signer: SignerPort = {
    keyId,
    algorithm: ALGORITHM,
    async sign(message: string): Promise<Signature> {
      // Ed25519 takes no digest algorithm argument (null) — it hashes
      // internally with SHA-512.
      const sig = cryptoSign(null, Buffer.from(message, 'utf8'), privateKey);
      return Object.freeze({
        algorithm: ALGORITHM,
        keyId,
        signatureB64: sig.toString('base64'),
      });
    },
  };

  return { signer, publicKeyPem };
}

/**
 * Verify a signature produced by {@link createEd25519Signer} against
 * the canonical checkpoint `message`. Returns false on any mismatch or
 * malformed input — never throws.
 */
export function verifyEd25519(
  message: string,
  signature: Signature,
  publicKeyPem: string,
): boolean {
  if (signature.algorithm !== ALGORITHM) return false;
  try {
    const publicKey = createPublicKey(publicKeyPem);
    return cryptoVerify(
      null,
      Buffer.from(message, 'utf8'),
      publicKey,
      Buffer.from(signature.signatureB64, 'base64'),
    );
  } catch {
    return false;
  }
}
