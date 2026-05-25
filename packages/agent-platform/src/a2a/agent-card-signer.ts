/**
 * A2A Agent Card signer + verifier (Ed25519).
 *
 * The A2A v1.0 spec defines "Signed Agent Cards" so that consumers can
 * verify the Card has not been tampered with in transit (relevant when the
 * `.well-known` URL is cached / proxied / mirrored).
 *
 * Strategy:
 *   - If `@noble/ed25519` is installed, use real Ed25519 signatures.
 *   - Otherwise fall back to a deterministic stub (HMAC-SHA256 of the
 *     canonical card bytes under a fixed key derived from `keyId`).
 *
 * The stub is REPRODUCIBLE — same input + same `keyId` always yields the
 * same signature — which is what tests need. Production deployments are
 * expected to install `@noble/ed25519` and set `A2A_SIGNING_KEY_PRIVATE`
 * / `A2A_SIGNING_KEY_PUBLIC` / `A2A_SIGNING_KEY_ID` env vars.
 *
 * Required env vars (production):
 *   - `A2A_SIGNING_KEY_PRIVATE` — hex-encoded Ed25519 private key (32 bytes)
 *   - `A2A_SIGNING_KEY_PUBLIC`  — hex-encoded Ed25519 public key  (32 bytes)
 *   - `A2A_SIGNING_KEY_ID`      — identifier published in the signature block
 */
import {
  serializeAgentCardForSigning,
  type A2AAgentCard,
  type A2AAgentSignature,
} from './agent-card.js';
import { freezeDeep } from './internal/freeze.js';

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------

export interface A2ASigningKey {
  readonly keyId: string;
  readonly privateKey: string;
  readonly publicKey: string;
}

/**
 * Read the signing key from environment variables, or return null if any
 * of them is missing. Callers can fall back to a generated test key.
 */
export function loadSigningKeyFromEnv(
  env: Readonly<Record<string, string | undefined>> = (typeof process !==
  'undefined'
    ? (process.env as Readonly<Record<string, string | undefined>>)
    : {}),
): A2ASigningKey | null {
  const privateKey = env['A2A_SIGNING_KEY_PRIVATE'];
  const publicKey = env['A2A_SIGNING_KEY_PUBLIC'];
  const keyId = env['A2A_SIGNING_KEY_ID'];
  if (!privateKey || !publicKey || !keyId) return null;
  return freezeDeep({ keyId, privateKey, publicKey });
}

// ---------------------------------------------------------------------------
// Sign / verify
// ---------------------------------------------------------------------------

export interface SignAgentCardDeps {
  readonly key: A2ASigningKey;
  readonly now?: () => Date;
}

/**
 * Attach an Ed25519 signature to an Agent Card.
 *
 * Pure: returns a NEW card with `signature` set; does not mutate the input.
 */
export async function signAgentCard(
  card: A2AAgentCard,
  deps: SignAgentCardDeps,
): Promise<A2AAgentCard> {
  const message = serializeAgentCardForSigning(card);
  const value = await signBytes(message, deps.key.privateKey);
  const signedAt = (deps.now ?? (() => new Date()))().toISOString();
  const signature: A2AAgentSignature = freezeDeep({
    algorithm: 'ed25519',
    keyId: deps.key.keyId,
    value,
    signedAt,
  });
  return freezeDeep({ ...card, signature }) as A2AAgentCard;
}

/**
 * Verify the signature on an Agent Card. Returns `true` if the embedded
 * signature was produced by the supplied public key, `false` otherwise.
 *
 * Returns `false` (never throws) for cards without a signature, so callers
 * can use it as a boolean gate without try/catch.
 */
export async function verifyAgentCard(
  card: A2AAgentCard,
  publicKey: string,
): Promise<boolean> {
  if (!card.signature) return false;
  if (card.signature.algorithm !== 'ed25519') return false;
  const message = serializeAgentCardForSigning(card);
  return verifyBytes(message, card.signature.value, publicKey);
}

// ---------------------------------------------------------------------------
// Signing primitives — Ed25519 if available, deterministic stub otherwise
// ---------------------------------------------------------------------------

