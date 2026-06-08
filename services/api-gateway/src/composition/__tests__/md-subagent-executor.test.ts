/**
 * md-subagent-executor — the runner that unblocks the agent-teams dead-end.
 *
 * These tests pin the executor's orchestration contract against a stubbed
 * repository + brain (no Postgres, no SDK):
 *   - claims pending members and runs each through the injected brain;
 *   - completes with a structured, evidence-bearing result;
 *   - records a failure (never fabricates) when a member's brain call throws;
 *   - is a no-op when nothing is pending (idempotent / race-safe);
 *   - synthesises a self-citation so the result evidence chain is never empty;
 *   - the brain resolver honest-degrades to null when no brain is wired.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  runSubagentTeam,
  type SubagentBrainPort,
  type SubagentBrainResult,
} from '../md-subagent-executor';
import type { ClaimedSubagentMember } from '../md-agentic-repository';
import { resolveSubagentBrain } from '../md-subagent-brain-resolver';

const TENANT = 'tenant-1';
const TEAM = '11111111-1111-1111-1111-111111111111';

function member(
  over: Partial<ClaimedSubagentMember> = {},
): ClaimedSubagentMember {
  return {
    id: over.id ?? 'member-1',
    teamRunId: TEAM,
    role: over.role ?? 'explorer',
    brief: over.brief ?? 'Survey the north pit licence status.',
    teamBrief: over.teamBrief ?? 'Draft a Q3 readiness assessment.',
    allowedTools: over.allowedTools ?? [],
    tokenBudget: over.tokenBudget ?? 8000,
    aggregation: over.aggregation ?? 'merge_all',
    originSessionId: over.originSessionId ?? null,
  };
}

/** A repo stub recording every finalize call; claim returns the seeded list. */
function makeRepoStub(claimed: readonly ClaimedSubagentMember[]) {
  const completeSubagentRun = vi.fn().mockResolvedValue(true);
  const failSubagentRun = vi.fn().mockResolvedValue(true);
  const claimPendingTeamMembers = vi.fn().mockResolvedValue(claimed);
  return {
    repo: {
      claimPendingTeamMembers,
      completeSubagentRun,
      failSubagentRun,
    } as unknown as Parameters<typeof runSubagentTeam>[0]['repo'],
    claimPendingTeamMembers,
    completeSubagentRun,
    failSubagentRun,
  };
}

function brainReturning(
  result: SubagentBrainResult | ((q: string) => SubagentBrainResult),
): SubagentBrainPort {
  return {
    async run(req) {
      return typeof result === 'function' ? result(req.question) : result;
    },
  };
}

describe('runSubagentTeam — happy path', () => {
  it('claims, runs through the brain, and completes each member', async () => {
    const members = [
      member({ id: 'm-1', role: 'explorer' }),
      member({ id: 'm-2', role: 'reviewer' }),
    ];
    const { repo, completeSubagentRun, claimPendingTeamMembers } =
      makeRepoStub(members);
    const brain = brainReturning({
      text: 'north pit licence is current through Q4.',
      evidence: [{ id: 'lic-1', label: 'Licence record', source: 'lmbm:lic-1' }],
      confidence: 0.8,
    });

    const res = await runSubagentTeam({
      repo,
      brain,
      tenantId: TENANT,
      teamRunId: TEAM,
    });

    expect(claimPendingTeamMembers).toHaveBeenCalledWith(TENANT, TEAM);
    expect(res).toEqual({ teamRunId: TEAM, claimed: 2, completed: 2, failed: 0 });
    expect(completeSubagentRun).toHaveBeenCalledTimes(2);

    // result shape: role + text + non-empty evidence + confidence.
    const [, , firstResult] = completeSubagentRun.mock.calls[0];
    expect(firstResult.role).toBe('explorer');
    expect(firstResult.text).toContain('north pit');
    expect(firstResult.evidence).toHaveLength(1);
    expect(firstResult.confidence).toBe(0.8);
  });

  it('synthesises a self-citation when the brain returns no evidence', async () => {
    const { repo, completeSubagentRun } = makeRepoStub([member({ id: 'm-x' })]);
    const brain = brainReturning({ text: 'answer with no citations' });

    await runSubagentTeam({ repo, brain, tenantId: TENANT, teamRunId: TEAM });

    const [, , result] = completeSubagentRun.mock.calls[0];
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].source).toBe('md_subagent_runs:m-x');
    expect(result.confidence).toBe(0.5); // default when brain omits one
  });
});

