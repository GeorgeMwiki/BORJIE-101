/**
 * Hash-chain audit primitive — shared types.
 *
 * Ported from LITFIN `src/core/governance/audit/hash-chain.ts`. The
 * canonical row shape carries enough metadata for BORJIE's
 * sovereign / tenant / decision audit streams. The chain itself is
 * domain-agnostic — `payload` is opaque so any audit table can reuse
 * the same primitive.
 */

/**
 * The opaque audit payload — caller-chosen shape. Hash function
 * consumes its canonical JSON serialisation, so any JSON-serialisable
 * value is acceptable.
 */
export type AuditPayload = Readonly<Record<string, unknown>>;

/**
 * A row that participates in a hash chain. `prev` is the immediately
 * preceding row's `rowHash`, or the genesis sentinel for the first
 * row. `rowHash` is `sha256(canonicalJson({ prev, payload, secret? }))`.
 */
export interface ChainEntry {
  readonly index: number;
  readonly prevHash: string;
  readonly rowHash: string;
  readonly payload: AuditPayload;
  /** ISO 8601 wall-clock when the entry was sealed. */
  readonly sealedAtIso: string;
  /** Identifier of the HMAC secret used at sealing time. Rotation aware. */
  readonly secretId?: string;
}

/** Result of a `verifyChain` walk. */
export interface ChainVerificationResult {
  readonly ok: boolean;
  readonly scanned: number;
  readonly firstBrokenIndex: number | null;
  readonly expectedHash: string | null;
  readonly actualHash: string | null;
  readonly reason: string | null;
}

/** Public sentinel for the genesis predecessor. */
export const GENESIS_HASH = "GENESIS" as const;

/**
 * Secret-rotation aware lookup. Maps secretId -> hex secret value.
 * Verification accepts a snapshot of every secret ever used so a
 * mid-life secret rotation does not break older entries.
 */
export type SecretRing = Readonly<Record<string, string>>;
