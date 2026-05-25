/**
 * Ed25519 signature scheme for the BrainToolSpec registry.
 *
 * Phase D agent D9 — A3/A5 Tier-2 closure (Agentforce Trust Layer).
 *
 * Every BrainToolSpec entry in the production registry MUST be signed by a
 * known publisher key. When the kernel-side HQ tool dispatcher looks up
 * a spec, it FIRST verifies the spec's canonical hash against the
 * embedded signature using the corresponding public key. Unsigned or
 * tampered specs are rejected before invocation.
 *
 * Canonicalisation rules (deterministic):
 *   - sort object keys lexicographically
 *   - drop function fields (executor) — they are not signed; only the
 *     declarative shape (name, description, tier, requiresApproval,
 *     schemaIn/schemaOut signatures) is part of the signed manifest
 *   - normalise whitespace inside string fields
 *
 * Signing uses Ed25519 via `node:crypto`. Keys are passed as raw 32-byte
 * Uint8Array (private) / 32-byte Uint8Array (public) per RFC 8032.
 *
 * The scheme is intentionally simple: one key per publisher, one
 * signature per spec. Key rotation is handled out-of-band; callers
 * iterate over a list of trusted keys and accept the first valid
 * signature.
 */

import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SignedManifest {
  /** The canonical JSON string that was signed. */
  readonly canonical: string;
  /** SHA-256 of `canonical`, hex-encoded. */
  readonly digest: string;
  /** Ed25519 signature over `canonical` (raw bytes), hex-encoded. */
  readonly signature: string;
  /** Identifier of the public key used to sign. */
  readonly publisherKeyId: string;
  /** ISO timestamp when the manifest was signed. */
  readonly signedAt: string;
}

export interface ToolSignaturePublicKey {
  readonly id: string;
  /** Ed25519 public key — 32 raw bytes. */
  readonly publicKey: Uint8Array;
}

export interface ToolSignaturePrivateKey {
  readonly id: string;
  /** Ed25519 private key — 32 raw bytes. */
  readonly privateKey: Uint8Array;
}

export interface SignableSpec {
  readonly name: string;
  readonly description: string;
  readonly tier: string;
  readonly requiresApproval: boolean;
  /** Optional schema-version hash captured at publish time. */
  readonly schemaInSig?: string;
  readonly schemaOutSig?: string;
}

// ---------------------------------------------------------------------------
// Canonicalisation
// ---------------------------------------------------------------------------

function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalise);
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => typeof v !== 'function' && typeof v !== 'undefined')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    out[k] = canonicalise(v);
  }
  return out;
}

export function canonicalJson(spec: SignableSpec): string {
  return JSON.stringify(canonicalise(spec));
}

