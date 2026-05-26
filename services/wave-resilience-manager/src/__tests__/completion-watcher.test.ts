import { describe, it, expect } from 'vitest';
import {
  signalCompletion,
  canComplete,
} from '../watcher/completion-watcher.js';
import { createInMemoryProgressRepository } from '../storage/progress-repository.js';
import { createInMemoryAttemptsRepository } from '../storage/attempts-repository.js';

describe('canComplete', () => {
  it('rejects when there is no history', () => {
    const r = canComplete([]);
    expect(r.ok).toBe(false);
  });
  it('rejects when already completed', () => {
    const r = canComplete([
      {
        id: 'a',
        wave_id: 'W',
        agent_id: 'a',
        tenant_id: null,
        status: 'completed',
        checkpoint_seq: 1,
        checkpoint_label: 'pushed',
        checkpoint_payload: null,
        heartbeat_at: '2026-01-01T00:00:00Z',
        attempt_number: 1,
        created_at: '2026-01-01T00:00:00Z',
        audit_hash: 'h',
      },
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('already_completed');
  });
  it('accepts when last label is pushed', () => {
    const r = canComplete([
      {
        id: 'a',
        wave_id: 'W',
        agent_id: 'a',
        tenant_id: null,
        status: 'running',
        checkpoint_seq: 5,
        checkpoint_label: 'pushed',
        checkpoint_payload: null,
        heartbeat_at: '2026-01-01T00:00:00Z',
        attempt_number: 1,
        created_at: '2026-01-01T00:00:00Z',
        audit_hash: 'h',
      },
    ]);
    expect(r.ok).toBe(true);
  });
});

describe('signalCompletion', () => {
  it('appends a completed row + marks the attempt outcome', async () => {
    const progress = createInMemoryProgressRepository();
    const attempts = createInMemoryAttemptsRepository();
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'running',
      checkpoint_label: 'pushed',
      attempt_number: 2,
      audit_hash: 'h1',
    });
    await attempts.record({
      wave_id: 'W',
      attempt_number: 2,
      original_dispatch_at: '2026-01-01T00:00:00Z',
      crashed_at: '2026-01-01T00:05:00Z',
      audit_hash: 'h-attempt',
    });
    const result = await signalCompletion(
      {
        progress,
        attempts,
        chainState: { previousHash: null },
        now: () => new Date('2026-01-01T00:30:00Z'),
      },
      { waveId: 'W' },
    );
    expect(result.completed).toBe(true);
    const all = await progress.listForWave('W');
    expect(all[all.length - 1]?.status).toBe('completed');
    const attemptRows = await attempts.listForWave('W');
    expect(attemptRows[0]?.outcome).toBe('completed');
  });

  it('refuses to complete when last label is not pushed', async () => {
    const progress = createInMemoryProgressRepository();
    const attempts = createInMemoryAttemptsRepository();
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'running',
      checkpoint_label: 'committed',
      audit_hash: 'h',
    });
    const result = await signalCompletion(
      {
        progress,
        attempts,
        chainState: { previousHash: null },
      },
      { waveId: 'W' },
    );
    expect(result.completed).toBe(false);
    expect(result.reason).toBe('last_label_not_pushed');
  });
});
