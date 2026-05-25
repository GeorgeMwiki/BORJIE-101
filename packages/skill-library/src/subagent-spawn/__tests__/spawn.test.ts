import { describe, expect, it } from 'vitest';
import {
  spawnSubAgent,
  validateSubAgentSpec,
  resolveSpec,
  InMemorySubAgentRunner,
  InMemoryWorktreeManager,
} from '../index.js';
import type { SubAgentSpec, SubAgentSpecMap, WorktreeIsolation } from '../index.js';

function basicSpec(overrides: Partial<SubAgentSpec> = {}): SubAgentSpec {
  return {
    name: 'researcher',
    description: 'Investigates a topic and returns notes.',
    allowed_tools: ['Read', 'Grep'],
    system_prompt: 'You are a research subagent. Return concise notes.',
    max_turns: 5,
    isolated_context: true,
    ...overrides,
  };
}

describe('validateSubAgentSpec', () => {
  it('accepts a well-formed spec', () => {
    expect(() => validateSubAgentSpec(basicSpec())).not.toThrow();
  });

  it('rejects a spec without isolated_context: true (false cast)', () => {
    const bad = { ...basicSpec(), isolated_context: false as unknown as true };
    expect(() => validateSubAgentSpec(bad)).toThrow(/isolated_context: true/);
  });

  it('rejects a spec with empty system_prompt', () => {
    expect(() => validateSubAgentSpec(basicSpec({ system_prompt: '   ' }))).toThrow(
      /system_prompt cannot be empty/
    );
  });

  it('rejects a spec with zero max_turns', () => {
    expect(() => validateSubAgentSpec(basicSpec({ max_turns: 0 }))).toThrow(
      /max_turns must be a positive finite number/
    );
  });

  it('rejects a spec with negative max_turns', () => {
    expect(() => validateSubAgentSpec(basicSpec({ max_turns: -3 }))).toThrow(/max_turns/);
  });

  it('rejects a spec with Infinity max_turns', () => {
    expect(() => validateSubAgentSpec(basicSpec({ max_turns: Infinity }))).toThrow(/max_turns/);
  });

  it('rejects empty allowed_tools', () => {
    expect(() => validateSubAgentSpec(basicSpec({ allowed_tools: [] }))).toThrow(
      /allowed_tools cannot be empty/
    );
  });

  it('rejects allowed_tools containing Agent (no nested subagents)', () => {
    expect(() =>
      validateSubAgentSpec(basicSpec({ allowed_tools: ['Read', 'Agent'] }))
    ).toThrow(/nested subagents are forbidden/);
  });

  it('rejects allowed_tools containing Task (legacy alias for Agent)', () => {
    expect(() =>
      validateSubAgentSpec(basicSpec({ allowed_tools: ['Read', 'Task'] }))
    ).toThrow(/nested subagents are forbidden/);
  });

  it('rejects a malformed name', () => {
    expect(() => validateSubAgentSpec(basicSpec({ name: '!!!bad' }))).toThrow(
      /spec name/
    );
  });
});

describe('resolveSpec', () => {
  it('returns the named spec from a SpecMap', () => {
    const map: SubAgentSpecMap = { researcher: basicSpec() };
    const found = resolveSpec(map, 'researcher');
    expect(found?.name).toBe('researcher');
  });

  it('returns null for an unknown name', () => {
    const map: SubAgentSpecMap = { researcher: basicSpec() };
    expect(resolveSpec(map, 'drafter')).toBeNull();
  });
});

describe('spawnSubAgent — isolation contract', () => {
  it('runs a subagent with only the supplied prompt + structured_input', async () => {
    const runner = new InMemorySubAgentRunner({
      outputs: { researcher: () => ({ notes: 'three useful sources found' }) },
    });
    const res = await spawnSubAgent<{ notes: string }>({
      spec: basicSpec(),
      input: { prompt: 'Research tax incentives', correlation_id: 'corr-1' },
      runner,
    });
    expect(res.status).toBe('ok');
    expect(res.output.notes).toBe('three useful sources found');
    // The runner saw zero parent history — isolation contract enforced.
    expect(runner.invocations[0]?.parent_history_seen).toEqual([]);
    expect(runner.invocations[0]?.system_prompt).toBe(basicSpec().system_prompt);
    expect(runner.invocations[0]?.prompt).toBe('Research tax incentives');
  });

  it('returns only the typed result; no transcript leaks to the parent', async () => {
    const runner = new InMemorySubAgentRunner({
      outputs: { researcher: () => ({ notes: 'private' }) },
    });
    const res = await spawnSubAgent<{ notes: string }>({
      spec: basicSpec(),
      input: { prompt: 'p', correlation_id: 'c' },
      runner,
    });
    expect(Object.keys(res).sort()).toEqual(
      [
        'correlation_id',
        'cost_usd',
        'name',
        'output',
        'status',
        'turns_used',
      ].sort()
    );
    // 'history', 'transcript', 'messages' MUST NOT appear.
    expect(res).not.toHaveProperty('history');
    expect(res).not.toHaveProperty('transcript');
    expect(res).not.toHaveProperty('messages');
  });

  it('preserves correlation_id end-to-end', async () => {
    const runner = new InMemorySubAgentRunner();
    const res = await spawnSubAgent({
      spec: basicSpec(),
      input: { prompt: 'x', correlation_id: 'corr-XYZ' },
      runner,
    });
    expect(res.correlation_id).toBe('corr-XYZ');
    expect(runner.invocations[0]?.correlation_id).toBe('corr-XYZ');
  });

  it('rejects a call when the spec is invalid', async () => {
    const runner = new InMemorySubAgentRunner();
    const badSpec = { ...basicSpec(), allowed_tools: [] };
    await expect(
      spawnSubAgent({
        spec: badSpec,
        input: { prompt: 'x', correlation_id: 'c' },
        runner,
      })
    ).rejects.toThrow(/allowed_tools/);
  });

  it('enforces allowlist — subagent attempting forbidden tool errors', async () => {
    const runner = new InMemorySubAgentRunner({
      tools_called: { researcher: ['Read', 'Bash'] },
    });
    const res = await spawnSubAgent({
      spec: basicSpec({ allowed_tools: ['Read'] }),
      input: { prompt: 'x', correlation_id: 'c' },
      runner,
    });
    expect(res.status).toBe('error');
    expect(res.error?.code).toBe('tool_not_allowed');
    expect(res.error?.message).toContain('Bash');
  });

  it('allows tool calls inside the allowlist', async () => {
    const runner = new InMemorySubAgentRunner({
      tools_called: { researcher: ['Read', 'Grep'] },
      outputs: { researcher: () => ({ ok: true }) },
    });
    const res = await spawnSubAgent({
      spec: basicSpec({ allowed_tools: ['Read', 'Grep'] }),
      input: { prompt: 'x', correlation_id: 'c' },
      runner,
    });
    expect(res.status).toBe('ok');
  });

  it('returns turn_limit when runner exceeds max_turns', async () => {
    const runner = new InMemorySubAgentRunner({ turns: { researcher: 10 } });
    const res = await spawnSubAgent({
      spec: basicSpec({ max_turns: 3 }),
      input: { prompt: 'x', correlation_id: 'c' },
      runner,
    });
    expect(res.status).toBe('turn_limit');
    expect(res.turns_used).toBe(3);
  });

  it('reports cost_usd from the runner', async () => {
    const runner = new InMemorySubAgentRunner({ cost: { researcher: 0.42 } });
    const res = await spawnSubAgent({
      spec: basicSpec(),
      input: { prompt: 'x', correlation_id: 'c' },
      runner,
    });
    expect(res.cost_usd).toBe(0.42);
  });
});

