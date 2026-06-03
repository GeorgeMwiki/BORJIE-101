/**
 * Ledger attestor — shared types + injection ports (LP-19).
 *
 * The attestor is pure orchestration: it pulls a chain segment, folds
 * it into a Merkle root, signs the root, and publishes the signed
 * checkpoint externally. Every side effect is behind a port so the
 * orchestrator is unit-testable with in-memory fakes (no S3, no KMS,
 * no Postgres).
 *
 * Ports:
 *   - {@link ChainSourcePort}   — read the chain leaves (NEVER writes).
 *   - {@link SignerPort}        — sign the root (KMS / HSM / local key).
 *   - {@link ExternalSinkPort}  — publish the checkpoint to a WORM store
 *                                 (S3 object-lock, Rekor transparency log).
 *   - {@link CheckpointStorePort}— optional: persist the local checkpoint
 *                                 row so the next run knows the prior root.
 *
 * @module @borjie/ledger-attestor/types
 */

/**
 * One leaf the Merkle tree commits to. `index` is the chain position
 * (ascending append order); `rowHash` is the per-row hash already
 * computed by the upstream chain (`rowHash` in audit-hash-chain or
 * `thisHash` in payments-ledger).
 */
export interface ChainLeaf {
  readonly index: number;
  readonly rowHash: string;
}

/**
 * A bounded slice of a single logical chain to attest. `chainId`
 * scopes the checkpoint (e.g. `ai_audit_chain`, or `ledger:{tenant}:{account}`)
 * so independent streams attest independently.
 */
export interface ChainSegment {
  readonly chainId: string;
  readonly leaves: ReadonlyArray<ChainLeaf>;
}

/** Reads chain segments to attest. Read-only against the source DB. */
export interface ChainSourcePort {
  /**
   * Return every chain segment that should be attested this tick. An
   * implementation MAY return one segment per (tenant, account) or a
   * single global audit segment — the orchestrator is agnostic.
   */
  listSegments(): Promise<ReadonlyArray<ChainSegment>>;
}

/** The bytes that get signed, plus enough metadata to reproduce them. */
export interface CheckpointPayload {
  readonly chainId: string;
  /** Merkle root (hex) over `leaves[0..leafCount-1]`. */
  readonly merkleRoot: string;
  /** Number of leaves committed (the chain length at attestation time). */
  readonly leafCount: number;
  /** Highest leaf index committed (leafCount - 1, or -1 when empty). */
  readonly headIndex: number;
  /** Prior checkpoint's merkleRoot for this chain, or null on first run. */
  readonly prevRoot: string | null;
  /** ISO 8601 attestation wall-clock. */
  readonly attestedAtIso: string;
}

/** A signature over the canonical form of a {@link CheckpointPayload}. */
export interface Signature {
  /** Signature algorithm, e.g. `ed25519`, `aws-kms:ECDSA_SHA_256`. */
  readonly algorithm: string;
  /** Opaque key identifier (KMS key ARN, key fingerprint, kid). */
  readonly keyId: string;
  /** Signature bytes, base64. */
  readonly signatureB64: string;
}

/** Signs the canonical checkpoint bytes. Pluggable: local key / KMS / HSM. */
export interface SignerPort {
  /** Stable identifier of the signing key (for the checkpoint + verify). */
  readonly keyId: string;
  /** Algorithm label embedded in the signature. */
  readonly algorithm: string;
  /** Produce a signature over `message` (the canonical checkpoint bytes). */
  sign(message: string): Promise<Signature>;
}

/** A fully-attested, signed checkpoint ready to publish. */
export interface SignedCheckpoint {
  readonly payload: CheckpointPayload;
  readonly signature: Signature;
}

/**
 * Publishes a signed checkpoint to a tamper-proof external store. The
 * canonical implementation writes an S3 object under object-lock
 * (compliance/governance retention) OR appends to a transparency log
 * (Rekor / Trillian). Pluggable so we can fan out to more than one.
 */
export interface ExternalSinkPort {
  /** Human label for logs/metrics (e.g. `s3-object-lock`, `rekor`). */
  readonly name: string;
  /**
   * Publish the checkpoint. Returns an opaque receipt (S3 versionId,
   * Rekor log index) the caller records for the audit trail. MUST
   * throw on failure — the attestor treats a sink failure as a failed
   * attestation for that chain (fail-loud).
   */
  publish(checkpoint: SignedCheckpoint): Promise<ExternalSinkReceipt>;
}

export interface ExternalSinkReceipt {
  readonly sink: string;
  /** Opaque locator the sink returns (versionId, log index, URL). */
  readonly locator: string;
}

/**
 * Optional local persistence of the checkpoint row. Lets the next
 * attestation tick chain its `prevRoot` and lets `GET /attestations`
 * serve history. Read+append only — checkpoints are immutable.
 */
export interface CheckpointStorePort {
  /** Most recent checkpoint for a chain, or null if none yet. */
  latestFor(chainId: string): Promise<SignedCheckpoint | null>;
  /** Append a freshly-published checkpoint. */
  append(checkpoint: SignedCheckpoint, receipts: ReadonlyArray<ExternalSinkReceipt>): Promise<void>;
}

/** Minimal structured logger (Pino-shaped). No console.log in services. */
export interface AttestorLogger {
  info(meta: Readonly<Record<string, unknown>>, msg: string): void;
  warn(meta: Readonly<Record<string, unknown>>, msg: string): void;
  error(meta: Readonly<Record<string, unknown>>, msg: string): void;
}

/** Per-chain outcome of one attestation tick. */
export interface ChainAttestationOutcome {
  readonly chainId: string;
  readonly ok: boolean;
  readonly leafCount: number;
  readonly merkleRoot: string;
  readonly receipts: ReadonlyArray<ExternalSinkReceipt>;
  readonly skippedUnchanged: boolean;
  readonly error?: string;
}

/** Aggregate result of one attestation run across all chains. */
export interface AttestationRunResult {
  readonly attestedAtIso: string;
  readonly scanned: number;
  readonly attested: number;
  readonly skippedUnchanged: number;
  readonly failed: number;
  readonly outcomes: ReadonlyArray<ChainAttestationOutcome>;
}
