/**
 * Affective cross-process CONTINUITY via the CONSUMER read paths.
 *
 * The dark-consumer this pins: `createDrizzleAffectiveStore` PERSISTS every
 * `observe()` write-through, but `hydrate()` had ZERO production callers — the
 * two live consumers (the kernel turn's `observeAffective`, and the proactive
 * worker's `affectReader.read`) went memory-only. So on a fresh replica / cold
 * worker the cache was empty and both consumers reset to AFFECTIVE_DEFAULT /
 * null, leaving migration 0372's "survives restart / replica" promise
 * unrealized.
 *
 * These tests prove cross-process continuity WITHOUT a direct `hydrate()` call
 * in the assertion — they exercise the exact hydrate-then-read compositions the
 * production consumers now use:
 *
 *   (a) WORKER read path — the index.ts `affectReader.read` binding shape:
 *       `hydrate(t,u,now)` then `read(t,u,now)`. Process A observes+persists;
 *       a FRESH accumulator sharing the SAME store returns a NON-null profile.
 *
 *   (b) KERNEL turn path — `observeAffective` hydrates the cold cache before
 *       `observe()`, so the new turn decays/merges onto the PERSISTED prior
 *       (a frustrated streak) rather than folding onto AFFECTIVE_DEFAULT.
 */

import { describe, it, expect } from 'vitest';
import {
  inferMindState,
  AFFECTIVE_DEFAULT,
  createAffectiveAccumulator,
  type AffectiveStore,
  type AffectiveStoreRecord,
  type AffectiveProfile,
} from '../theory-of-mind.js';

const BASE = Date.now();
const ISO = (offset: number): string => new Date(BASE + offset).toISOString();
const AT = (offset: number): number => BASE + offset;

/** In-process fake of the durable store — same contract as the pg adapter. */
function fakeStore(): AffectiveStore & {
  rows: Map<string, AffectiveStoreRecord>;
} {
  const rows = new Map<string, AffectiveStoreRecord>();
  const k = (t: string, u: string) => `${t}:${u}`;
  return {
    rows,
    async load(t, u) {
      return rows.get(k(t, u)) ?? null;
    },
    async save(t, u, record) {
      rows.set(k(t, u), record);
    },
  };
}

/**
 * Mirror of the production `affectReader.read` binding in
 * services/api-gateway/src/index.ts: hydrate the durable row into the shared
 * accumulator's cache, THEN read synchronously. This is the worker read path.
 */
async function workerAffectReaderRead(
  acc: ReturnType<typeof createAffectiveAccumulator>,
  tenantId: string,
  userId: string,
  nowMs: number,
): Promise<AffectiveProfile | null> {
  await acc.hydrate(tenantId, userId, nowMs);
  return acc.read(tenantId, userId, nowMs);
}

describe('affective continuity — WORKER read path (index.ts affectReader binding)', () => {
  it('a FRESH accumulator sharing the SAME store returns a NON-null profile via the read path', async () => {
    const store = fakeStore();

    // Process A — the chat turn observes a frustrated streak and persists.
    const accA = createAffectiveAccumulator({ store });
    accA.observe('t1', 'u1', {
      mindState: inferMindState('I am furious!!!'),
      capturedAt: ISO(1),
    });
    const pA = accA.observe('t1', 'u1', {
      mindState: inferMindState('this is so frustrating!!!'),
      capturedAt: ISO(2),
    });
    // write-through is fire-and-forget; flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    // Process B — a FRESH accumulator (cold worker / replica) over the SAME
    // store. A memory-only `.read()` would return null here (the bug).
    const accB = createAffectiveAccumulator({ store });
    expect(accB.read('t1', 'u1', AT(3))).toBeNull();

    // The production worker read path hydrates first → NON-null profile.
    const viaReadPath = await workerAffectReaderRead(accB, 't1', 'u1', AT(3));
    expect(viaReadPath).not.toBeNull();
    expect(viaReadPath!.turns).toBe(pA.turns);
    expect(viaReadPath!.state.trust).toBeCloseTo(pA.state.trust, 3);
    // The persisted frustrated posterior survived the process boundary.
    expect(viaReadPath!.state.frustration).toBeGreaterThan(
      AFFECTIVE_DEFAULT.frustration,
    );
  });
});

describe('affective continuity — KERNEL turn path (hydrate before observe)', () => {
  /**
   * Mirror of the kernel `observeAffective` composition: hydrate the cold
   * cache FIRST, then observe this turn onto the persisted prior.
   */
  async function kernelObserveAffective(
    acc: ReturnType<typeof createAffectiveAccumulator>,
    tenantId: string,
    userId: string,
    message: string,
    nowMs: number,
  ): Promise<AffectiveProfile | null> {
    await acc.hydrate(tenantId, userId, nowMs);
    return acc.observe(tenantId, userId, {
      mindState: inferMindState(message),
      capturedAt: new Date(nowMs).toISOString(),
    });
  }

  it('a cold kernel turn folds onto the PERSISTED prior, not AFFECTIVE_DEFAULT', async () => {
    const store = fakeStore();

    // Process A — build a persisted frustrated posterior across two turns.
    const accA = createAffectiveAccumulator({ store });
    accA.observe('t1', 'u1', {
      mindState: inferMindState('I am furious!!!'),
      capturedAt: ISO(1),
    });
    accA.observe('t1', 'u1', {
      mindState: inferMindState('this is so frustrating and broken!!!'),
      capturedAt: ISO(2),
    });
    await Promise.resolve();
    await Promise.resolve();

    // Process B — a fresh replica. A NEUTRAL turn on a COLD cache would, absent
    // hydration, fold onto AFFECTIVE_DEFAULT (frustration 0). With the kernel's
    // hydrate-then-observe it decays/merges onto the persisted frustration, so
    // turn count continues (3) and frustration stays elevated above default.
    const accB = createAffectiveAccumulator({ store });
    const pB = await kernelObserveAffective(
      accB,
      't1',
      'u1',
      'ok, please continue',
      AT(3),
    );
    expect(pB).not.toBeNull();
    expect(pB!.turns).toBe(3); // continued the persisted streak, not a fresh 1
    expect(pB!.state.frustration).toBeGreaterThan(
      AFFECTIVE_DEFAULT.frustration,
    );
  });

  it('cold-turn continuity is impossible WITHOUT hydration (guards the bug from regressing)', async () => {
    const store = fakeStore();
    const accA = createAffectiveAccumulator({ store });
    accA.observe('t1', 'u1', {
      mindState: inferMindState('I am furious!!!'),
      capturedAt: ISO(1),
    });
    await Promise.resolve();
    await Promise.resolve();

    // The BUGGY path: observe WITHOUT hydrating first on a cold cache.
    const accB = createAffectiveAccumulator({ store });
    const buggy = accB.observe('t1', 'u1', {
      mindState: inferMindState('ok, please continue'),
      capturedAt: ISO(3),
    });
    // Fresh turn count = 1 (lost the persisted streak) — this is exactly the
    // regression the hydrate-then-observe fix prevents.
    expect(buggy.turns).toBe(1);
  });
});