describe('spawnSubAgent — worktree isolation', () => {
  const iso: WorktreeIsolation = {
    branch: 'claude/spawn-test',
    base_ref: 'HEAD',
    path: '/tmp/test-worktree',
    cleanup_on_exit: true,
  };

  it('creates a worktree before and removes it after', async () => {
    const runner = new InMemorySubAgentRunner({
      outputs: { researcher: () => ({ ok: true }) },
    });
    const wt = new InMemoryWorktreeManager();
    await spawnSubAgent({
      spec: basicSpec({ worktree_isolation: iso }),
      input: { prompt: 'x', correlation_id: 'c' },
      runner,
      worktreeManager: wt,
    });
    expect(wt.events.map((e) => e.op)).toEqual(['create', 'remove']);
  });

  it('does not clean up when cleanup_on_exit is false', async () => {
    const runner = new InMemorySubAgentRunner({
      outputs: { researcher: () => ({ ok: true }) },
    });
    const wt = new InMemoryWorktreeManager();
    await spawnSubAgent({
      spec: basicSpec({
        worktree_isolation: { ...iso, cleanup_on_exit: false },
      }),
      input: { prompt: 'x', correlation_id: 'c' },
      runner,
      worktreeManager: wt,
    });
    expect(wt.events.map((e) => e.op)).toEqual(['create']);
  });

  it('errors when worktree_isolation is set but no manager is supplied', async () => {
    const runner = new InMemorySubAgentRunner();
    await expect(
      spawnSubAgent({
        spec: basicSpec({ worktree_isolation: iso }),
        input: { prompt: 'x', correlation_id: 'c' },
        runner,
      })
    ).rejects.toThrow(/worktreeManager/);
  });

  it('cleans up worktree even if the runner throws', async () => {
    const runner: import('../spawn.js').SubAgentRunner = {
      async run() {
        throw new Error('boom');
      },
    };
    const wt = new InMemoryWorktreeManager();
    await expect(
      spawnSubAgent({
        spec: basicSpec({ worktree_isolation: iso }),
        input: { prompt: 'x', correlation_id: 'c' },
        runner,
        worktreeManager: wt,
      })
    ).rejects.toThrow(/boom/);
    expect(wt.events.find((e) => e.op === 'remove')).toBeDefined();
  });
});

describe('SubAgentSpecMap shape', () => {
  it('supports per-query agents: {researcher, drafter} map', async () => {
    const specs: SubAgentSpecMap = {
      researcher: basicSpec({ name: 'researcher' }),
      drafter: basicSpec({ name: 'drafter', system_prompt: 'Draft a memo.' }),
    };
    const runner = new InMemorySubAgentRunner({
      outputs: {
        researcher: () => ({ kind: 'notes' }),
        drafter: () => ({ kind: 'memo' }),
      },
    });
    const r1 = await spawnSubAgent({
      spec: specs['researcher']!,
      input: { prompt: 'p1', correlation_id: 'c1' },
      runner,
    });
    const r2 = await spawnSubAgent({
      spec: specs['drafter']!,
      input: { prompt: 'p2', correlation_id: 'c2' },
      runner,
    });
    expect((r1.output as { kind: string }).kind).toBe('notes');
    expect((r2.output as { kind: string }).kind).toBe('memo');
    // 2 distinct invocations recorded, each with its own system prompt.
    expect(runner.invocations).toHaveLength(2);
    expect(runner.invocations[0]?.system_prompt).not.toBe(
      runner.invocations[1]?.system_prompt
    );
  });
});
