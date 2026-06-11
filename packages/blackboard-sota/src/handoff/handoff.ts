/**
 * Surface/device handoff primitive.
 *
 * MD-as-Body capstone (lane: cross-surface state bus). The Apple
 * Handoff / Google Continue-On / Astra primitive: "move this live
 * object onto the surface the human is now looking at." It does NOT
 * copy the slot — it RE-PROJECTS the SAME single CRDT slot onto the
 * target surface, broadcasting a handoff signal so the target surface
 * pulls (and renders) the live value, and recording a provenance
 * breadcrumb so the audit trail shows the continuity (chat -> tab ->
 * mobile).
 *
 * Because the slot is a CRDT register, the projection is always the
 * current converged value — there is no stale snapshot to ship.
 */

import {
  type RealtimePort,
  tenantChannelName,
} from '@borjie/realtime-adapter';
import {
  type HandoffProjection,
  type HandoffRequest,
  type SlotsRepository,
} from '../types.js';

/** Event name carried on the state-bus channel for handoff signals. */
export const SLOT_HANDOFF_EVENT = 'slot-handoff' as const;

export interface HandoffServiceDeps {
  readonly repository: SlotsRepository;
  readonly realtime: RealtimePort;
  readonly now?: () => Date;
}

export interface HandoffService {
  /**
   * Hand a slot off from one surface to another. Re-projects the live
   * CRDT slot onto the target, records provenance, and broadcasts the
   * handoff signal so the target surface mounts it. Returns the
   * projection (same slot value — lives once).
   */
  handoff(request: HandoffRequest): Promise<HandoffProjection>;
  /**
   * Subscribe to inbound handoffs targeting `surface`. The callback
   * fires with the live projection so the surface can mount/focus it.
   * Returns an async teardown.
   */
  onInbound(
    tenantId: string,
    surface: HandoffRequest['toSurface'],
    handler: (projection: HandoffProjection) => void | Promise<void>,
  ): Promise<() => Promise<void>>;
}

function isHandoffProjection(value: unknown): value is HandoffProjection {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['tenantId'] === 'string' &&
    typeof v['slotId'] === 'string' &&
    typeof v['toSurface'] === 'string' &&
    typeof v['slot'] === 'object' &&
    v['slot'] !== null
  );
}

export function createHandoffService(
  deps: HandoffServiceDeps,
): HandoffService {
  const now = deps.now ?? (() => new Date());
  const { repository, realtime } = deps;

  return {
    async handoff(request: HandoffRequest): Promise<HandoffProjection> {
      const slot = await repository.get(request.tenantId, request.slotId);
      if (slot === null) {
        throw new Error(
          `handoff: slot "${request.slotId}" does not exist — nothing to hand off`,
        );
      }
      if (slot.deleted) {
        throw new Error(
          `handoff: slot "${request.slotId}" is tombstoned — cannot hand off a deleted slot`,
        );
      }

      // Record the target surface in the slot's projection provenance,
      // seeding the chain with the source surface on first handoff so
      // the audit trail reads source -> target.
      const existing = await repository.projectionsOf(
        request.tenantId,
        request.slotId,
      );
      if (existing.length === 0) {
        await repository.recordProjection(
          request.tenantId,
          request.slotId,
          request.fromSurface,
        );
      }
      const provenance = await repository.recordProjection(
        request.tenantId,
        request.slotId,
        request.toSurface,
      );

      const projection: HandoffProjection = {
        tenantId: request.tenantId,
        slotId: request.slotId,
        toSurface: request.toSurface,
        toDevice: request.toDevice ?? null,
        slot,
        provenance,
        handedOffAt: now(),
      };

      // Broadcast so the target surface mounts the live slot. The
      // payload serializes losslessly to JSON (Date -> ISO on the wire;
      // the inbound side reconstructs from the live repository slot).
      await realtime.broadcast(
        tenantChannelName(request.tenantId, 'state-bus'),
        SLOT_HANDOFF_EVENT,
        projection as unknown as Record<string, unknown>,
      );

      return projection;
    },

    async onInbound(tenantId, surface, handler) {
      const channel = tenantChannelName(tenantId, 'state-bus');
      const handle = await realtime.subscribe(
        channel,
        { event: SLOT_HANDOFF_EVENT },
        async (evt) => {
          if (!isHandoffProjection(evt.payload)) return;
          const projection = evt.payload;
          if (projection.tenantId !== tenantId) return;
          if (projection.toSurface !== surface) return;
          // Re-read the LIVE slot from the repository so the surface
          // always mounts the current converged value, never a stale
          // wire snapshot.
          const live = await repository.get(tenantId, projection.slotId);
          await handler({
            ...projection,
            slot: live ?? projection.slot,
            handedOffAt: new Date(projection.handedOffAt),
          });
        },
      );
      return async () => {
        await realtime.unsubscribe(handle);
      };
    },
  };
}
