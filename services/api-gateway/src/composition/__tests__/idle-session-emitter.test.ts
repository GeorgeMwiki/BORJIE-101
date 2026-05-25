/**
 * Tests for `createIdleSessionEmitter` — periodic idle-session detector
 * that writes a Reflexion buffer entry per idle (tenant, user, session)
 * tuple discovered in the activity source.
 *
 * Coverage:
 *   1. Idle session → reflexion is written and remembered.
 *   2. Active session (recent activity) → skipped.
 *   3. Tuple emitted once already → not re-emitted next tick.
 *   4. Reflexion-writer throws → swallowed; emitter never throws.
 *   5. source.listRecent throws → swallowed; returns 0.
 *   6. start()/stop() lifecycle is idempotent.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createIdleSessionEmitter,
  type ActiveSessionSource,
  type ActiveSessionTuple,
  type ReflexionWriterPort,
} from '../idle-session-emitter.js';

function fakeWriter(): ReflexionWriterPort & {
  readonly calls: Array<{ tenantId: string; userId: string; sessionId: string }>;
} {
  const calls: Array<{ tenantId: string; userId: string; sessionId: string }> = [];
  return {
    calls,
    async record(args) {
      calls.push({
        tenantId: args.tenantId,
        userId: args.userId,
        sessionId: args.sessionId,
      });
      return { id: `refl-${calls.length}` };
    },
  };
}

function fakeSource(
  tuples: ReadonlyArray<ActiveSessionTuple>,
): ActiveSessionSource {
  return {
    listRecent: vi.fn(async () => tuples),
  };
}

const NOW = 1_700_000_000_000;
const FIVE_MIN_MS = 5 * 60 * 1000;

describe('createIdleSessionEmitter', () => {
  it('writes a reflexion when a session is idle ≥ 5 minutes', async () => {
    const writer = fakeWriter();
    const source = fakeSource([
      {
        tenantId: 't-1',
        userId: 'u-1',
        sessionId: 's-1',
        lastActivityAt: NOW - FIVE_MIN_MS - 1_000,
      },
    ]);
    const emitter = createIdleSessionEmitter({
      source,
      reflexionWriter: writer,
      now: () => NOW,
    });
    const emittedCount = await emitter.tick();
    expect(emittedCount).toBe(1);
    expect(writer.calls).toEqual([
      { tenantId: 't-1', userId: 'u-1', sessionId: 's-1' },
    ]);
  });

  it('skips sessions whose last activity is within the idle window', async () => {
    const writer = fakeWriter();
    const source = fakeSource([
      {
        tenantId: 't-1',
        userId: 'u-1',
        sessionId: 's-1',
        lastActivityAt: NOW - 60_000, // 1 min ago
      },
    ]);
    const emitter = createIdleSessionEmitter({
      source,
      reflexionWriter: writer,
      now: () => NOW,
    });
    const emittedCount = await emitter.tick();
    expect(emittedCount).toBe(0);
    expect(writer.calls).toHaveLength(0);
  });

  it('does not double-emit when the same idle session shows up twice', async () => {
    const writer = fakeWriter();
    const source = fakeSource([
      {
        tenantId: 't-1',
        userId: 'u-1',
        sessionId: 's-1',
        lastActivityAt: NOW - FIVE_MIN_MS - 1_000,
      },
    ]);
    const emitter = createIdleSessionEmitter({
      source,
      reflexionWriter: writer,
      now: () => NOW,
    });
    await emitter.tick();
    await emitter.tick();
    expect(writer.calls).toHaveLength(1);
  });

  it('swallows writer.record throws and never crashes the tick', async () => {
    const source = fakeSource([
      {
        tenantId: 't-1',
        userId: 'u-1',
        sessionId: 's-1',
        lastActivityAt: NOW - FIVE_MIN_MS - 1_000,
      },
    ]);
    const writer: ReflexionWriterPort = {
      async record() {
        throw new Error('db down');
      },
    };
    const emitter = createIdleSessionEmitter({
      source,
      reflexionWriter: writer,
      now: () => NOW,
    });
    await expect(emitter.tick()).resolves.toBe(0);
  });

  it('swallows source.listRecent throws and returns 0', async () => {
    const writer = fakeWriter();
    const source: ActiveSessionSource = {
      async listRecent() {
        throw new Error('source down');
      },
    };
    const warn = vi.fn();
    const emitter = createIdleSessionEmitter({
      source,
      reflexionWriter: writer,
      now: () => NOW,
      logger: { warn },
    });
    const out = await emitter.tick();
    expect(out).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(writer.calls).toHaveLength(0);
  });

  it('start()/stop() are idempotent', () => {
    const writer = fakeWriter();
    const source = fakeSource([]);
    const emitter = createIdleSessionEmitter({
      source,
      reflexionWriter: writer,
      now: () => NOW,
      intervalMs: 1_000_000, // unreachable in this test's lifetime
    });
    emitter.start();
    emitter.start(); // second start is a no-op
    emitter.stop();
    emitter.stop(); // second stop is a no-op
    // No throws ⇒ pass.
    expect(true).toBe(true);
  });

  it('rejects construction when source or writer is missing', () => {
    expect(() =>
      createIdleSessionEmitter({
        // @ts-expect-error — missing source
        source: undefined,
        reflexionWriter: fakeWriter(),
      }),
    ).toThrow(/source is required/);
    expect(() =>
      createIdleSessionEmitter({
        source: fakeSource([]),
        // @ts-expect-error — missing writer
        reflexionWriter: undefined,
      }),
    ).toThrow(/reflexionWriter is required/);
  });

  it('skips malformed tuples (empty tenant/user/session)', async () => {
    const writer = fakeWriter();
    const source = fakeSource([
      {
        tenantId: '',
        userId: 'u-1',
        sessionId: 's-1',
        lastActivityAt: NOW - FIVE_MIN_MS - 1_000,
      },
      {
        tenantId: 't-1',
        userId: '',
        sessionId: 's-2',
        lastActivityAt: NOW - FIVE_MIN_MS - 1_000,
      },
      {
        tenantId: 't-1',
        userId: 'u-1',
        sessionId: 's-3',
        lastActivityAt: NOW - FIVE_MIN_MS - 1_000,
      },
    ]);
    const emitter = createIdleSessionEmitter({
      source,
      reflexionWriter: writer,
      now: () => NOW,
    });
    const out = await emitter.tick();
    expect(out).toBe(1);
    expect(writer.calls).toEqual([
      { tenantId: 't-1', userId: 'u-1', sessionId: 's-3' },
    ]);
  });
});
