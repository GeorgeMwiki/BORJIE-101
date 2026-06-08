/**
 * `SituationalModel` — the read/write facade over any
 * {@link SituationalModelStore} adapter (in-memory, blackboard slot, Drizzle).
 *
 * This is the surface the resident `EstateMind` Slow Loop WRITES each tick
 * (`observe`) and the per-request `think(req)` Fast Loop READS (`snapshot`,
 * `broadcast`). The activation/salience field is COMPUTED on read from the
 * stored reference series, so a snapshot can never carry stale salience.
 *
 * Tenant isolation is structural: every method takes a `tenantId` and the
 * underlying store keys by it. The facade adds:
 *   - activation decoration (ACT-R) over the raw rows;
 *   - the Global-Workspace single broadcast (the one most-salient entity);
 *   - decay-based pruning (`prune`) the loop can call to forget cold entities.
 *
 * Reads degrade safe: a store fault surfaces an empty snapshot (the Fast Loop
 * is never blocked by a situational-model miss). Writes throw (so the loop
 * learns) but the loop catches at its boundary so a write fault never crashes
 * the heartbeat.
 */

import type {
  ActivatedEntity,
  ActivationParams,
  RecordEntityInput,
  SituationalModelStore,
  SituationalSnapshot,
  SituationEntity,
  SituationEntityKey,
} from './types.js';
import { DEFAULT_ACTIVATION_PARAMS, entityKeyOf } from './types.js';
import { activateAll, baseLevelActivation } from './activation.js';

export interface SituationalModelDeps {
  readonly store: SituationalModelStore;
  /** Injectable clock so snapshots are deterministic in tests. */
  readonly now?: () => number;
  /** Activation tuning. Defaults to the ACT-R canon. */
  readonly params?: ActivationParams;
  /**
   * Narrow structural logger. On a store read fault the snapshot degrades to
   * empty + logs a warning; on a write fault the error propagates. No
   * `console.*` — Pino shim injected at the composition root.
   */
  readonly logger?: {
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface SituationalModel {
  /** Record/refresh one entity (the loop's PERCEIVE write). */
  observe(input: RecordEntityInput): Promise<SituationEntity>;
  /** Read one raw entity row (pre-activation), or null. */
  get(tenantId: string, key: SituationEntityKey): Promise<SituationEntity | null>;
  /** Compute the activated, ranked snapshot the Fast Loop reads. */
  snapshot(tenantId: string): Promise<SituationalSnapshot>;
  /** The single most-salient entity (GWT broadcast), or null. */
  broadcast(tenantId: string): Promise<ActivatedEntity | null>;
  /**
   * Forget entities whose base-level activation has decayed below
   * `params.retrievalThreshold` AND that have not been referenced within
   * `minIdleMs`. Returns the keys pruned. A no-op when the threshold is
   * −Infinity (the default), so pruning is strictly opt-in.
   */
  prune(tenantId: string, minIdleMs: number): Promise<ReadonlyArray<SituationEntityKey>>;
}

const NOOP_LOGGER = { warn(): void {} };

export function createSituationalModel(
  deps: SituationalModelDeps,
): SituationalModel {
  const now = deps.now ?? (() => Date.now());
  const params = deps.params ?? DEFAULT_ACTIVATION_PARAMS;
  const logger = deps.logger ?? NOOP_LOGGER;
  const { store } = deps;

  async function safeList(
    tenantId: string,
  ): Promise<ReadonlyArray<SituationEntity>> {
    try {
      return await store.list(tenantId);
    } catch (err) {
      logger.warn('situational-model: list failed — degrading to empty', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  return {
    async observe(input: RecordEntityInput): Promise<SituationEntity> {
      return store.record(input);
    },

    async get(tenantId, key): Promise<SituationEntity | null> {
      try {
        return await store.get(tenantId, key);
      } catch (err) {
        logger.warn('situational-model: get failed — returning null', {
          tenantId,
          key,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },

    async snapshot(tenantId: string): Promise<SituationalSnapshot> {
      const computedAtMs = now();
      const rows = await safeList(tenantId);
      const entities = activateAll(rows, computedAtMs, params);
      return Object.freeze({
        tenantId,
        entities,
        broadcast: entities[0] ?? null,
        computedAtMs,
      });
    },

    async broadcast(tenantId: string): Promise<ActivatedEntity | null> {
      const snap = await this.snapshot(tenantId);
      return snap.broadcast;
    },

    async prune(
      tenantId: string,
      minIdleMs: number,
    ): Promise<ReadonlyArray<SituationEntityKey>> {
      if (!Number.isFinite(params.retrievalThreshold) && params.retrievalThreshold === Number.NEGATIVE_INFINITY) {
        return [];
      }
      const nowMs = now();
      const rows = await safeList(tenantId);
      const pruned: SituationEntityKey[] = [];
      for (const row of rows) {
        const idleMs = nowMs - row.lastReferencedAtMs;
        if (idleMs < minIdleMs) continue;
        const baseLevel = baseLevelActivation(row, nowMs, params);
        if (baseLevel < params.retrievalThreshold) {
          const key = entityKeyOf(row.kind, row.entityId);
          try {
            await store.remove(tenantId, key);
            pruned.push(key);
          } catch (err) {
            logger.warn('situational-model: prune remove failed', {
              tenantId,
              key,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      return Object.freeze(pruned);
    },
  };
}