describe('runSubagentTeam — failure + honest-degrade', () => {
  it('records a failure (never fabricates) when the brain throws', async () => {
    const { repo, completeSubagentRun, failSubagentRun } = makeRepoStub([
      member({ id: 'm-fail' }),
    ]);
    const brain: SubagentBrainPort = {
      async run() {
        throw new Error('provider 529 overloaded');
      },
    };

    const res = await runSubagentTeam({
      repo,
      brain,
      tenantId: TENANT,
      teamRunId: TEAM,
    });

    expect(res).toEqual({ teamRunId: TEAM, claimed: 1, completed: 0, failed: 1 });
    expect(completeSubagentRun).not.toHaveBeenCalled();
    expect(failSubagentRun).toHaveBeenCalledWith(
      TENANT,
      'm-fail',
      'provider 529 overloaded',
    );
  });

  it('finalizes members independently — one failure does not block the rest', async () => {
    const { repo, completeSubagentRun, failSubagentRun } = makeRepoStub([
      member({ id: 'm-ok' }),
      member({ id: 'm-bad' }),
    ]);
    const brain: SubagentBrainPort = {
      async run(req) {
        if (req.question.includes('boom')) throw new Error('boom');
        return { text: 'fine' };
      },
    };
    // distinguish the two members by their brief.
    const members = [
      member({ id: 'm-ok', brief: 'ok brief' }),
      member({ id: 'm-bad', brief: 'boom brief' }),
    ];
    (repo.claimPendingTeamMembers as ReturnType<typeof vi.fn>).mockResolvedValue(
      members,
    );

    const res = await runSubagentTeam({
      repo,
      brain,
      tenantId: TENANT,
      teamRunId: TEAM,
    });

    expect(res.completed).toBe(1);
    expect(res.failed).toBe(1);
    expect(completeSubagentRun).toHaveBeenCalledTimes(1);
    expect(failSubagentRun).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when nothing is pending (idempotent / race-safe)', async () => {
    const { repo, completeSubagentRun, failSubagentRun } = makeRepoStub([]);
    const brain = brainReturning({ text: 'unused' });

    const res = await runSubagentTeam({
      repo,
      brain,
      tenantId: TENANT,
      teamRunId: TEAM,
    });

    expect(res).toEqual({ teamRunId: TEAM, claimed: 0, completed: 0, failed: 0 });
    expect(completeSubagentRun).not.toHaveBeenCalled();
    expect(failSubagentRun).not.toHaveBeenCalled();
  });

  it('treats a stale-running row (complete returns false) as not-completed', async () => {
    const { repo, completeSubagentRun, failSubagentRun } = makeRepoStub([
      member({ id: 'm-stale' }),
    ]);
    (completeSubagentRun as ReturnType<typeof vi.fn>).mockResolvedValue(false);
    const brain = brainReturning({ text: 'done' });

    const res = await runSubagentTeam({
      repo,
      brain,
      tenantId: TENANT,
      teamRunId: TEAM,
    });

    expect(res.completed).toBe(0);
    expect(res.failed).toBe(1);
    expect(failSubagentRun).not.toHaveBeenCalled();
  });
});

describe('resolveSubagentBrain — honest-degrade', () => {
  it('returns null when there is no service registry on the context', () => {
    expect(resolveSubagentBrain(undefined, TENANT)).toBeNull();
    expect(resolveSubagentBrain({}, TENANT)).toBeNull();
  });

  it('returns null when the tenant agent-stack brain is null', () => {
    const services = {
      agentStack: {
        getAgentStackForTenant: () => ({ brain: null }),
      },
    };
    expect(resolveSubagentBrain(services, TENANT)).toBeNull();
  });

  it('adapts an orchestrator brain into the SubagentBrainPort shape', async () => {
    const call = vi
      .fn()
      .mockResolvedValue({ text: 'orchestrator answer' });
    const services = {
      agentStack: {
        getAgentStackForTenant: () => ({ brain: { call } }),
      },
    };

    const port = resolveSubagentBrain(services, TENANT);
    expect(port).not.toBeNull();

    const out = await port!.run({
      systemPrompt: 'sys',
      question: 'q',
      maxTokens: 1024,
    });
    expect(out.text).toBe('orchestrator answer');
    expect(call).toHaveBeenCalledWith({
      system: 'sys',
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 1024,
      temperature: 0.2,
    });
  });
});
