/**
 * Slot store — the cross-surface state bus front door.
 *
 * MD-as-Body capstone (lane: cross-surface state bus). Wraps a
 * {@link SlotsRepository} (CRDT-merge storage) and a {@link RealtimePort}
 * (reused from `@borjie/realtime-adapter`) so that:
 *
 *   - a write from ANY surface is persisted via the CRDT merge AND
 *     broadcast on the tenant-scoped `state-bus` channel;
 *   - any other surface subscribed to that channel feeds the incoming
 *     delta straight back through the SAME CRDT merge — so the object
 *     lives ONCE and every surface converges to the same value.
 *
 * The realtime layer is at-least-once; the CRDT merge makes duplicate
 * and out-of-order deltas safe, so the store never has to deduplicate
 * or order the wire.
 *
 * Loop-suppression: an incoming delta whose `originSurface` is THIS
 * store's surface is still merged (idempotent — no harm) but never
 * re-broadcast, so we don't echo our own writes around the ring.
 */

import {
  type RealtimePort,
  tenantChannelName,
} from '@borjie/realtime-adapter';
import {
  type Slot,
  type SlotDelta,
  type SlotDeleteInput,
  type SlotsRepository,
  type SlotSurface,
  type SlotWriteInput,
} from '../types.js';
import { deleteSlot, writeSlot } from './slot-crdt.js';

/** Event name carried on the state-bus channel for slot deltas. */
export const SLOT_DELTA_EVENT = 'slot-delta' as const;

export interface SlotStoreDeps {
  readonly repository: SlotsRepository;
  readonly realtime: RealtimePort;
  /** The surface this store instance runs on (provenance + loop-suppress). */
  readonly surface: SlotSurface;
  /** Injectable clock so the CRDT writes stay testable + deterministic. */
  readonly now?: () => number;
  /**
   * Called whenever a slot converges to a new value (local write OR a
   * remote delta merged in). The subscribing surface re-projects here.
   */
  readonly onConverged?: (slot: Slot) => void;
}

export interface SlotStore {
  /** Write (set) a slot value from this surface; persists + broadcasts. */
  set(input: SlotWriteInput): Promise<Slot>;
  /** Tombstone a slot from this surface; persists + broadcasts. */
  remove(input: SlotDeleteInput): Promise<Slot>;
  /** Read the current converged slot. */
  read(tenantId: string, slotId: string): Promise<Slot | null>;
  /**
   * Begin receiving remote slot deltas for a tenant. Returns an async
   * teardown. Wire this once per tenant per surface at bootstrap.
   */
  connect(tenantId: string): Promise<() => Promise<void>>;
}

function isSlotDelta(value: unknown): value is SlotDelta {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['tenantId'] === 'string' &&
    typeof v['originSurface'] === 'string' &&
    typeof v['slot'] === 'object' &&
    v['slot'] !== null
  );
}

export function createSlotStore(deps: SlotStoreDeps): SlotStore {
  const now = deps.now ?? (() => Date.now());
  const { repository, realtime, surface } = deps;

  async function persistAndBroadcast(slot: Slot): Promise<Slot> {
    const converged = await repository.merge(slot);
    deps.onConverged?.(converged);
    const delta: SlotDelta = {
      tenantId: converged.tenantId,
      slot: converged,
      originSurface: surface,
    };
    await realtime.broadcast(
      tenantChannelName(converged.tenantId, 'state-bus'),
      SLOT_DELTA_EVENT,
      // RealtimePayload is Record<string,unknown>; SlotDelta is structurally
      // compatible — it serializes losslessly to JSON.
      delta as unknown as Record<string, unknown>,
    );
    return converged;
  }

  return {
    async set(input: SlotWriteInput): Promise<Slot> {
      const prev = await repository.get(input.tenantId, input.slotId);
      const slot = writeSlot(input, prev, now());
      return persistAndBroadcast(slot);
    },

    async remove(input: SlotDeleteInput): Promise<Slot> {
      const prev = await repository.get(input.tenantId, input.slotId);
      if (prev === null) {
        throw new Error(
          `slot-store: cannot delete slot "${input.slotId}" — it does not exist`,
        );
      }
      const slot = deleteSlot(input, prev, now());
      return persistAndBroadcast(slot);
    },

    async read(tenantId, slotId) {
      return repository.get(tenantId, slotId);
    },

    async connect(tenantId: string): Promise<() => Promise<void>> {
      const channel = tenantChannelName(tenantId, 'state-bus');
      const handle = await realtime.subscribe(
        channel,
        { event: SLOT_DELTA_EVENT },
        async (evt) => {
          if (!isSlotDelta(evt.payload)) return;
          const delta = evt.payload;
          // Skip our own echoes — already merged + broadcast locally.
          if (delta.originSurface === surface) return;
          // Tenant guard: the channel is tenant-scoped, but defend in
          // depth against a mis-routed payload.
          if (delta.tenantId !== tenantId) return;
          // Feed remote delta through the SAME CRDT merge — convergent.
          const converged = await repository.merge(delta.slot);
          deps.onConverged?.(converged);
        },
      );
      return async () => {
        await realtime.unsubscribe(handle);
      };
    },
  };
}
