import { describe, it, expect } from 'vitest';
import {
  decideRevival,
  selectLastCheckpoint,
} from '../decider/revival-decider.js';
import { createInMemoryProgressRepository } from '../storage/progress-repository.js';

describe('selectLastCheckpoint', () => {
  it('returns the last row with a non-null checkpoint_label', () => {
    const result = selectLastCheckpoint([
      {
        id: 'a',
        wave_id: 'W',
        agent_id: 'a',
        tenant_id: null,
        status: 'running',
        checkpoint_seq: 1,
        checkpoint_label: 'audit_complete',
        checkpoint_payload: null,
        heartbeat_at: '2026-01-01T00:00:00Z',
        attempt_number: 1,
        created_at: '2026-01-01T00:00:00Z',
        audit_hash: 'h1',
      },
      {
        id: 'b',
        wave_id: 'W',
        agent_id: 'a',
        tenant_id: null,
        status: 'crashed',
        checkpoint_seq: 2,
        checkpoint_label: null,
        checkpoint_payload: null,
        heartbeat_at: '2026-01-01T00:10:00Z',
        attempt_number: 1,
        created_at: '2026-01-01T00:10:00Z',
        audit_hash: 'h2',
      },
    ]);
    expect(result?.checkpoint_label).toBe('audit_complete');
  });
  it('returns null when there is no checkpointed row', () => {
    expect(selectLastCheckpoint([])).toBeNull();
  });
});

describe('decideRevival', () => {
  it('refuses revival on no history', async () => {
    const progress = createInMemoryProgressRepository();
    const d = await decideRevival(
      { progress },
      { waveId: 'unknown', originalPrompt: 'p' },
    );
    expect(d.should_revive).toBe(false);
    expect(d.reason).toBe('no_history');
  });

  it('refuses revival when no checkpoint exists', async () => {
    const progress = createInMemoryProgressRepository();
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: null,
      audit_hash: 'h',
    });
    const d = await decideRevival(
      { progress },
      { waveId: 'W', originalPrompt: 'p' },
    );
    expect(d.should_revive).toBe(false);
    expect(d.reason).toBe('no_checkpoint');
  });

  it('approves revival when checkpoint exists + attempts under cap', async () => {
    const progress = createInMemoryProgressRepository();
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'running',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h1',
    });
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: 'spec_drafted',
      attempt_number: 1,
      audit_hash: 'h2',
    });
    const d = await decideRevival(
      { progress },
      { waveId: 'W', originalPrompt: 'p' },
    );
    expect(d.should_revive).toBe(true);
    expect(d.attempt_number).toBe(2);
    expect(d.last_completed_checkpoint).toBe('spec_drafted');
  });

  it('caps revival at 3 attempts (max_attempts_reached)', async () => {
    const progress = createInMemoryProgressRepository();
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: 'spec_drafted',
      attempt_number: 3,
      audit_hash: 'h',
    });
    const d = await decideRevival(
      { progress, maxAttempts: 3 },
      { waveId: 'W', originalPrompt: 'p' },
    );
    expect(d.should_revive).toBe(false);
    expect(d.reason).toBe('max_attempts_reached');
  });
});
