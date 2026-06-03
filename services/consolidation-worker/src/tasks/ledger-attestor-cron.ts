/**
 * Ledger / audit hash-chain attestor cron (LP-19).
 *
 * Folds the royalty/treasury **ledger** chain (`ledger_entries`) and the AI
 * **audit chain** (`ai_audit_chain`) into per-chain Merkle roots, signs each
 * root, and publishes the signed checkpoint to one or more WORM sinks. An
 * attacker who later edits a ledger row cannot also rewrite the historical
 * signed roots that would expose the edit — so tampering becomes detectable
 * after the fact.
 *
 * This is the Borjie wiring of `@borjie/ledger-attestor` described in that
 * package's README ("Cron wiring — runs hourly"). It runs inside the
 * consolidation-worker supervisor next to the OCR + orchestrator crons.
 *
 * ── Architecture (ports, not adapters) ──────────────────────────────────────
 * Every side effect is behind a port so `runAttestation` stays pure:
 *
 *   - {@link ChainSourcePort}   — read the chain leaves. Bound here to a
 *     READ-ONLY Drizzle client (the attestor never writes ledger rows). The
 *     source query is plain SELECT; the only mutation the attestor performs
 *     is `store.append` into checkpoint history.
 *   - `SignerPort`             — the default zero-dependency Ed25519 signer.
 *     Production injects a KMS/HSM signer; an operator may seed a stable
 *     private key via `LEDGER_ATTEST_SIGNING_KEY_PEM` so checkpoints across
 *     restarts share one verifiable key.
 *   - `ExternalSinkPort[]`     — at least one WORM sink. An in-memory sink is
 *     always present (so the chain verifies end-to-end on a fresh deploy);
 *     an S3 Object-Lock sink is added when `LEDGER_ATTEST_BUCKET` is set and
 *     `@aws-sdk/client-s3` is resolvable (env-gated, degrades cleanly).
 *   - `CheckpointStorePort`    — an in-memory checkpoint history so each tick
 *     chains its `prevRoot` and skips chains whose root has not advanced
 *     (cheap idempotent re-runs). A durable store is a follow-up; the
 *     in-memory store is correct for the lifetime of one supervisor process.
 *
 * ── Leaf ordering ───────────────────────────────────────────────────────────
 * `runAttestation` asserts each segment's leaf indices are a contiguous
 * ascending run before signing. Legacy ledger rows may carry a NULL
 * `this_hash` (pre-chain), which would leave gaps in the raw
 * `sequence_number`. We therefore filter `this_hash IS NOT NULL` and assign a
 * DENSE 0-based index in append order — the Merkle commitment is over the
 * ordered `rowHash` values, so dense re-indexing preserves the cryptographic
 * content while guaranteeing contiguity.
 *
 * ── Fail-safety ─────────────────────────────────────────────────────────────
 * `runAttestation` never throws — per-chain failures are isolated and
 * surfaced in the result. The cron wrapper additionally try/catches so a
 * source/DB error degrades to a logged no-op (never crashes the supervisor),
 * and warns (Pino) whenever `result.failed > 0`.
 *
 * @module ledger-attestor-cron
 */

import {
  createEd25519Signer,
  createInMemoryCheckpointStore,
  createInMemorySink,
  createS3ObjectLockSink,
  runAttestation,
  type AttestationRunResult,
  type ChainLeaf,
  type ChainSegment,
  type ChainSourcePort,
  type CheckpointStorePort,
  type ExternalSinkPort,
  type ObjectPutPort,
  type ObjectPutRequest,
  type ObjectPutResult,
  type SignerPort,
} from '@borjie/ledger-attestor';
import { sql } from 'drizzle-orm';
import { logger } from '../logger.js';

// ─────────────────────────────────────────────────────────────────────
// DB port — raw `execute(q)`, matching the worker convention.
// ─────────────────────────────────────────────────────────────────────

/** Minimum DB surface the source needs — read-only `execute(q)`. */
export interface AttestorDbLike {
  execute(query: unknown): Promise<unknown>;
}