async function sha256Hex(input: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Key helpers — raw 32-byte ↔ KeyObject
// ---------------------------------------------------------------------------

const ED25519_PRIVATE_PKCS8_PREFIX = Buffer.from(
  '302e020100300506032b657004220420',
  'hex',
);
const ED25519_PUBLIC_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function rawPrivateToKey(raw: Uint8Array): ReturnType<typeof createPrivateKey> {
  if (raw.length !== 32) {
    throw new Error(`Ed25519 private key must be 32 bytes; got ${raw.length}`);
  }
  const der = Buffer.concat([ED25519_PRIVATE_PKCS8_PREFIX, Buffer.from(raw)]);
  return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function rawPublicToKey(raw: Uint8Array): ReturnType<typeof createPublicKey> {
  if (raw.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes; got ${raw.length}`);
  }
  const der = Buffer.concat([ED25519_PUBLIC_SPKI_PREFIX, Buffer.from(raw)]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

// ---------------------------------------------------------------------------
// Sign + Verify
// ---------------------------------------------------------------------------

export async function signToolSpec(
  spec: SignableSpec,
  key: ToolSignaturePrivateKey,
  now: () => Date = () => new Date(),
): Promise<SignedManifest> {
  const canonical = canonicalJson(spec);
  const digest = await sha256Hex(canonical);
  const privateKey = rawPrivateToKey(key.privateKey);
  // For Ed25519 the `algorithm` argument MUST be null.
  const signatureBuf = nodeSign(null, Buffer.from(canonical, 'utf8'), privateKey);
  return {
    canonical,
    digest,
    signature: Buffer.from(signatureBuf).toString('hex'),
    publisherKeyId: key.id,
    signedAt: now().toISOString(),
  };
}

export interface VerifyOutcome {
  readonly ok: boolean;
  readonly reason?: string;
  readonly matchedKeyId?: string;
}

export async function verifyToolSignature(
  spec: SignableSpec,
  manifest: SignedManifest,
  trustedKeys: ReadonlyArray<ToolSignaturePublicKey>,
): Promise<VerifyOutcome> {
  // 1) Canonical-hash agreement.
  const expectedCanonical = canonicalJson(spec);
  if (manifest.canonical !== expectedCanonical) {
    return {
      ok: false,
      reason: 'canonical mismatch — spec content does not match the signed manifest',
    };
  }
  const expectedDigest = await sha256Hex(expectedCanonical);
  if (manifest.digest !== expectedDigest) {
    return { ok: false, reason: 'digest mismatch' };
  }
  // 2) Signature validity against any trusted key.
  let signatureBuf: Buffer;
  try {
    signatureBuf = Buffer.from(manifest.signature, 'hex');
  } catch {
    return { ok: false, reason: 'signature is not valid hex' };
  }
  for (const key of trustedKeys) {
    try {
      const publicKey = rawPublicToKey(key.publicKey);
      const ok = nodeVerify(
        null,
        Buffer.from(manifest.canonical, 'utf8'),
        publicKey,
        signatureBuf,
      );
      if (ok) {
        return { ok: true, matchedKeyId: key.id };
      }
    } catch {
      // Try next key.
    }
  }
  return { ok: false, reason: 'no trusted key produced a valid signature' };
}

// ---------------------------------------------------------------------------
// Registry-level signature check — A2b-2 wire #7.
// Bound at the kernel composition root. Reads pubkey + signature
// from env so production rotates without redeploys.
// ---------------------------------------------------------------------------

export function verifyRegistryHexSignature(args: {
  readonly canonical: string;
  readonly signatureHex: string;
  readonly publicKeyHex: string;
}): { ok: true } | { ok: false; reason: string } {
  let signatureBuf: Buffer;
  let publicKeyBuf: Buffer;
  try {
    signatureBuf = Buffer.from(args.signatureHex, 'hex');
    if (signatureBuf.length === 0) {
      return { ok: false, reason: 'signature hex is empty' };
    }
  } catch {
    return { ok: false, reason: 'signature is not valid hex' };
  }
  try {
    publicKeyBuf = Buffer.from(args.publicKeyHex, 'hex');
    if (publicKeyBuf.length !== 32) {
      return {
        ok: false,
        reason: `public key must be 32 bytes (raw Ed25519); got ${publicKeyBuf.length}`,
      };
    }
  } catch {
    return { ok: false, reason: 'public key is not valid hex' };
  }
  try {
    const publicKey = rawPublicToKey(new Uint8Array(publicKeyBuf));
    const ok = nodeVerify(
      null,
      Buffer.from(args.canonical, 'utf8'),
      publicKey,
      signatureBuf,
    );
    return ok
      ? { ok: true }
      : { ok: false, reason: 'signature verification returned false' };
  } catch (error) {
    return {
      ok: false,
      reason: `verify threw: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function enforceToolRegistrySignatureAtBoot(args: {
  readonly canonical: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly logger?: { warn?: (msg: string) => void };
}): void {
  const env = args.env ?? process.env;
  const signatureHex = env.TOOL_REGISTRY_SIGNATURE_HEX?.trim();
  const publicKeyHex = env.TOOL_REGISTRY_PUBKEY_HEX?.trim();
  if (!signatureHex || !publicKeyHex) {
    // EP-3 CRITICAL #4 — promote the warn-only branch to FATAL in
    // production. Shipping without a tool-registry signature means
    // any attacker who slips a spec into the registry (compromised
    // npm tarball, malicious migration, race with a feature branch)
    // gets it auto-invoked by the kernel. Refuse to boot.
    const nodeEnv = (env.NODE_ENV ?? '').toLowerCase();
    if (nodeEnv === 'production' || nodeEnv === 'prod') {
      throw new Error(
        'refusing to start in production: TOOL_REGISTRY_SIGNATURE_HEX and ' +
          'TOOL_REGISTRY_PUBKEY_HEX must both be set. Tool registry would ' +
          'be unverified, allowing supply-chain code paths into kernel dispatch.',
      );
    }
    const warn = args.logger?.warn ?? ((msg) => console.warn(msg));
    warn(
      'tool-registry-signing: TOOL_REGISTRY_SIGNATURE_HEX / TOOL_REGISTRY_PUBKEY_HEX not set — ' +
        'skipping registry signature verification (dev mode). Production MUST set both.',
    );
    return;
  }
  const outcome = verifyRegistryHexSignature({
    canonical: args.canonical,
    signatureHex,
    publicKeyHex,
  });
  if (!outcome.ok) {
    throw new Error(
      `refusing to start: tool registry signature mismatch (${outcome.reason})`,
    );
  }
}

export function serializeRegistry(
  specs: ReadonlyArray<SignableSpec>,
): string {
  return JSON.stringify(specs.map(canonicalise));
}

// ---------------------------------------------------------------------------
// Key generation (utility — primarily for tests).
// ---------------------------------------------------------------------------

export async function generateToolSignatureKeyPair(
  id: string,
): Promise<{
  privateKey: ToolSignaturePrivateKey;
  publicKey: ToolSignaturePublicKey;
}> {
  const { generateKeyPairSync } = await import('node:crypto');
  const pair = generateKeyPairSync('ed25519');
  // Export raw 32-byte private + public.
  const privDer = pair.privateKey.export({ format: 'der', type: 'pkcs8' });
  const pubDer = pair.publicKey.export({ format: 'der', type: 'spki' });
  // The DER prefixes are fixed-length; raw key is the trailing 32 bytes.
  const privRaw = privDer.slice(privDer.length - 32);
  const pubRaw = pubDer.slice(pubDer.length - 32);
  return {
    privateKey: { id, privateKey: new Uint8Array(privRaw) },
    publicKey: { id, publicKey: new Uint8Array(pubRaw) },
  };
}
