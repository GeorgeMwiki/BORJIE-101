import { describe, it, expect } from 'vitest';
import { resumeWave, type AgentDispatcher } from '../resumer/agent-resumer.js';
import { createInMemoryProgressRepository } from '../storage/progress-repository.js';
import { createInMemoryAttemptsRepository } from '../storage/attempts-repository.js';

function recordingDispatcher(): AgentDispatcher & {
  readonly calls: Array<{ waveId: string; attempt: number; prompt: string }>;
} {
  const calls: Array<{ waveId: string; attempt: number; prompt: string }> = [];
  return {
    calls,
    async dispatch({ waveId, prompt, attemptNumber }) {
      calls.push({ waveId, attempt: attemptNumber, prompt });
      return { agent_id: `agent-${calls.length}` };
    },
  };
}

describe('resumeWave', () => {
  it('dispatches a continuation agent and records the attempt', async () => {
    const progress = createInMemoryProgressRepository();
    const attempts = createInMemoryAttemptsRepository();
    const dispatcher = recordingDispatcher();
    await progress.append({
      wave_id: 'W',
      agent_id: 'agent-orig',
      status: 'running',
      checkpoint_label: 'committed',
      checkpoint_payload: { commit_hashes: ['abc'] },
      attempt_number: 1,
      audit_hash: 'h1',
    });
    await progress.append({
      wave_id: 'W',
      agent_id: 'agent-orig',
      status: 'crashed',
      checkpoint_label: 'committed',
      checkpoint_payload: { commit_hashes: ['abc'] },
      attempt_number: 1,
      audit_hash: 'h2',
    });
    const r = await resumeWave(
      {
        progress,
        attempts,
        dispatcher,
        chainState: { previousHash: null },
      },
      { waveId: 'W', originalPrompt: 'do the thing' },
    );
    expect(r.resumed).toBe(true);
    expect(r.newAgentId).toBe('agent-1');
    expect(dispatcher.calls.length).toBe(1);
    expect(dispatcher.calls[0]?.attempt).toBe(2);
    expect(dispatcher.calls[0]?.prompt).toContain('committed');
    const attemptRows = await attempts.listForWave('W');
    expect(attemptRows.length).toBe(1);
    expect(attemptRows[0]?.attempt_number).toBe(2);
  });

  it('escalates to unrecoverable on 3-attempt cap', async () => {
    const progress = createInMemoryProgressRepository();
    const attempts = createInMemoryAttemptsRepository();
    const dispatcher = recordingDispatcher();
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: 'spec_drafted',
      attempt_number: 3,
      audit_hash: 'h',
    });
    const r = await resumeWave(
      {
        progress,
        attempts,
        dispatcher,
        chainState: { previousHash: null },
        maxAttempts: 3,
      },
      { waveId: 'W', originalPrompt: 'p' },
    );
    expect(r.resumed).toBe(false);
    expect(dispatcher.calls.length).toBe(0);
    const history = await progress.listForWave('W');
    expect(history[history.length - 1]?.status).toBe('unrecoverable');
  });

  it('refuses to resume waves with no checkpoint', async () => {
    const progress = createInMemoryProgressRepository();
    const attempts = createInMemoryAttemptsRepository();
    const dispatcher = recordingDispatcher();
    await progress.append({
      wave_id: 'W',
      agent_id: 'a',
      status: 'crashed',
      checkpoint_label: null,
      attempt_number: 1,
      audit_hash: 'h',
    });
    const r = await resumeWave(
      {
        progress,
        attempts,
        dispatcher,
        chainState: { previousHash: null },
      },
      { waveId: 'W', originalPrompt: 'p' },
    );
    expect(r.resumed).toBe(false);
    expect(r.decision.reason).toBe('no_checkpoint');
    expect(dispatcher.calls.length).toBe(0);
  });
});
