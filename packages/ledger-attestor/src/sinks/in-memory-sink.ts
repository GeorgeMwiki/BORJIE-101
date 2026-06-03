/**
 * In-memory external sink + checkpoint store (LP-19) — tests/dev only.
 *
 * NOT for production: a process restart loses every checkpoint, which
 * defeats the tamper-evidence guarantee. Production wires an
 * object-lock S3 sink (see `s3-object-lock-sink.ts`) and a durable
 * checkpoint store. These exist so the orchestrator is exercisable
 * end-to-end in a unit test with no external infra.
 *
 * @module @borjie/ledger-attestor/sinks/in-memory-sink
 */

import type {
  CheckpointStorePort,
  ExternalSinkPort,
  ExternalSinkReceipt,
  SignedCheckpoint,
} from '../types.js';

export interface InMemorySink extends ExternalSinkPort {
  /** Every checkpoint published, in order (test assertions). */
  readonly published: () => ReadonlyArray<SignedCheckpoint>;
}

/**
 * Build an in-memory sink. `failNext` lets a test simulate a sink
 * outage to exercise the orchestrator's per-chain fail-isolation.
 */
export function createInMemorySink(
  name = 'in-memory',
  opts: { readonly failOnChainId?: string } = {},
): InMemorySink {
  let store: ReadonlyArray<SignedCheckpoint> = [];
  let seq = 0;
  return {
    name,
    published: () => store,
    async publish(checkpoint: SignedCheckpoint): Promise<ExternalSinkReceipt> {
      if (
        opts.failOnChainId !== undefined &&
        checkpoint.payload.chainId === opts.failOnChainId
      ) {
        throw new Error(`simulated_sink_failure chain=${checkpoint.payload.chainId}`);
      }
      store = [...store, checkpoint];
      seq += 1;
      return Object.freeze({ sink: name, locator: `mem://${name}/${seq}` });
    },
  };
}

/**
 * In-memory checkpoint history keyed by chainId. Append-only; latestFor
 * returns the most recently appended checkpoint for the chain.
 */
export function createInMemoryCheckpointStore(): CheckpointStorePort {
  let rows: ReadonlyArray<{
    readonly checkpoint: SignedCheckpoint;
    readonly receipts: ReadonlyArray<ExternalSinkReceipt>;
  }> = [];
  return {
    async latestFor(chainId: string): Promise<SignedCheckpoint | null> {
      const forChain = rows.filter((r) => r.checkpoint.payload.chainId === chainId);
      const last = forChain.length > 0 ? forChain[forChain.length - 1] : null;
      return last ? last.checkpoint : null;
    },
    async append(
      checkpoint: SignedCheckpoint,
      receipts: ReadonlyArray<ExternalSinkReceipt>,
    ): Promise<void> {
      rows = [...rows, { checkpoint, receipts }];
    },
  };
}
