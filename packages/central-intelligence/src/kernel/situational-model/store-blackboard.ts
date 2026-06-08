/**
 * Blackboard-slot situational-model store — persists the model on the
 * shared-state spine (`@borjie/blackboard-sota` CRDT slots) so the resident
 * mind's situational state IS the cross-surface blackboard, exactly as the
 * architecture dossier prescribes ("persist it on the BLACKBOARD spine where
 * possible").
 *
 * DECOUPLING: the kernel must not take a hard dependency on the blackboard
 * package, so this adapter speaks to a NARROW structural {@link SlotStorePort}
 * — the composition root passes the real `SlotStore` (whose `set`/`read`
 * signatures this port mirrors). The kernel stays import-light; the wiring
 * supplies the concrete spine.
 *
 * REPRESENTATION: one slot per entity, keyed `situational-model:${kind}:${id}`,
 * holding the serialized {@link SituationEntity} as its JSON value. Writes
 * route through the pure `mergeObservation` fold (read-merge-write) so the
 * ACT-R reference series survives — the slot's own CRDT LWW handles
 * cross-replica convergence of the resulting row. `list` is backed by an
 * index slot enumerating the live entity keys for a tenant (slots have no
 * native prefix-scan), kept in sync on record/remove.
 */

import type {
  RecordEntityInput,
  SituationalModelStore,
  SituationEntity,
  SituationEntityKey,
} from './types.js';
import { entityKeyOf } from './types.js';
import { mergeObservation, parseRecordInput } from './merge.js';

/** Slot kinds the blackboard accepts; the model uses 'dataset'. */
const SLOT_KIND = 'dataset' as const;
const SLOT_PREFIX = 'situational-model';
const INDEX_SLOT_SUFFIX = 'index';

/**
 * The narrow slice of `@borjie/blackboard-sota`'s `SlotStore` this adapter
 * needs. Structural so the kernel never imports the blackboard package; the
 * composition root passes the real store (the shapes line up exactly).
 */
export interface SlotStorePort {
  set(input: {
    readonly tenantId: string;
    readonly slotId: string;
    readonly slotKind: typeof SLOT_KIND;
    readonly value: Readonly<Record<string, unknown>>;
    readonly actorId: string;
    readonly surface: 'chat';
  }): Promise<unknown>;
  read(
    tenantId: string,
    slotId: string,
  ): Promise<{ readonly value: Readonly<Record<string, unknown>> | null } | null>;
  remove(input: {
    readonly tenantId: string;
    readonly slotId: string;
    readonly actorId: string;
    readonly surface: 'chat';
  }): Promise<unknown>;
}

export interface BlackboardSituationalStoreDeps {
  readonly slots: SlotStorePort;
  /** Stable actor id for the resident mind's writes. */
  readonly actorId?: string;
  readonly now?: () => number;
  readonly logger?: { warn(msg: string, meta?: Record<string, unknown>): void };
}

const NOOP_LOGGER = { warn(): void {} };

function entitySlotId(key: SituationEntityKey): string {
  return `${SLOT_PREFIX}:${key}`;
}

function indexSlotId(): string {
  return `${SLOT_PREFIX}:${INDEX_SLOT_SUFFIX}`;
}

function entityToValue(entity: SituationEntity): Readonly<Record<string, unknown>> {
  return { entity: entity as unknown as Record<string, unknown> };
}

function valueToEntity(
  value: Readonly<Record<string, unknown>> | null,
): SituationEntity | null {
  if (!value || typeof value !== 'object') return null;
  const raw = (value as { entity?: unknown }).entity;
  if (!raw || typeof raw !== 'object') return null;
  return Object.freeze({ ...(raw as SituationEntity) });
}

export function createBlackboardSituationalModelStore(
  deps: BlackboardSituationalStoreDeps,
): SituationalModelStore {
  const now = deps.now ?? (() => Date.now());
  const actorId = deps.actorId ?? 'brain:estate-mind';
  const logger = deps.logger ?? NOOP_LOGGER;
  const { slots } = deps;

  async function readIndex(
    tenantId: string,
  ): Promise<ReadonlyArray<SituationEntityKey>> {
    try {
      const slot = await slots.read(tenantId, indexSlotId());
      const keys = (slot?.value as { keys?: unknown })?.keys;
      if (Array.isArray(keys)) {
        return keys.filter((k): k is string => typeof k === 'string');
      }
      return [];
    } catch (err) {
      logger.warn('situational-model blackboard: index read failed', {
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  async function writeIndex(
    tenantId: string,
    keys: ReadonlyArray<SituationEntityKey>,
  ): Promise<void> {
    await slots.set({
      tenantId,
      slotId: indexSlotId(),
      slotKind: SLOT_KIND,
      value: { keys: [...new Set(keys)] },
      actorId,
      surface: 'chat',
    });
  }

  return {
    async get(
      tenantId: string,
      key: SituationEntityKey,
    ): Promise<SituationEntity | null> {
      const slot = await slots.read(tenantId, entitySlotId(key));
      return valueToEntity(slot?.value ?? null);
    },

    async record(input: RecordEntityInput): Promise<SituationEntity> {
      parseRecordInput(input);
      const key = entityKeyOf(input.kind, input.entityId);
      const existing = await slots.read(input.tenantId, entitySlotId(key));
      const prev = valueToEntity(existing?.value ?? null);
      const merged = mergeObservation(prev, input, now());
      await slots.set({
        tenantId: input.tenantId,
        slotId: entitySlotId(key),
        slotKind: SLOT_KIND,
        value: entityToValue(merged),
        actorId,
        surface: 'chat',
      });
      if (prev === null) {
        const keys = await readIndex(input.tenantId);
        if (!keys.includes(key)) {
          await writeIndex(input.tenantId, [...keys, key]);
        }
      }
      return merged;
    },

    async list(tenantId: string): Promise<ReadonlyArray<SituationEntity>> {
      const keys = await readIndex(tenantId);
      const out: SituationEntity[] = [];
      for (const key of keys) {
        const slot = await slots.read(tenantId, entitySlotId(key));
        const entity = valueToEntity(slot?.value ?? null);
        if (entity) out.push(entity);
      }
      return out;
    },

    async remove(tenantId: string, key: SituationEntityKey): Promise<void> {
      try {
        await slots.remove({
          tenantId,
          slotId: entitySlotId(key),
          actorId,
          surface: 'chat',
        });
      } catch (err) {
        logger.warn('situational-model blackboard: remove failed', {
          tenantId,
          key,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const keys = await readIndex(tenantId);
      const next = keys.filter((k) => k !== key);
      if (next.length !== keys.length) {
        await writeIndex(tenantId, next);
      }
    },
  };
}
