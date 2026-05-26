import { describe, it, expect } from 'vitest';
import {
  runCrashDetectorSweep,
  isHeartbeatStale,
} from '../detector/crash-detector.js';
import { createInMemoryProgressRepository } from '../storage/progress-repository.js';
import type { WaveProgressEntry } from '../types.js';

describe('isHeartbeatStale', () => {
  it('returns true when heartbeat is older than threshold', () => {
    const entry = {
      heartbeat_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    } as WaveProgressEntry;
    const nowMs = Date.parse('2026-01-01T00:06:00Z');
    expect(isHeartbeatStale(entry, nowMs, 5 * 60_000)).toBe(true);
  });
  it('returns false when heartbeat is within threshold', () => {
    const entry = {
      heartbeat_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    } as WaveProgressEntry;
    const nowMs = Date.parse('2026-01-01T00:03:00Z');
    expect(isHeartbeatStale(entry, nowMs, 5 * 60_000)).toBe(false);
  });
  it('returns false for an unparseable heartbeat', () => {
    const entry = { heartbeat_at: 'not-a-date' } as WaveProgressEntry;
    expect(isHeartbeatStale(entry, Date.now(), 1000)).toBe(false);
  });
});

describe('runCrashDetectorSweep', () => {
  it('marks running waves with stale heartbeats as crashed', async () => {
    const progress = createInMemoryProgressRepository();
    const t0 = new Date('2026-01-01T00:00:00Z');
    await progress.append({
      wave_id: 'W1',
      agent_id: 'agent-a',
      status: 'running',
      checkpoint_label: 'audit_complete',
      audit_hash: 'h1',
      now: () => t0,
    });
    const t1 = new Date('2026-01-01T00:10:00Z');
    const result = await runCrashDetectorSweep({
      progress,
      now: () => t1,
      staleHeartbeatMs: 5 * 60_000,
      chainState: { previousHash: null },
    });
    expect(result.scanned).toBe(1);
    expect(result.crashed).toEqual(['W1']);
    const all = await progress.listForWave('W1');
    expect(all[all.length - 1]?.status).toBe('crashed');
  });

  it('does not mark completed waves as crashed', async () => {
    const progress = createInMemoryProgressRepository();
    const t0 = new Date('2026-01-01T00:00:00Z');
    await progress.append({
      wave_id: 'W2',
      agent_id: 'agent-b',
      status: 'completed',
      audit_hash: 'h1',
      now: () => t0,
    });
    const result = await runCrashDetectorSweep({
      progress,
      now: () => new Date('2026-01-01T00:30:00Z'),
      staleHeartbeatMs: 5 * 60_000,
      chainState: { previousHash: null },
    });
    expect(result.crashed).toEqual([]);
  });

  it('does not re-crash a wave that is already in crashed status', async () => {
    const progress = createInMemoryProgressRepository();
    const t0 = new Date('2026-01-01T00:00:00Z');
    await progress.append({
      wave_id: 'W3',
      agent_id: 'agent-c',
      status: 'running',
      audit_hash: 'h1',
      now: () => t0,
    });
    await progress.append({
      wave_id: 'W3',
      agent_id: 'agent-c',
      status: 'crashed',
      audit_hash: 'h2',
      now: () => new Date('2026-01-01T00:06:00Z'),
    });
    const result = await runCrashDetectorSweep({
      progress,
      now: () => new Date('2026-01-01T00:20:00Z'),
      staleHeartbeatMs: 5 * 60_000,
      chainState: { previousHash: null },
    });
    expect(result.crashed).toEqual([]);
  });

  it('chains the audit hash forward across sweeps', async () => {
    const progress = createInMemoryProgressRepository();
    await progress.append({
      wave_id: 'W4',
      agent_id: 'agent-d',
      status: 'running',
      audit_hash: 'seed',
      now: () => new Date('2026-01-01T00:00:00Z'),
    });
    const result = await runCrashDetectorSweep({
      progress,
      now: () => new Date('2026-01-01T00:10:00Z'),
      staleHeartbeatMs: 5 * 60_000,
      chainState: { previousHash: null },
    });
    expect(result.nextChainHash).toBeTypeOf('string');
    expect(result.nextChainHash?.length ?? 0).toBeGreaterThan(0);
  });
});
