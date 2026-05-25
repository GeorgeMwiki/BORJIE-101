import { describe, it, expect } from 'vitest';
import { isBackgroundSpawn, type Decision, type SubMdSpawn } from '../decision.js';
import type { ScopeContext } from '../../../types.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures — a minimal tenant scope.
// ─────────────────────────────────────────────────────────────────────

const tenantScope: ScopeContext = {
  kind: 'tenant',
  tenantId: 't_1',
  actorUserId: 'u_1',
  roles: ['owner'],
  personaId: 'p_1',
};

function spawnBase(extra: Partial<SubMdSpawn> = {}): SubMdSpawn {
  return {
    subMdId: 'sm_1',
    scope: tenantScope,
    initialInput: { goal: 'evict' },
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────
// One test per new SubMdSpawn field.
// ─────────────────────────────────────────────────────────────────────

describe('SubMdSpawn expanded fields', () => {
  it('carries tools / disallowedTools whitelists', () => {
    const spawn = spawnBase({
      tools: ['arrears.read', 'arrears.calculate'],
      disallowedTools: ['tenant.delete'],
    });
    expect(spawn.tools).toContain('arrears.read');
    expect(spawn.disallowedTools).toContain('tenant.delete');
  });

  it('carries model + effort hints', () => {
    const spawn = spawnBase({ model: 'opus', effort: 'high' });
    expect(spawn.model).toBe('opus');
    expect(spawn.effort).toBe('high');
  });

  it('carries a permission-mode override', () => {
    const spawn = spawnBase({ permissionMode: 'plan' });
    expect(spawn.permissionMode).toBe('plan');
  });

  it('treats background and fireAndForget as equivalents', () => {
    const a = spawnBase({ background: true });
    const b = spawnBase({ fireAndForget: true });
    expect(isBackgroundSpawn(a)).toBe(true);
    expect(isBackgroundSpawn(b)).toBe(true);
    expect(isBackgroundSpawn(spawnBase({}))).toBe(false);
  });

  it('carries isolation and parentToolUseId breadcrumbs', () => {
    const spawn = spawnBase({
      isolation: 'simulated-worktree',
      parentToolUseId: 'tu_root',
    });
    expect(spawn.isolation).toBe('simulated-worktree');
    expect(spawn.parentToolUseId).toBe('tu_root');
  });

  it('carries an inline budget envelope', () => {
    const spawn = spawnBase({ budget: { maxTurns: 3 } });
    expect(spawn.budget?.maxTurns).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Decision union still pattern-matches every variant.
// ─────────────────────────────────────────────────────────────────────

describe('Decision union exhaustiveness', () => {
  it('compiles for every variant', () => {
    const decisions: Decision[] = [
      { kind: 'respond_to_owner', text: 'hi' },
      {
        kind: 'tool_call',
        call: { toolName: 't', input: {}, callId: 'c' },
      },
      { kind: 'spawn_sub_md', spawn: spawnBase({}) },
      {
        kind: 'schedule_wake',
        wake: { wakeAt: '2026-05-18T00:00:00Z', reason: 'ttl' },
      },
      {
        kind: 'monitor',
        watch: { watchId: 'w', predicate: 'arrears>0', timeoutMs: 1000 },
      },
      { kind: 'final', text: 'done' },
    ];
    expect(decisions.length).toBe(6);
  });
});
