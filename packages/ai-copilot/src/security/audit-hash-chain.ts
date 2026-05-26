/**
 * BORJIE AI audit hash chain — Wave-11 AI security hardening, K5 parity uplift.
 *
 * Tamper-evident, append-only audit log. Each turn's row hash is computed with
 * `HMAC-SHA-256(secret, prevHash || canonical(row))` so a database-level forgery
 * requires the application secret in addition to write access. The secret may be
 * rotated by setting `SESSION_HASH_SECRET_PREV` for a 24h overlap window; verify
 * accepts a digest produced by either the active OR previous secret using a
 * constant-time compare (`crypto.timingSafeEqual`).
 *
 * Verification is OOM-safe — verifyAll/verifyChain process the chain in 500-row
 * chunks via an async generator pulled from the repository, never materialising
 * the full list. `verifyTail(n)` validates only the most recent N rows against
 * their predecessor anchor for cheap read-path checks, and `verifyRandomSample(p)`
 * spot-checks each row with probability `p` for use from a periodic audit cron.
 *
 * The repository port is storage-agnostic so tests can use an in-memory map and
 * production can bind the drizzle `ai_audit_chain` table (with the append-only
 * trigger declared in migration 0127). No floats, no mutation, no hidden clocks
 * — everything is injectable.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';
// Wave-K Tier-3 — defer key-rotation verification to the canonical
// `verifyWithRotation` primitive from @borjie/observability. The
// local rowHashMatches() helper retained below now delegates so the
// rotation contract has a single source of truth across the platform.
import { verifyWithRotation } from '@borjie/observability';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HashedAuditEntry {
  readonly id: string;
  readonly tenantId: string;
  readonly sequenceId: number;
  readonly turnId: string;
  readonly sessionId: string | null;
  readonly action: string;
  readonly prevHash: string;
  readonly thisHash: string;
  readonly payloadRef: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface AppendAuditInput {
  readonly tenantId: string;
  readonly turnId: string;
  readonly action: string;
  readonly sessionId?: string;
  readonly payloadRef?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface ChainVerificationResult {
  readonly valid: boolean;
  readonly entriesChecked: number;
  readonly brokenAt?: number;
  readonly error?: string;
  /**
   * Breakdown of which signing key validated each row, during a
   * rotation-overlap soak window. Counts every row whose HMAC was
   * recomputed (recomputeHash=true) — verifyRandomSample uses sampling
   * so its breakdown reflects sampled entries only.
   *
   *   current  — signed under the active secret
   *   previous — signed under the previous secret (drainage candidate)
   *   legacy   — chain pre-dates HMAC rotation (no secrets configured)
   *
   * Operators monitor `previous` over the 24h soak: it should trend to
   * zero before the previous key is removed.
   */
  readonly roleBreakdown?: {
    readonly current: number;
    readonly previous: number;
    readonly legacy: number;
  };
}

export interface RandomSampleVerificationResult extends ChainVerificationResult {
  readonly entriesSampled: number;
}

