/**
 * Stage 01 — ingest unit tests.
 *
 * Coverage:
 *   1. successful three-source ingest returns the bundle
 *   2. fetchTraces failure → traces:[] but other sources still load
 *   3. all three sources failing → empty bundle, no throw
 *   4. respects windowMs override
 */

import { describe, it, expect, vi } from 'vitest';
import { runIngestStage } from '../../stages/01-ingest.js';
import type { IngestSources } from '../../stages/01-ingest.js';
import type { StageLogger } from '../../stages/types.js';

function makeLogger(): StageLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function fakeSources(opts: {
  traces?: boolean;
  signals?: boolean;
  feedback?: boolean;
} = {}): IngestSources {
  return {
    async fetchTraces() {
      if (opts.traces === false) throw new Error('traces boom');
      return [
        {
          traceId: 't1',
          tenantId: 't-1',
          userId: 'u-1',
          threadId: 'th-1',
          summary: 'late rent reminder',
          capturedAt: new Date().toISOString(),
        },
      ];
    },
    async fetchImplicitSignals() {
      if (opts.signals === false) throw new Error('signals boom');
      return [
        {
          id: 'i1',
          traceId: 't1',
          agentActionId: null,
          tenantId: 't-1',
          userId: 'u-1',
          surface: 'admin-portal',
          signalType: 'copy',
          strength: 0.7,
          emittedAt: new Date().toISOString(),
        },
      ];
    },
    async fetchExplicitFeedback() {
      if (opts.feedback === false) throw new Error('feedback boom');
      return [
        {
          id: 'f1',
          tenantId: 't-1',
          userId: 'u-1',
          thoughtId: 't1',
          signal: 'thumbs-up',
          capturedAt: new Date().toISOString(),
        },
      ];
    },
  };
}

describe('runIngestStage', () => {
  it('returns a fully-populated bundle when every source succeeds', async () => {
    const out = await runIngestStage({
      sources: fakeSources(),
      logger: makeLogger(),
    });
    expect(out.traces.length).toBe(1);
    expect(out.implicitSignals.length).toBe(1);
    expect(out.explicitFeedback.length).toBe(1);
    expect(typeof out.windowStart).toBe('string');
    expect(typeof out.windowEnd).toBe('string');
  });

  it('degrades a single failing source to []', async () => {
    const out = await runIngestStage({
      sources: fakeSources({ traces: false }),
      logger: makeLogger(),
    });
    expect(out.traces).toEqual([]);
    expect(out.implicitSignals.length).toBe(1);
    expect(out.explicitFeedback.length).toBe(1);
  });

  it('degrades to fully-empty when every source fails', async () => {
    const out = await runIngestStage({
      sources: fakeSources({
        traces: false,
        signals: false,
        feedback: false,
      }),
      logger: makeLogger(),
    });
    expect(out.traces).toEqual([]);
    expect(out.implicitSignals).toEqual([]);
    expect(out.explicitFeedback).toEqual([]);
  });

  it('respects windowMs override', async () => {
    const calls: Array<{ since: Date; until: Date }> = [];
    const sources: IngestSources = {
      async fetchTraces(a) {
        calls.push({ since: a.since, until: a.until });
        return [];
      },
      async fetchImplicitSignals() {
        return [];
      },
      async fetchExplicitFeedback() {
        return [];
      },
    };
    await runIngestStage({
      sources,
      logger: makeLogger(),
      windowMs: 1000,
      now: () => new Date(10_000),
    });
    const c = calls[0]!;
    expect(c.since.getTime()).toBe(9_000);
    expect(c.until.getTime()).toBe(10_000);
  });
});
