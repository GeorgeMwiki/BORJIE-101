/**
 * Per-issuer layout fingerprint registry (LP-26).
 *
 * Stores a stable fingerprint per issuer document layout: a header-text hash
 * plus an optional perceptual hash (dHash) of the logo region. New layouts
 * are learned lazily as they are seen in the field. Matching an incoming
 * document to a known issuer speeds + sharpens downstream extraction.
 *
 * NO real bank / merchant / authority names appear in code. Issuer ids
 * follow a numbered scheme (BORJIE_ISSUER_001, ...). Real organisations only
 * appear as tenant rows, never here.
 *
 * The store is a port (in-memory default; the host injects a Drizzle/Supabase
 * adapter in prod). The header hash uses `node:crypto` SHA-256 when available
 * and a deterministic non-crypto fallback otherwise (registration is a
 * server op, so the real SHA path is never weakened in practice).
 *
 * @module @borjie/document-reconciliation/issuer-fingerprint
 */

import { createHash } from 'node:crypto';

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface IssuerFingerprint {
  /** Stable numbered issuer id (BORJIE_ISSUER_001, ...). */
  readonly issuerId: string;
  /** Human-readable label. NOT a real brand. */
  readonly displayLabel: string;
  /** SHA-256 of the canonical header text. */
  readonly headerHash: string;
  /** Optional perceptual hash (dHash) of the logo region, 16 hex chars. */
  readonly logoPHash?: string;
  readonly category?: string;
  readonly lastSeenAt: string;
  readonly seenCount: number;
}

export interface FingerprintMatchInput {
  readonly headerText?: string;
  readonly imageBytes?: Uint8Array;
  readonly category?: string;
}

export interface FingerprintStore {
  list(): Promise<readonly IssuerFingerprint[]>;
  upsert(record: IssuerFingerprint): Promise<void>;
  findByHeaderHash(hash: string): Promise<IssuerFingerprint | null>;
}

// ----------------------------------------------------------------------------
// In-memory store (default)
// ----------------------------------------------------------------------------

export function createInMemoryFingerprintStore(): FingerprintStore {
  const records = new Map<string, IssuerFingerprint>();
  return {
    list: async () => Array.from(records.values()),
    upsert: async (record) => {
      records.set(record.headerHash, record);
    },
    findByHeaderHash: async (hash) => records.get(hash) ?? null,
  };
}

// ----------------------------------------------------------------------------
// Hashing
// ----------------------------------------------------------------------------

/** Canonicalise a header line for hashing (lowercase, collapse, alnum + space). */
export function canonicaliseHeaderText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic 64-hex-char non-crypto digest (fallback only). */
function fallbackDigest(input: string): string {
  const lanes = [0x811c9dc5, 0x01000193, 0xcafebabe, 0x9e3779b9];
  for (let i = 0; i < input.length; i += 1) {
    const c = input.charCodeAt(i);
    for (let l = 0; l < lanes.length; l += 1) {
      lanes[l] = (lanes[l] ?? 0) ^ (c + l);
      lanes[l] = Math.imul(lanes[l] ?? 0, 0x01000193);
    }
  }
  return lanes
    .map((l) => ((l ?? 0) >>> 0).toString(16).padStart(8, '0'))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64);
}

export function hashHeaderText(input: string): string {
  const canonical = canonicaliseHeaderText(input);
  try {
    return createHash('sha256').update(canonical, 'utf-8').digest('hex');
  } catch {
    return fallbackDigest(canonical);
  }
}

/**
 * 64-bit dHash perceptual hash of small image bytes as 16 hex chars. Operates
 * on raw bytes via a stable byte-level reduction so the test surface stays
 * deterministic without an image library. Production callers may pass a
 * properly-resized grayscale grid for true difference-hashing.
 */
export function computePerceptualHash(bytes: Uint8Array): string {
  if (bytes.length === 0) return '0'.repeat(16);
  const chunkSize = Math.max(1, Math.floor(bytes.length / 64));
  let bits = 0n;
  for (let i = 0; i < 64; i += 1) {
    const start = i * chunkSize;
    const end = Math.min(bytes.length, start + chunkSize);
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += bytes[j] ?? 0;
    const avg = sum / Math.max(1, end - start);
    const next = i < 63 ? bytes[Math.min(bytes.length - 1, (i + 1) * chunkSize)] ?? 0 : bytes[bytes.length - 1] ?? 0;
    if (next > avg) bits |= 1n << BigInt(i);
  }
  return bits.toString(16).padStart(16, '0');
}

function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let dist = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = parseInt(a[i] ?? '0', 16) ^ parseInt(b[i] ?? '0', 16);
    while (x > 0) {
      dist += x & 1;
      x >>= 1;
    }
  }
  return dist;
}

// ----------------------------------------------------------------------------
// Match / register
// ----------------------------------------------------------------------------

const ISSUER_ID_RE = /^BORJIE_ISSUER_\d{3,4}$/;
/** Conservative real-brand guard for display labels. */
const REAL_BRAND_RE = /\b(crdb|nmb|nbc|stanbic|absa|equity|exim|kcb|barclays|standard\s*chartered|citi)\b/i;

/** Accept a logo phash match only within this Hamming distance (8/64 bits). */
const PHASH_MAX_DISTANCE = 8;

/**
 * Match an input against the registry. Header-hash is the primary key; the
 * perceptual hash breaks ties / handles header-OCR misses. Returns the
 * matching fingerprint or null.
 */
export async function matchFingerprint(
  input: FingerprintMatchInput,
  store: FingerprintStore,
): Promise<IssuerFingerprint | null> {
  if (input.headerText && input.headerText.trim().length > 0) {
    const hit = await store.findByHeaderHash(hashHeaderText(input.headerText));
    if (hit) return hit;
  }

  if (input.imageBytes && input.imageBytes.length > 0) {
    const phash = computePerceptualHash(input.imageBytes);
    const all = await store.list();
    let best: IssuerFingerprint | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const record of all) {
      if (!record.logoPHash) continue;
      const distance = hammingHex(record.logoPHash, phash);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = record;
      }
    }
    return bestDistance <= PHASH_MAX_DISTANCE ? best : null;
  }

  return null;
}

/** Register or refresh a fingerprint. Issuer ids must be numbered. */
export async function registerFingerprint(
  args: {
    readonly issuerId: string;
    readonly displayLabel: string;
    readonly headerText: string;
    readonly imageBytes?: Uint8Array;
    readonly category?: string;
    readonly now?: () => Date;
  },
  store: FingerprintStore,
): Promise<IssuerFingerprint> {
  if (!ISSUER_ID_RE.test(args.issuerId)) {
    throw new Error(`Invalid issuerId '${args.issuerId}'. Must match BORJIE_ISSUER_NNN.`);
  }
  if (REAL_BRAND_RE.test(args.displayLabel)) {
    throw new Error('displayLabel must not reference a real brand; use a numbered label');
  }
  const now = (args.now?.() ?? new Date()).toISOString();
  const headerHash = hashHeaderText(args.headerText);
  const logoPHash =
    args.imageBytes && args.imageBytes.length > 0 ? computePerceptualHash(args.imageBytes) : undefined;
  const existing = await store.findByHeaderHash(headerHash);
  const next: IssuerFingerprint = {
    issuerId: args.issuerId,
    displayLabel: args.displayLabel,
    headerHash,
    ...(logoPHash ? { logoPHash } : {}),
    ...(args.category ? { category: args.category } : {}),
    lastSeenAt: now,
    seenCount: existing ? existing.seenCount + 1 : 1,
  };
  await store.upsert(next);
  return next;
}