export interface AuditChainRepository {
  insertEntry(entry: HashedAuditEntry): Promise<HashedAuditEntry>;
  /** Return the most recent entry (by sequenceId) for a tenant, or null. */
  getLatest(tenantId: string): Promise<HashedAuditEntry | null>;
  listByTenant(
    tenantId: string,
    options?: { readonly fromSeq?: number; readonly limit?: number },
  ): Promise<readonly HashedAuditEntry[]>;
  /**
   * Stream entries in ascending sequenceId order in batches sized by `batchSize`
   * (default 500). Implementations MUST not load the full list into memory.
   * The in-memory test repo emulates this by slicing.
   */
  streamByTenant?(
    tenantId: string,
    options?: { readonly fromSeq?: number; readonly batchSize?: number },
  ): AsyncIterable<readonly HashedAuditEntry[]>;
  /** Total row count for `verifyRandomSample` probability scaling. Optional. */
  countByTenant?(tenantId: string): Promise<number>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GENESIS_PREV_HASH =
  'GENESIS_0000000000000000000000000000000000000000000000000000000000000000';

export const DEFAULT_STREAM_BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// Secret resolution + HMAC primitives
// ---------------------------------------------------------------------------

export interface HashSecretConfig {
  /**
   * Active HMAC secret. Falls back to `process.env.SESSION_HASH_SECRET`. When
   * neither is set, the chain operates in unkeyed SHA-256 mode (legacy /
   * development) so existing tests and bootstrap flows keep working.
   */
  readonly active?: string;
  /**
   * Previous secret kept around for a 24h rotation overlap window. Verify
   * accepts rows hashed under either `active` or `previous`. Append always
   * uses `active`. Falls back to `process.env.SESSION_HASH_SECRET_PREV`.
   */
  readonly previous?: string;
}

interface ResolvedSecrets {
  readonly active: string | null;
  readonly previous: string | null;
}

function resolveSecrets(cfg?: HashSecretConfig): ResolvedSecrets {
  const active = cfg?.active ?? process.env.SESSION_HASH_SECRET ?? null;
  const previous = cfg?.previous ?? process.env.SESSION_HASH_SECRET_PREV ?? null;
  return {
    active: active && active.length > 0 ? active : null,
    previous: previous && previous.length > 0 ? previous : null,
  };
}

/**
 * Canonical JSON for the row — stable field ordering, no whitespace.
 */
function canonicalRow(params: {
  readonly sequenceId: number;
  readonly prevHash: string;
  readonly tenantId: string;
  readonly turnId: string;
  readonly action: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly timestamp: string;
}): string {
  return JSON.stringify({
    sequenceId: params.sequenceId,
    prevHash: params.prevHash,
    tenantId: params.tenantId,
    turnId: params.turnId,
    action: params.action,
    payload: params.payload,
    timestamp: params.timestamp,
  });
}

/**
 * Canonicalise + hash a single audit entry. Uses HMAC-SHA-256 when `secret`
 * is provided; otherwise falls back to plain SHA-256 (legacy compatibility).
 * Pure: same inputs always return the same hash.
 */
export function hashAuditPayload(
  params: {
    readonly sequenceId: number;
    readonly prevHash: string;
    readonly tenantId: string;
    readonly turnId: string;
    readonly action: string;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly timestamp: string;
  },
  secret?: string | null,
): string {
  const serialised = canonicalRow(params);
  if (secret && secret.length > 0) {
    return createHmac('sha256', secret).update(serialised).digest('hex');
  }
  return createHash('sha256').update(serialised).digest('hex');
}

/**
 * Constant-time hex digest comparison. Returns `false` for length mismatch
 * before performing the timing-safe compare so we never reveal length via
 * timing.
 */
export function digestEquals(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function validateNonEmpty(value: string | undefined, field: string): void {
  if (!value || value.trim() === '') {
    throw new Error(`audit-hash-chain: ${field} is required`);
  }
}

/**
 * Result of verifying a single row against the rotation pair. Carries the
 * role of the secret that validated so the verifier can attribute reads
 * during a key-rotation soak window:
 *
 *   'current'  — entry was signed under the active secret
 *   'previous' — entry was signed under the previous secret (rotation overlap)
 *   'legacy'   — both secrets are unset and SHA-256 fallback validated
 *   null       — neither key matched (tamper)
 */
type RowHashRole = 'current' | 'previous' | 'legacy' | null;

/**
 * Recompute the expected row hash and compare against the persisted one.
 *
 * When BOTH active + previous secrets are present, delegates to
 * `verifyWithRotation` from @borjie/observability so the rotation
 * contract has a single source of truth platform-wide. When only one
 * key is set we fall through to a single-key compare; when neither
 * is configured we fall back to plain SHA-256 for legacy chains.
 *
 * Returns the role attribution so the caller can surface drainage
 * progress during a 24h soak (e.g. operators count `role='previous'`
 * row-checks and confirm the count is dropping over the window).
 */
function rowHashRole(
  entry: HashedAuditEntry,
  secrets: ResolvedSecrets,
): RowHashRole {
  const inputs = {
    sequenceId: entry.sequenceId,
    prevHash: entry.prevHash,
    tenantId: entry.tenantId,
    turnId: entry.turnId,
    action: entry.action,
    payload: entry.payload,
    timestamp: entry.createdAt,
  };

  // No HMAC secrets configured → legacy SHA-256 path. Preserves
  // bootstrap / dev compatibility for chains seeded before rotation
  // was introduced.
  if (!secrets.active && !secrets.previous) {
    if (digestEquals(entry.thisHash, hashAuditPayload(inputs, null))) {
      return 'legacy';
    }
    return null;
  }

  // Rotation soak — both keys present. Defer to the canonical
  // observability primitive so the rotation contract stays consistent
  // across audit chain, webhook signing, JWT pepper, etc.
  if (secrets.active && secrets.previous) {
    const canonical = canonicalRow(inputs);
    // verifyWithRotation re-derives the HMAC for each candidate key in
    // constant time and returns which one matched.
    return verifyWithRotation(
      secrets.active,
      secrets.previous,
      canonical,
      entry.thisHash,
      'sha256',
    );
  }

  // Only one key set — current OR previous, not both. Fast path: a
  // single HMAC compare. Role is mapped to whichever key is present.
  const onlyKey = (secrets.active ?? secrets.previous) as string;
  const role: 'current' | 'previous' = secrets.active ? 'current' : 'previous';
  if (digestEquals(entry.thisHash, hashAuditPayload(inputs, onlyKey))) {
    return role;
  }
  return null;
}

/**
 * Boolean shorthand — preserved as the existing call-site contract.
 * The verifier paths now consult `rowHashRole` directly so they can
 * populate the role breakdown; this wrapper stays for any external
 * test that imports it via internal module-scope tooling.
 *
 * @internal — not exported from the package barrel.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function rowHashMatches(
  entry: HashedAuditEntry,
  secrets: ResolvedSecrets,
): boolean {
  return rowHashRole(entry, secrets) !== null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface AuditHashChainDeps {
  readonly repo: AuditChainRepository;
  readonly now?: () => Date;
  readonly idGenerator?: () => string;
  /**
   * HMAC secret config. When unset, the chain operates in unkeyed SHA-256 mode
   * for legacy compatibility.
   */
  readonly secret?: HashSecretConfig;
  /**
   * Streaming batch size for verifyAll / verifyChain. Defaults to 500. Smaller
   * batches help bound peak memory on extremely long sessions.
   */
  readonly streamBatchSize?: number;
  /** Optional RNG for verifyRandomSample (injectable for deterministic tests). */
  readonly rng?: () => number;
}

export interface AuditHashChain {
  append(input: AppendAuditInput): Promise<HashedAuditEntry>;
  /** Legacy alias — same as verifyChain. */
  verify(tenantId: string): Promise<ChainVerificationResult>;
  /** Verify the full chain in 500-row batches via streaming. OOM-safe. */
  verifyChain(tenantId: string): Promise<ChainVerificationResult>;
  /**
   * Verify only the most recent `n` rows. Anchors against the predecessor row
   * so a tampered older row that breaks the prev-hash chain into the tail
   * window is still caught.
   */
  verifyTail(tenantId: string, n: number): Promise<ChainVerificationResult>;
  /**
   * Spot-check each row with sampling probability `p` ∈ (0, 1]. Sequence-gap
   * and prev-hash linkage checks ALWAYS run; only the keyed hash recompute is
   * sampled. Intended for use from a periodic audit cron, NOT the read path.
   */
  verifyRandomSample(
    tenantId: string,
    p: number,
  ): Promise<RandomSampleVerificationResult>;
  listEntries(
    tenantId: string,
    options?: { readonly fromSeq?: number; readonly limit?: number },
  ): Promise<readonly HashedAuditEntry[]>;
}

/**
 * Async generator that wraps either the repo's native `streamByTenant` (the
 * production-grade path that uses Postgres keyset pagination) or falls back
 * to chunked `listByTenant` calls for repos that have not implemented
 * streaming yet (e.g. tests).
 */
async function* streamEntries(
  repo: AuditChainRepository,
  tenantId: string,
  batchSize: number,
): AsyncGenerator<readonly HashedAuditEntry[], void, void> {
  if (repo.streamByTenant) {
    for await (const batch of repo.streamByTenant(tenantId, { batchSize })) {
      if (batch.length > 0) yield batch;
    }
    return;
  }
  // Fallback: keyset-pagination via listByTenant.
  let fromSeq = 0;
  while (true) {
    const batch = await repo.listByTenant(tenantId, {
      fromSeq,
      limit: batchSize,
    });
    if (batch.length === 0) return;
    yield batch;
    if (batch.length < batchSize) return;
    const last = batch[batch.length - 1];
    if (last === undefined) return;
    fromSeq = last.sequenceId + 1;
  }
}

interface VerifierState {
  expectedSeq: number; // next sequenceId we expect (1 for genesis row)
  expectedPrev: string; // expected prevHash for the next row
  entriesChecked: number;
  /** Per-key counters for the rotation soak window. */
  roleBreakdown: { current: number; previous: number; legacy: number };
}

function makeVerifierState(initial: {
  expectedSeq: number;
  expectedPrev: string;
}): VerifierState {
  return {
    expectedSeq: initial.expectedSeq,
    expectedPrev: initial.expectedPrev,
    entriesChecked: 0,
    roleBreakdown: { current: 0, previous: 0, legacy: 0 },
  };
}

function verifyEntry(
  state: VerifierState,
  entry: HashedAuditEntry,
  secrets: ResolvedSecrets,
  options: { readonly recomputeHash: boolean },
): ChainVerificationResult | null {
  if (entry.sequenceId !== state.expectedSeq) {
    return {
      valid: false,
      entriesChecked: state.entriesChecked + 1,
      brokenAt: entry.sequenceId,
      error: `Sequence gap at ${entry.sequenceId}`,
    };
  }
  if (entry.prevHash !== state.expectedPrev) {
    return {
      valid: false,
      entriesChecked: state.entriesChecked + 1,
      brokenAt: entry.sequenceId,
      error: `prevHash mismatch at ${entry.sequenceId}`,
    };
  }
  if (options.recomputeHash) {
    const role = rowHashRole(entry, secrets);
    if (role === null) {
      return {
        valid: false,
        entriesChecked: state.entriesChecked + 1,
        brokenAt: entry.sequenceId,
        error: `payload mutated at sequence ${entry.sequenceId}`,
      };
    }
    state.roleBreakdown[role] += 1;
  }
  state.expectedSeq = entry.sequenceId + 1;
  state.expectedPrev = entry.thisHash;
  state.entriesChecked += 1;
  return null;
}

export function createAuditHashChain(deps: AuditHashChainDeps): AuditHashChain {
  const now = deps.now ?? (() => new Date());
  const genId =
    deps.idGenerator ??
    (() => `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`);
  const batchSize = deps.streamBatchSize ?? DEFAULT_STREAM_BATCH_SIZE;
  const rng = deps.rng ?? Math.random;

  const verifyChain = async (
    tenantId: string,
  ): Promise<ChainVerificationResult> => {
    validateNonEmpty(tenantId, 'tenantId');
    const secrets = resolveSecrets(deps.secret);
    const state = makeVerifierState({
      expectedSeq: 1,
      expectedPrev: GENESIS_PREV_HASH,
    });
    for await (const batch of streamEntries(deps.repo, tenantId, batchSize)) {
      for (const entry of batch) {
        const failure = verifyEntry(state, entry, secrets, {
          recomputeHash: true,
        });
        if (failure) return failure;
      }
    }
    return {
      valid: true,
      entriesChecked: state.entriesChecked,
      roleBreakdown: { ...state.roleBreakdown },
    };
  };

  return {
    async append(input) {
      validateNonEmpty(input.tenantId, 'tenantId');
      validateNonEmpty(input.turnId, 'turnId');
      validateNonEmpty(input.action, 'action');

      const secrets = resolveSecrets(deps.secret);
      const latest = await deps.repo.getLatest(input.tenantId);
      const sequenceId = (latest?.sequenceId ?? 0) + 1;
      const prevHash = latest?.thisHash ?? GENESIS_PREV_HASH;
      const timestamp = now().toISOString();
      const payload = input.payload ? { ...input.payload } : {};

      const thisHash = hashAuditPayload(
        {
          sequenceId,
          prevHash,
          tenantId: input.tenantId,
          turnId: input.turnId,
          action: input.action,
          payload,
          timestamp,
        },
        secrets.active,
      );

      const entry: HashedAuditEntry = {
        id: genId(),
        tenantId: input.tenantId,
        sequenceId,
        turnId: input.turnId,
        sessionId: input.sessionId ?? null,
        action: input.action,
        prevHash,
        thisHash,
        payloadRef: input.payloadRef ?? null,
        payload,
        createdAt: timestamp,
      };

      return deps.repo.insertEntry(entry);
    },

    verify: verifyChain,
    verifyChain,

    async verifyTail(tenantId, n) {
      validateNonEmpty(tenantId, 'tenantId');
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error('audit-hash-chain: verifyTail(n) requires n > 0');
      }
      const secrets = resolveSecrets(deps.secret);

      // Pull the most recent (n + 1) rows so we can anchor the tail against
      // its predecessor. We don't have a native repo "last N" so we use the
      // full list path here — acceptable because n is small for read-path
      // checks.
      const all = await deps.repo.listByTenant(tenantId);
      if (all.length === 0) {
        return { valid: true, entriesChecked: 0 };
      }
      const startIdx = Math.max(0, all.length - n);
      // Anchor row is the predecessor; if startIdx is 0 the anchor is
      // genesis.
      const anchorRow = startIdx === 0 ? undefined : all[startIdx - 1];
      const anchorPrev =
        startIdx === 0 ? GENESIS_PREV_HASH : (anchorRow?.thisHash ?? GENESIS_PREV_HASH);
      const anchorSeq =
        startIdx === 0 ? 1 : ((anchorRow?.sequenceId ?? 0) + 1);

      const state = makeVerifierState({
        expectedSeq: anchorSeq,
        expectedPrev: anchorPrev,
      });
      for (let i = startIdx; i < all.length; i++) {
        const entry = all[i];
        if (entry === undefined) continue;
        const failure = verifyEntry(state, entry, secrets, {
          recomputeHash: true,
        });
        if (failure) return failure;
      }
      return {
        valid: true,
        entriesChecked: state.entriesChecked,
        roleBreakdown: { ...state.roleBreakdown },
      };
    },

    async verifyRandomSample(tenantId, p) {
      validateNonEmpty(tenantId, 'tenantId');
      if (!Number.isFinite(p) || p <= 0 || p > 1) {
        throw new Error('audit-hash-chain: verifyRandomSample(p) requires 0 < p ≤ 1');
      }
      const secrets = resolveSecrets(deps.secret);
      const state = makeVerifierState({
        expectedSeq: 1,
        expectedPrev: GENESIS_PREV_HASH,
      });
      let entriesSampled = 0;
      for await (const batch of streamEntries(deps.repo, tenantId, batchSize)) {
        for (const entry of batch) {
          const recompute = rng() < p;
          if (recompute) entriesSampled += 1;
          const failure = verifyEntry(state, entry, secrets, {
            recomputeHash: recompute,
          });
          if (failure) {
            return { ...failure, entriesSampled };
          }
        }
      }
      return {
        valid: true,
        entriesChecked: state.entriesChecked,
        entriesSampled,
        roleBreakdown: { ...state.roleBreakdown },
      };
    },

    async listEntries(tenantId, options) {
      validateNonEmpty(tenantId, 'tenantId');
      return deps.repo.listByTenant(tenantId, options);
    },
  };
}

