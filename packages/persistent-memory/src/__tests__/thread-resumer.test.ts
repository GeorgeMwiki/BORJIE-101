import { describe, it, expect } from 'vitest';
import { composeResumptionBrief } from '../threads/thread-resumer.js';
import type { PendingThread, SessionMemory, ThreadSummary } from '../types.js';

const sampleSession: SessionMemory = {
  id: 'sm1',
  tenant_id: 't1',
  session_id: 's1',
  user_id: 'u1',
  thread_id: 'th1',
  summary_md: 'Owner planning Q3 brief; pending FX exposure number.',
  active_decisions: [],
  pending_questions: [],
  last_turn_at: '2026-05-25T10:00:00Z',
  expires_at: '2026-06-25T10:00:00Z',
  audit_hash: 'pm-chain-aaaaaaaa',
};

const sampleSummary: ThreadSummary = {
  id: 'ts1',
  tenant_id: 't1',
  thread_id: 'th1',
  summary_md: 'Owner reviewed three quarterly draft outlines.',
  summarised_turn_range: [1, 12],
  token_count_original: 230_000,
  token_count_summary: 4_000,
  generated_at: '2026-05-25T09:30:00Z',
  audit_hash: 'pm-chain-bbbbbbbb',
};

const samplePending: PendingThread = {
  id: 'pt1',
  tenant_id: 't1',
  user_id: 'u1',
  thread_id: 'th1',
  pending_kind: 'decision',
  payload: { question: 'Confirm FX exposure number?' },
  created_at: '2026-05-25T10:00:00Z',
  resolved_at: null,
  audit_hash: 'pm-chain-cccccccc',
};

describe('thread-resumer', () => {
  it('produces a cold-start greeting when nothing exists', () => {
    const brief = composeResumptionBrief({
      session: null,
      latest_summary: null,
      unresolved_pending: [],
      user_display_name: 'Bwana George',
    });
    expect(brief.is_cold_start).toBe(true);
    expect(brief.greeting_md).toContain('Welcome');
    expect(brief.pending_count).toBe(0);
  });

  it('produces a welcome-back greeting with full context', () => {
    const brief = composeResumptionBrief({
      session: sampleSession,
      latest_summary: sampleSummary,
      unresolved_pending: [samplePending],
      user_display_name: 'Bwana George',
    });
    expect(brief.is_cold_start).toBe(false);
    expect(brief.greeting_md).toContain('Welcome back');
    expect(brief.context_md).toContain('Session summary');
    expect(brief.context_md).toContain('Earlier thread summary');
    expect(brief.context_md).toContain('Pending');
    expect(brief.pending_count).toBe(1);
  });

  it('omits empty sections gracefully', () => {
    const brief = composeResumptionBrief({
      session: sampleSession,
      latest_summary: null,
      unresolved_pending: [],
      user_display_name: 'Bwana George',
    });
    expect(brief.is_cold_start).toBe(false);
    expect(brief.context_md).toContain('Session summary');
    expect(brief.context_md).not.toContain('Pending');
    expect(brief.pending_count).toBe(0);
  });
});