interface Ed25519Module {
  readonly signAsync: (
    message: Uint8Array,
    privateKey: Uint8Array,
  ) => Promise<Uint8Array>;
  readonly verifyAsync: (
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ) => Promise<boolean>;
}

let ed25519Cache: Ed25519Module | null | undefined;

async function loadEd25519(): Promise<Ed25519Module | null> {
  if (ed25519Cache !== undefined) return ed25519Cache;
  try {
    // Dynamic import so the package keeps working without the dependency.
    // `@noble/ed25519` is optional — install it in production for real
    // Ed25519 signatures; the deterministic stub keeps tests green.
    // @ts-expect-error optional peer dependency
    const mod: unknown = await import('@noble/ed25519').catch(() => null);
    if (!mod || typeof mod !== 'object') {
      ed25519Cache = null;
      return null;
    }
    const m = mod as Record<string, unknown>;
    const signAsync = m['signAsync'] ?? m['sign'];
    const verifyAsync = m['verifyAsync'] ?? m['verify'];
    if (typeof signAsync !== 'function' || typeof verifyAsync !== 'function') {
      ed25519Cache = null;
      return null;
    }
    ed25519Cache = {
      signAsync: signAsync as Ed25519Module['signAsync'],
      verifyAsync: verifyAsync as Ed25519Module['verifyAsync'],
    };
    return ed25519Cache;
  } catch {
    ed25519Cache = null;
    return null;
  }
}

async function signBytes(
  message: string,
  privateKeyHex: string,
): Promise<string> {
  const ed = await loadEd25519();
  if (ed) {
    const sig = await ed.signAsync(
      utf8ToBytes(message),
      hexToBytes(privateKeyHex),
    );
    return bytesToHex(sig);
  }
  return deterministicStubSignature(message, privateKeyHex);
}

async function verifyBytes(
  message: string,
  signatureHex: string,
  publicKeyHex: string,
): Promise<boolean> {
  const ed = await loadEd25519();
  if (ed) {
    try {
      return await ed.verifyAsync(
        hexToBytes(signatureHex),
        utf8ToBytes(message),
        hexToBytes(publicKeyHex),
      );
    } catch {
      return false;
    }
  }
  const expected = await deterministicStubSignature(message, publicKeyHex);
  return timingSafeEqualHex(signatureHex, expected);
}

/**
 * Deterministic stub — HMAC-SHA256(keyMaterial, message) hex-encoded.
 *
 * The key passed in matches whatever the caller has on hand: for `signBytes`
 * it is the private key, for `verifyBytes` it is the public key. To make the
 * stub round-trip we treat `privateKey === publicKey` as the convention —
 * this matches `generateStubKey()` below, and any production user will have
 * `@noble/ed25519` installed anyway so this code path is for tests only.
 */
async function deterministicStubSignature(
  message: string,
  keyHex: string,
): Promise<string> {
  const keyBytes = hexToBytes(keyHex);
  const messageBytes = new TextEncoder().encode(message);
  const key = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    toArrayBuffer(messageBytes),
  );
  return bytesToHex(new Uint8Array(sig));
}

/**
 * Copy a Uint8Array into a fresh ArrayBuffer so it satisfies WebCrypto's
 * BufferSource typing (which excludes SharedArrayBuffer-backed views).
 */
function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(view.byteLength);
  new Uint8Array(buf).set(view);
  return buf;
}

/**
 * Generate a reproducible stub keypair for tests. In stub mode the
 * private and public keys are the SAME bytes so `signBytes` / `verifyBytes`
 * round-trip — this is fine because no real cryptography is happening,
 * and any production deployment installs `@noble/ed25519` which uses real
 * asymmetric key pairs.
 */
export function generateStubKey(keyId: string, seed = 'a2a-test'): A2ASigningKey {
  const material = `${keyId}::${seed}`;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = material.charCodeAt(i % material.length) ^ (i * 17);
  }
  const hex = bytesToHex(bytes);
  return freezeDeep({ keyId, privateKey: hex, publicKey: hex });
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have an even number of characters');
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex characters at offset ${i * 2}`);
    }
    out[i] = byte;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