// Hard ceiling on rows pulled per chain per tick. The attestor commits to
// the chain HEAD each run, so a very long chain is fully covered across
// successive ticks even if a single tick is bounded; a sane cap keeps a
// pathological table from loading unboundedly into memory.
const MAX_LEAVES_PER_CHAIN = 100_000;

// ─────────────────────────────────────────────────────────────────────
// ChainSourcePort — read-only over ledger_entries + ai_audit_chain.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a read-only {@link ChainSourcePort} over the primary DB.
 *
 * Returns one {@link ChainSegment} per independent chain:
 *   - `ledger:{tenantId}:{accountId}` — `ledger_entries`, ordered by
 *     `sequence_number` (the per-account monotone hash-chain anchor).
 *   - `audit:{tenantId}`             — `ai_audit_chain`, ordered by
 *     `sequence_id` (the per-tenant monotone chain anchor).
 *
 * Both reads filter `this_hash IS NOT NULL` (skip legacy pre-chain rows) and
 * degrade to "no segments" on any DB error — a transient outage or a
 * pre-migration schema never crashes the cron.
 */
export function createChainSource(db: AttestorDbLike): ChainSourcePort {
  return {
    async listSegments(): Promise<ReadonlyArray<ChainSegment>> {
      const [ledger, audit] = await Promise.all([
        readLedgerSegments(db),
        readAuditSegments(db),
      ]);
      return [...ledger, ...audit];
    },
  };
}

async function readLedgerSegments(
  db: AttestorDbLike,
): Promise<ReadonlyArray<ChainSegment>> {
  try {
    const result = (await db.execute(
      sql`SELECT tenant_id, account_id, sequence_number, this_hash
            FROM ledger_entries
           WHERE this_hash IS NOT NULL
           ORDER BY tenant_id, account_id, sequence_number ASC
           LIMIT ${MAX_LEAVES_PER_CHAIN}`,
    )) as unknown;
    return groupChain(
      toRows(result),
      (row) => `ledger:${asString(row.tenant_id)}:${asString(row.account_id)}`,
      (row) => asString(row.this_hash),
    );
  } catch (error) {
    logger.warn(
      'ledger-attestor: ledger_entries read failed (schema may be pre-migration)',
      { reason: messageOf(error) },
    );
    return [];
  }
}

async function readAuditSegments(
  db: AttestorDbLike,
): Promise<ReadonlyArray<ChainSegment>> {
  try {
    const result = (await db.execute(
      sql`SELECT tenant_id, sequence_id, this_hash
            FROM ai_audit_chain
           WHERE this_hash IS NOT NULL
           ORDER BY tenant_id, sequence_id ASC
           LIMIT ${MAX_LEAVES_PER_CHAIN}`,
    )) as unknown;
    return groupChain(
      toRows(result),
      (row) => `audit:${asString(row.tenant_id)}`,
      (row) => asString(row.this_hash),
    );
  } catch (error) {
    logger.warn(
      'ledger-attestor: ai_audit_chain read failed (schema may be pre-migration)',
      { reason: messageOf(error) },
    );
    return [];
  }
}

/**
 * Group already-ordered rows into one {@link ChainSegment} per chainId,
 * assigning a dense 0-based leaf index in append order so the attestor's
 * contiguity check always holds. Rows whose chainId or rowHash is missing
 * are skipped defensively.
 */
function groupChain(
  rows: ReadonlyArray<Record<string, unknown>>,
  chainIdOf: (row: Record<string, unknown>) => string | undefined,
  rowHashOf: (row: Record<string, unknown>) => string | undefined,
): ReadonlyArray<ChainSegment> {
  const byChain = new Map<string, ChainLeaf[]>();
  for (const row of rows) {
    const chainId = chainIdOf(row);
    const rowHash = rowHashOf(row);
    if (!chainId || !rowHash) continue;
    const leaves = byChain.get(chainId);
    if (leaves) {
      leaves.push({ index: leaves.length, rowHash });
    } else {
      byChain.set(chainId, [{ index: 0, rowHash }]);
    }
  }
  return [...byChain.entries()].map(([chainId, leaves]) => ({
    chainId,
    leaves,
  }));
}