/**
 * Tiny in-memory repository for tests. Not exported from the package barrel.
 */
export function createInMemoryAuditChainRepo(): AuditChainRepository & {
  readonly entries: readonly HashedAuditEntry[];
  tamperAt(index: number, mutation: Partial<HashedAuditEntry>): void;
} {
  const rows: HashedAuditEntry[] = [];
  return {
    get entries() {
      return rows.map((r) => ({ ...r, payload: { ...r.payload } }));
    },
    async insertEntry(entry) {
      rows.push({ ...entry, payload: { ...entry.payload } });
      return { ...entry, payload: { ...entry.payload } };
    },
    async getLatest(tenantId) {
      const scoped = rows.filter((r) => r.tenantId === tenantId);
      if (scoped.length === 0) return null;
      const last = scoped[scoped.length - 1];
      if (last === undefined) return null;
      return { ...last, payload: { ...last.payload } };
    },
    async listByTenant(tenantId, options) {
      const fromSeq = options?.fromSeq ?? 0;
      const limit = options?.limit ?? Number.MAX_SAFE_INTEGER;
      return rows
        .filter((r) => r.tenantId === tenantId && r.sequenceId >= fromSeq)
        .slice(0, limit)
        .map((r) => ({ ...r, payload: { ...r.payload } }));
    },
    async *streamByTenant(tenantId, options) {
      const fromSeq = options?.fromSeq ?? 0;
      const size = options?.batchSize ?? DEFAULT_STREAM_BATCH_SIZE;
      const scoped = rows
        .filter((r) => r.tenantId === tenantId && r.sequenceId >= fromSeq)
        .map((r) => ({ ...r, payload: { ...r.payload } }));
      for (let i = 0; i < scoped.length; i += size) {
        yield scoped.slice(i, i + size);
      }
    },
    async countByTenant(tenantId) {
      return rows.filter((r) => r.tenantId === tenantId).length;
    },
    tamperAt(index, mutation) {
      if (index < 0 || index >= rows.length) return;
      rows[index] = { ...rows[index], ...mutation } as HashedAuditEntry;
    },
  };
}
