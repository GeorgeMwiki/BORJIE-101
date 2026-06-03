/**
 * Ledger attestor orchestrator (LP-19) — pure composition over ports.
 *
 * One tick:
 *   1. `source.listSegments()` — pull every chain segment to attest.
 *   2. For each segment, compute the Merkle root over its leaves
 *      (append order). Verify leaf indices are contiguous + ascending
 *      so a dropped/duplicated row is caught before we sign a root.
 *   3. If a prior checkpoint exists with the SAME root, skip (the chain
 *      did not advance) — idempotent, cheap re-runs.
 *   4. Sign the canonical checkpoint via the injected `SignerPort`.
 *   5. Publish to EVERY `ExternalSinkPort` (S3 object-lock /
 *      transparency log). A sink throwing fails THAT chain only.
 *   6. Append the signed checkpoint + receipts to the optional store.
 *
 * Fail-isolation: a single bad chain (verify failure, signer error,
 * sink outage) is caught + logged and recorded as a failed outcome; it
 * never poisons the other chains in the batch. The run result carries
 * per-chain outcomes so the caller (cron) can alert on `failed > 0`.
 *
 * @module @borjie/ledger-attestor/attestor
 */

import { serializeCheckpoint } from './checkpoint.js';
import { computeMerkleRoot } from './merkle.js';
import type {
  AttestationRunResult,
  AttestorLogger,
  ChainAttestationOutcome,
  ChainSegment,
  ChainSourcePort,
  CheckpointPayload,
  CheckpointStorePort,
  ExternalSinkPort,
  ExternalSinkReceipt,
  SignedCheckpoint,
  SignerPort,
} from './types.js';

export interface AttestorDeps {
  readonly source: ChainSourcePort;
  readonly signer: SignerPort;
  /** One or more external WORM sinks. At least one is required. */
  readonly sinks: ReadonlyArray<ExternalSinkPort>;
  /** Optional local checkpoint history (enables prevRoot + skip-unchanged). */
  readonly store?: CheckpointStorePort;
  readonly logger?: AttestorLogger;
  /** Injectable clock for deterministic tests. */
  readonly now?: () => Date;
}

const NOOP_LOGGER: AttestorLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Verify the segment's leaves are a contiguous ascending run. A gap or
 * duplicate index means the source query is wrong (or rows were
 * tampered) — we must NOT sign a root over a malformed segment.
 */
function assertContiguous(segment: ChainSegment): void {
  for (let i = 0; i < segment.leaves.length; i += 1) {
    const expected = i === 0 ? segment.leaves[0].index : segment.leaves[i - 1].index + 1;
    if (segment.leaves[i].index !== expected) {
      throw new Error(
        `non_contiguous_leaves chain=${segment.chainId} at_position=${i} ` +
          `expected_index=${expected} got=${segment.leaves[i].index}`,
      );
    }
  }
}

async function attestSegment(
  segment: ChainSegment,
  deps: AttestorDeps,
  attestedAtIso: string,
): Promise<ChainAttestationOutcome> {
  const logger = deps.logger ?? NOOP_LOGGER;
  try {
    assertContiguous(segment);

    const merkleRoot = computeMerkleRoot(segment.leaves.map((l) => l.rowHash));
    const leafCount = segment.leaves.length;
    const headIndex = leafCount > 0 ? segment.leaves[leafCount - 1].index : -1;

    const prior = deps.store ? await deps.store.latestFor(segment.chainId) : null;
    const prevRoot = prior ? prior.payload.merkleRoot : null;

    // Skip-unchanged: the chain has not advanced since the last
    // checkpoint. Cheap, idempotent re-runs (cron can fire freely).
    if (prior !== null && prior.payload.merkleRoot === merkleRoot) {
      logger.info(
        { chainId: segment.chainId, merkleRoot, leafCount },
        'attestor: chain unchanged since last checkpoint, skipping',
      );
      return {
        chainId: segment.chainId,
        ok: true,
        leafCount,
        merkleRoot,
        receipts: [],
        skippedUnchanged: true,
      };
    }

    const payload: CheckpointPayload = {
      chainId: segment.chainId,
      merkleRoot,
      leafCount,
      headIndex,
      prevRoot,
      attestedAtIso,
    };
    const signature = await deps.signer.sign(serializeCheckpoint(payload));
    const signed: SignedCheckpoint = { payload, signature };

    const receipts: ExternalSinkReceipt[] = [];
    for (const sink of deps.sinks) {
      receipts.push(await sink.publish(signed));
    }

    if (deps.store) await deps.store.append(signed, receipts);

    logger.info(
      { chainId: segment.chainId, merkleRoot, leafCount, sinks: receipts.length },
      'attestor: checkpoint signed + published',
    );
    return {
      chainId: segment.chainId,
      ok: true,
      leafCount,
      merkleRoot,
      receipts,
      skippedUnchanged: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      { chainId: segment.chainId, error: message },
      'attestor: chain attestation FAILED',
    );
    return {
      chainId: segment.chainId,
      ok: false,
      leafCount: segment.leaves.length,
      merkleRoot: '',
      receipts: [],
      skippedUnchanged: false,
      error: message,
    };
  }
}

/**
 * Run one attestation tick across every chain the source advertises.
 * Never throws — per-chain failures are isolated and surfaced in the
 * result so the caller can alert. At least one sink MUST be configured.
 */
export async function runAttestation(deps: AttestorDeps): Promise<AttestationRunResult> {
  if (deps.sinks.length === 0) {
    throw new Error('runAttestation requires at least one ExternalSinkPort');
  }
  const attestedAtIso = (deps.now?.() ?? new Date()).toISOString();
  const segments = await deps.source.listSegments();

  const outcomes: ChainAttestationOutcome[] = [];
  for (const segment of segments) {
    outcomes.push(await attestSegment(segment, deps, attestedAtIso));
  }

  const attested = outcomes.filter((o) => o.ok && !o.skippedUnchanged).length;
  const skippedUnchanged = outcomes.filter((o) => o.skippedUnchanged).length;
  const failed = outcomes.filter((o) => !o.ok).length;

  return {
    attestedAtIso,
    scanned: segments.length,
    attested,
    skippedUnchanged,
    failed,
    outcomes,
  };
}
