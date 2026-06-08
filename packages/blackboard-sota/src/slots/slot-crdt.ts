/**
 * CRDT named-slot core — the conflict-free merge that lets a single
 * decision/doc/task live ONCE across chat, owner-web, and both mobile
 * apps (MD-as-Body capstone, lane: cross-surface state bus).
 *
 * Each slot is a Last-Writer-Wins register (Shapiro et al. 2011,
 * "Conflict-free Replicated Data Types") carrying an arbitrary JSON
 * value, paired with a version vector tracking per-actor causal
 * history. The merge is a JOIN over a lattice, so it is:
 *
 *   - COMMUTATIVE:  merge(a,b) == merge(b,a)
 *   - ASSOCIATIVE:  merge(merge(a,b),c) == merge(a,merge(b,c))
 *   - IDEMPOTENT:   merge(a,a) == a
 *
 * Those three laws are exactly what makes the bus safe over an
 * at-least-once realtime transport: out-of-order and duplicate deltas
 * converge to the same state on every replica.
 *
 * The LWW tie-break is a TOTAL order (clock, then wall-clock, then
 * actorId) so two genuinely-concurrent writes resolve deterministically
 * — never a coin-flip that diverges between devices.
 *
 * PURE: no I/O, no clock reads inside the merge. The caller supplies
 * the clock when constructing a write; merge only compares.
 */

import type {
  ActorId,
  Slot,
  SlotDeleteInput,
  SlotKind,
  SlotWriteInput,
  VersionVector,
} from '../types.js';

/**
 * Element-wise max of two version vectors (the lattice join). Keys
 * present in only one vector are carried through. This is associative,
 * commutative, and idempotent by construction.
 */
export function joinVersionVectors(
  a: VersionVector,
  b: VersionVector,
): VersionVector {
  const out: Record<ActorId, number> = {};
  for (const [actor, n] of Object.entries(a)) {
    out[actor] = n;
  }
  for (const [actor, n] of Object.entries(b)) {
    const existing = out[actor];
    out[actor] = existing === undefined ? n : Math.max(existing, n);
  }
  return Object.freeze(out);
}

/**
 * The Lamport clock for a brand-new write by `actorId`, given the slot
 * it is overwriting (or null for the first write). The new clock is
 * `1 + max(all counters seen so far)` so it strictly dominates every
 * write the actor has observed — the standard Lamport advance.
 */
export function nextClock(prev: Slot | null): number {
  if (prev === null) return 1;
  let maxSeen = prev.clock;
  for (const n of Object.values(prev.version)) {
    if (n > maxSeen) maxSeen = n;
  }
  return maxSeen + 1;
}

/**
 * Returns true iff write `x` dominates write `y` under the total LWW
 * order. Used by {@link mergeSlot} to pick the surviving register.
 *
 *   1. higher Lamport clock wins;
 *   2. on a clock tie, higher wall-clock ms wins;
 *   3. on a wall-clock tie, lexicographically greater writerId wins.
 *
 * Step (3) breaks the final tie deterministically, guaranteeing a
 * total order so the merge converges identically on every replica.
 */
export function dominates(x: Slot, y: Slot): boolean {
  if (x.clock !== y.clock) return x.clock > y.clock;
  if (x.wallClockMs !== y.wallClockMs) return x.wallClockMs > y.wallClockMs;
  return x.writerId > y.writerId;
}

/**
 * Construct a slot from a write input. The caller passes the previous
 * slot (so the Lamport clock advances) and the wall-clock ms (so merge
 * stays pure). Immutable — returns a frozen Slot.
 */
export function writeSlot(
  input: SlotWriteInput,
  prev: Slot | null,
  wallClockMs: number,
): Slot {
  const clock = nextClock(prev);
  const baseVersion: VersionVector = prev?.version ?? {};
  const version = joinVersionVectors(baseVersion, { [input.actorId]: clock });
  return freezeSlot({
    tenantId: input.tenantId,
    slotId: input.slotId,
    slotKind: input.slotKind,
    value: Object.freeze({ ...input.value }),
    writerId: input.actorId,
    clock,
    wallClockMs,
    deleted: false,
    version,
  });
}

/**
 * Construct a tombstone (delete) slot. A delete is just an LWW write
 * with `deleted: true` and a `null` value — so a later set on a higher
 * clock revives the slot, and a delete on a higher clock wins over an
 * earlier set. Add-wins vs remove-wins is therefore decided by the same
 * clock order, which is what we want for a single-register semantics.
 */
export function deleteSlot(
  input: SlotDeleteInput,
  prev: Slot,
  wallClockMs: number,
): Slot {
  const clock = nextClock(prev);
  const version = joinVersionVectors(prev.version, {
    [input.actorId]: clock,
  });
  return freezeSlot({
    tenantId: input.tenantId,
    slotId: input.slotId,
    slotKind: prev.slotKind,
    value: null,
    writerId: input.actorId,
    clock,
    wallClockMs,
    deleted: true,
    version,
  });
}

/**
 * The CRDT merge. Picks the dominating register for the value, and
 * joins the version vectors so causal history is never lost. Pure,
 * commutative, associative, idempotent.
 *
 * Precondition: both slots share the same `tenantId` and `slotId`.
 * Mixing slots is a programming error and throws — it would silently
 * corrupt state otherwise.
 */
export function mergeSlot(a: Slot, b: Slot): Slot {
  if (a.tenantId !== b.tenantId) {
    throw new Error(
      `slot-crdt: cannot merge across tenants ("${a.tenantId}" vs "${b.tenantId}")`,
    );
  }
  if (a.slotId !== b.slotId) {
    throw new Error(
      `slot-crdt: cannot merge different slots ("${a.slotId}" vs "${b.slotId}")`,
    );
  }

  const version = joinVersionVectors(a.version, b.version);
  const winner = dominates(a, b) ? a : b;

  // The winner's register fields, but the JOINED version vector so no
  // replica's causal knowledge is dropped on merge.
  return freezeSlot({
    tenantId: winner.tenantId,
    slotId: winner.slotId,
    slotKind: winner.slotKind,
    value: winner.value,
    writerId: winner.writerId,
    clock: winner.clock,
    wallClockMs: winner.wallClockMs,
    deleted: winner.deleted,
    version,
  });
}

/**
 * Deep-freeze the slot's mutable surfaces so consumers cannot mutate a
 * shared register in place (the immutability rule + CRDT safety).
 */
function freezeSlot(slot: Slot): Slot {
  return Object.freeze({
    ...slot,
    value: slot.value === null ? null : Object.freeze({ ...slot.value }),
    version: Object.freeze({ ...slot.version }),
  });
}

/** Re-export the value enumeration helper for ergonomics. */
export function isSlotKind(value: string): value is SlotKind {
  return (
    value === 'decision' ||
    value === 'document' ||
    value === 'task' ||
    value === 'draft' ||
    value === 'dataset' ||
    value === 'note'
  );
}