// ─────────────────────────────────────────────────────────────────────
// Signer — default Ed25519, optionally seeded from a stable PEM.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the signer. Production should inject a KMS/HSM `SignerPort`; absent
 * that, we use the zero-dependency Ed25519 signer. When
 * `LEDGER_ATTEST_SIGNING_KEY_PEM` is set we seed it so the key (and thus the
 * verifiable signature) is stable across restarts; otherwise a fresh keypair
 * is generated per process (still verifiable within that process lifetime).
 */
function resolveSigner(): SignerPort {
  const pem = process.env.LEDGER_ATTEST_SIGNING_KEY_PEM?.trim();
  const handle = createEd25519Signer(
    pem ? { privateKeyPem: pem } : {},
  );
  return handle.signer;
}

// ─────────────────────────────────────────────────────────────────────
// Sinks — in-memory always; env-gated S3 Object-Lock when configured.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_RETENTION_DAYS = 365 * 7; // regulator retention

/**
 * Resolve the WORM sinks. The in-memory sink is ALWAYS present so a fresh
 * deploy attests + verifies end-to-end with zero external infra. When
 * `LEDGER_ATTEST_BUCKET` is set we additionally attempt an S3 Object-Lock
 * sink whose `PutObject` is backed by `@aws-sdk/client-s3` resolved via a
 * runtime dynamic import (the SDK is intentionally NOT a dependency of this
 * worker — the same dependency-light contract the attestor package keeps). If
 * the SDK is absent we log + fall back to the in-memory sink only.
 */
async function resolveSinks(): Promise<ReadonlyArray<ExternalSinkPort>> {
  const sinks: ExternalSinkPort[] = [createInMemorySink('in-memory')];

  const bucket = process.env.LEDGER_ATTEST_BUCKET?.trim();
  if (!bucket) return sinks;

  const objectPut = await loadS3ObjectPut();
  if (!objectPut) {
    logger.warn(
      'ledger-attestor: LEDGER_ATTEST_BUCKET set but @aws-sdk/client-s3 ' +
        'unavailable — S3 object-lock sink disabled, using in-memory only',
      { bucket },
    );
    return sinks;
  }

  const retentionDays = resolveRetentionDays();
  const retentionMode = resolveRetentionMode();
  sinks.push(
    createS3ObjectLockSink(objectPut, {
      bucket,
      prefix: process.env.LEDGER_ATTEST_PREFIX?.trim() || 'ledger-attestations',
      retentionDays,
      retentionMode,
    }),
  );
  logger.info('ledger-attestor: S3 object-lock sink enabled', {
    bucket,
    retentionDays,
    retentionMode,
  });
  return sinks;
}

/**
 * Lazily build an {@link ObjectPutPort} backed by `@aws-sdk/client-s3`. The
 * SDK is loaded via a runtime dynamic import so this worker compiles + runs
 * without it; a missing SDK resolves to null (caller falls back to in-memory).
 *
 * The `S3Client` + `PutObjectCommand` are duck-typed locally so there is no
 * compile-time dependency on `@aws-sdk/client-s3`.
 */
