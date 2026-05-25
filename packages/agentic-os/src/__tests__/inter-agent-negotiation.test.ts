import { describe, expect, it } from 'vitest';
import {
  negotiateConflict,
  type JudgePort,
} from '../inter-agent-negotiation/index.js';
import { makeFakeWorkflowEngine } from './test-helpers.js';
import type { AgentPosition, JudgeVerdict } from '../types.js';

function makePos(
  agentId: string,
  proposal: string,
  confidence = 0.7,
): AgentPosition {
  return {
    agentId,
    proposal,
    rationale: `${agentId} thinks: ${proposal}`,
    confidence,
  };
}

function makeJudge(
  id: string,
  pickAgentId: string | null,
): JudgePort {
  return {
    id,
    async vote() {
      const verdict: JudgeVerdict = {
        judgeId: id,
        winnerAgentId: pickAgentId,
        rubricScores: { 'evidence-grounding': 0.8 },
        rationale: `${id} picks ${pickAgentId ?? 'none'}`,
      };
      return verdict;
    },
  };
}

describe('inter-agent-negotiation / negotiateConflict', () => {
  it('returns the majority winner when judges agree', async () => {
    const result = await negotiateConflict({
      tenantId: 't-1',
      conflictId: 'c-1',
      positions: [
        makePos('agent-a', 'option A'),
        makePos('agent-b', 'option B'),
      ],
      judges: [
        makeJudge('j1', 'agent-a'),
        makeJudge('j2', 'agent-a'),
        makeJudge('j3', 'agent-b'),
      ],
    });
    expect(result.winnerAgentId).toBe('agent-a');
    expect(result.outcome).toBe('resolved');
    expect(result.verdicts.length).toBe(3);
  });

  it('escalates when judges tie and no workflow engine wired', async () => {
    const result = await negotiateConflict({
      tenantId: 't-1',
      conflictId: 'c-2',
      positions: [
        makePos('agent-a', 'option A', 0.7),
        makePos('agent-b', 'option B', 0.7),
      ],
      judges: [
        makeJudge('j1', 'agent-a'),
        makeJudge('j2', 'agent-b'),
      ],
    });
    expect(result.outcome).toBe('escalated');
    expect(result.winnerAgentId).toBeNull();
    expect(result.escalatedRunId).toBeUndefined();
  });

  it('opens a workflow run when tie escalates with engine wired', async () => {
    const wfe = makeFakeWorkflowEngine();
    const result = await negotiateConflict({
      tenantId: 't-1',
      conflictId: 'c-3',
      positions: [
        makePos('agent-a', 'option A', 0.7),
        makePos('agent-b', 'option B', 0.7),
      ],
      judges: [
        makeJudge('j1', 'agent-a'),
        makeJudge('j2', 'agent-b'),
      ],
      workflowEngine: wfe,
    });
    expect(result.outcome).toBe('escalated');
    expect(result.escalatedRunId).toBe('run-1');
  });

  it('breaks tie on confidence when spread is meaningful', async () => {
    const result = await negotiateConflict({
      tenantId: 't-1',
      conflictId: 'c-4',
      positions: [
        makePos('agent-a', 'option A', 0.95),
        makePos('agent-b', 'option B', 0.6),
      ],
      judges: [
        makeJudge('j1', 'agent-a'),
        makeJudge('j2', 'agent-b'),
      ],
    });
    expect(result.winnerAgentId).toBe('agent-a');
    expect(result.outcome).toBe('resolved');
  });

  it('records loser positions in the outcome', async () => {
    const result = await negotiateConflict({
      tenantId: 't-1',
      conflictId: 'c-5',
      positions: [
        makePos('agent-a', 'A'),
        makePos('agent-b', 'B'),
      ],
      judges: [makeJudge('j1', 'agent-a')],
    });
    const loserAgents = result.positions.filter(
      (p) => p.agentId !== result.winnerAgentId,
    );
    expect(loserAgents.length).toBe(1);
    expect(loserAgents[0]?.agentId).toBe('agent-b');
  });

  it('rejects when fewer than 2 positions', async () => {
    await expect(
      negotiateConflict({
        tenantId: 't-1',
        conflictId: 'c-6',
        positions: [makePos('agent-a', 'A')],
        judges: [makeJudge('j1', 'agent-a')],
      }),
    ).rejects.toThrow();
  });

  it('rejects when no judges', async () => {
    await expect(
      negotiateConflict({
        tenantId: 't-1',
        conflictId: 'c-7',
        positions: [makePos('agent-a', 'A'), makePos('agent-b', 'B')],
        judges: [],
      }),
    ).rejects.toThrow();
  });
});
