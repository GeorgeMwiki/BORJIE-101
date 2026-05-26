import { describe, it, expect } from 'vitest';
import { buildContinuationPrompt } from '../builder/continuation-prompt-builder.js';

describe('buildContinuationPrompt', () => {
  it('embeds the wave id, original prompt, checkpoint label, and attempt count', () => {
    const prompt = buildContinuationPrompt({
      waveId: '18DD',
      originalPrompt: 'Do the thing',
      checkpoint: {
        id: 'a',
        wave_id: '18DD',
        agent_id: 'agent-1',
        tenant_id: null,
        status: 'crashed',
        checkpoint_seq: 3,
        checkpoint_label: 'spec_drafted',
        checkpoint_payload: { word_count: 1234 },
        heartbeat_at: '2026-01-01T00:00:00Z',
        attempt_number: 1,
        created_at: '2026-01-01T00:00:00Z',
        audit_hash: 'h',
      },
      attemptNumber: 2,
      maxAttempts: 3,
    });
    expect(prompt).toContain('18DD');
    expect(prompt).toContain('Do the thing');
    expect(prompt).toContain('spec_drafted');
    expect(prompt).toContain('1234');
    expect(prompt).toContain('attempt 2 of 3');
  });

  it('handles a null checkpoint cleanly', () => {
    const prompt = buildContinuationPrompt({
      waveId: 'X',
      originalPrompt: 'P',
      checkpoint: null,
      attemptNumber: 1,
      maxAttempts: 3,
    });
    expect(prompt).toContain('(none — start from scratch');
    expect(prompt).toContain('attempt 1 of 3');
  });

  it('includes the verification guidance block', () => {
    const prompt = buildContinuationPrompt({
      waveId: 'X',
      originalPrompt: 'P',
      checkpoint: null,
      attemptNumber: 1,
      maxAttempts: 3,
    });
    expect(prompt).toContain('git log --oneline');
    expect(prompt).toContain('git ls-files');
  });

  it('does not crash on a non-serialisable payload', () => {
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    const prompt = buildContinuationPrompt({
      waveId: 'X',
      originalPrompt: 'P',
      checkpoint: {
        id: 'a',
        wave_id: 'X',
        agent_id: 'a',
        tenant_id: null,
        status: 'crashed',
        checkpoint_seq: 1,
        checkpoint_label: 'audit_complete',
        checkpoint_payload: cycle,
        heartbeat_at: '2026-01-01T00:00:00Z',
        attempt_number: 1,
        created_at: '2026-01-01T00:00:00Z',
        audit_hash: 'h',
      },
      attemptNumber: 1,
      maxAttempts: 3,
    });
    expect(prompt).toContain('audit_complete');
  });
});