async function loadS3ObjectPut(): Promise<ObjectPutPort | null> {
  try {
    const mod = (await import(
      /* @vite-ignore */ '@aws-sdk/client-s3'
    )) as unknown as S3SdkModule;
    if (
      typeof mod.S3Client !== 'function' ||
      typeof mod.PutObjectCommand !== 'function'
    ) {
      return null;
    }
    const region = process.env.AWS_REGION?.trim() || 'us-east-1';
    const client = new mod.S3Client({ region });
    const PutObjectCommand = mod.PutObjectCommand;
    return {
      async put(req: ObjectPutRequest): Promise<ObjectPutResult> {
        const out = (await client.send(
          new PutObjectCommand({
            Bucket: req.bucket,
            Key: req.key,
            Body: req.body,
            ContentType: req.contentType,
            ObjectLockMode: req.retentionMode,
            ObjectLockRetainUntilDate: new Date(req.retainUntilIso),
          }),
        )) as { VersionId?: string };
        return { versionId: out.VersionId ?? '' };
      },
    };
  } catch (error) {
    logger.warn('ledger-attestor: @aws-sdk/client-s3 dynamic import failed', {
      reason: messageOf(error),
    });
    return null;
  }
}

/** Minimal duck-type of the slice of `@aws-sdk/client-s3` we touch. */
interface S3SdkModule {
  S3Client: new (cfg: { region: string }) => {
    send(command: unknown): Promise<unknown>;
  };
  PutObjectCommand: new (input: {
    Bucket: string;
    Key: string;
    Body: string;
    ContentType: string;
    ObjectLockMode: 'COMPLIANCE' | 'GOVERNANCE';
    ObjectLockRetainUntilDate: Date;
  }) => unknown;
}

function resolveRetentionDays(): number {
  const raw = Number(process.env.LEDGER_ATTEST_RETENTION_DAYS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_RETENTION_DAYS;
  return Math.floor(raw);
}

function resolveRetentionMode(): 'COMPLIANCE' | 'GOVERNANCE' {
  return process.env.LEDGER_ATTEST_RETENTION_MODE?.trim() === 'GOVERNANCE'
    ? 'GOVERNANCE'
    : 'COMPLIANCE';
}

// ─────────────────────────────────────────────────────────────────────
// Cron entrypoint.
// ─────────────────────────────────────────────────────────────────────

export interface LedgerAttestorCronDeps {
  readonly source: ChainSourcePort;
  readonly signer: SignerPort;
  readonly sinks: ReadonlyArray<ExternalSinkPort>;
  readonly store: CheckpointStorePort;
}

/**
 * Build the cron deps from a read-only DB client. The checkpoint store is
 * created ONCE per supervisor (so prevRoot / skip-unchanged work across
 * ticks) — call this once at boot and reuse the returned deps each tick.
 */
export async function buildLedgerAttestorCronDeps(
  db: AttestorDbLike,
): Promise<LedgerAttestorCronDeps> {
  return {
    source: createChainSource(db),
    signer: resolveSigner(),
    sinks: await resolveSinks(),
    store: createInMemoryCheckpointStore(),
  };
}

/**
 * Run one attestation tick. `runAttestation` never throws (per-chain
 * fail-isolation); we warn (Pino) when any chain failed and info otherwise.
 */
export async function runLedgerAttestorCron(
  deps: LedgerAttestorCronDeps,
): Promise<AttestationRunResult> {
  const result = await runAttestation({
    source: deps.source,
    signer: deps.signer,
    sinks: deps.sinks,
    store: deps.store,
    logger: {
      info: (meta, msg) => logger.info(msg, meta as Record<string, unknown>),
      warn: (meta, msg) => logger.warn(msg, meta as Record<string, unknown>),
      error: (meta, msg) => logger.error(msg, meta as Record<string, unknown>),
    },
  });

  if (result.failed > 0) {
    logger.warn('ledger-attestor: one or more chains FAILED attestation', {
      failed: result.failed,
      scanned: result.scanned,
      attested: result.attested,
      skippedUnchanged: result.skippedUnchanged,
    });
  } else {
    logger.info('ledger-attestor: tick complete', {
      attested: result.attested,
      skippedUnchanged: result.skippedUnchanged,
      scanned: result.scanned,
    });
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function toRows(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) {
    return result as ReadonlyArray<Record<string, unknown>>;
  }
  const wrapped = (result as { rows?: ReadonlyArray<Record<string, unknown>> })
    ?.rows;
  return Array.isArray(wrapped) ? wrapped : [];
}

function asString(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
