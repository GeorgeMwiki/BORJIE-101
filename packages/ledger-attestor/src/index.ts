/**
 * `@borjie/ledger-attestor` — public surface (LP-19).
 *
 * Tamper-evidence control for the royalty/treasury ledger and the AI
 * audit chain. Computes a Merkle root over a hash-chain segment
 * (built on `@borjie/audit-hash-chain`), signs the root via an injected
 * `SignerPort`, and publishes the signed checkpoint to a pluggable
 * `ExternalSinkPort` (S3 object-lock / transparency log).
 *
 * Everything is behind a port, so the orchestrator (`runAttestation`)
 * is pure and unit-testable. A scheduled worker calls `runAttestation`
 * hourly — see the package README / the consolidation-worker wiring.
 */

// Merkle
export { computeMerkleRoot, hashLeaf, EMPTY_MERKLE_ROOT } from './merkle.js';

// Checkpoint serialisation
export { serializeCheckpoint } from './checkpoint.js';

// Orchestrator
export { runAttestation, type AttestorDeps } from './attestor.js';

// Signers
export {
  createEd25519Signer,
  verifyEd25519,
  type Ed25519SignerConfig,
  type Ed25519SignerHandle,
} from './signers/ed25519-signer.js';

// Sinks
export {
  createInMemorySink,
  createInMemoryCheckpointStore,
  type InMemorySink,
} from './sinks/in-memory-sink.js';
export {
  createS3ObjectLockSink,
  type ObjectPutPort,
  type ObjectPutRequest,
  type ObjectPutResult,
  type S3ObjectLockSinkConfig,
} from './sinks/s3-object-lock-sink.js';

// Types + ports
export type {
  AttestationRunResult,
  AttestorLogger,
  ChainAttestationOutcome,
  ChainLeaf,
  ChainSegment,
  ChainSourcePort,
  CheckpointPayload,
  CheckpointStorePort,
  ExternalSinkPort,
  ExternalSinkReceipt,
  Signature,
  SignedCheckpoint,
  SignerPort,
} from './types.js';
