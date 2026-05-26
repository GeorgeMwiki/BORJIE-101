import { describe, it, expect } from 'vitest';
import { decideSkillDecay, deprecateSkill } from '../skill/skill-decay.js';
import type { Skill } from '../types.js';

function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'skl_demo',
    version: 1,
    tenant_id: 't1',
    scope_id: 'tenant_root',
    intent: 'demo_intent',
    preconditions: [],
    steps: [],
    postconditions: [],
    success_rate: 0.9,
    invocations: 5,
    last_used_at: '2025-01-01T00:00:00Z',
    composed_from_skills: [],
    status: 'canonical',
    audit_hash: 'pm-chain-aaaaaaaa',
    decayed_at: null,
    created_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('skill-decay', () => {
  it('does not decay a recently used skill', () => {
    const skill = makeSkill({ last_used_at: '2026-05-20T00:00:00Z' });
    const decision = decideSkillDecay(skill, new Date('2026-05-26T00:00:00Z'));
    expect(decision.should_decay).toBe(false);
    expect(decision.reason).toBe('recent');
  });

  it('decays a skill unused for 180+ days', () => {
    const skill = makeSkill({ last_used_at: '2025-11-01T00:00:00Z' });
    const decision = decideSkillDecay(skill, new Date('2026-05-26T00:00:00Z'));
    expect(decision.should_decay).toBe(true);
    expect(decision.reason).toBe('stale');
  });

  it('decays a never-used skill that is old enough', () => {
    const skill = makeSkill({
      last_used_at: null,
      created_at: '2025-01-01T00:00:00Z',
    });
    const decision = decideSkillDecay(skill, new Date('2026-05-26T00:00:00Z'));
    expect(decision.should_decay).toBe(true);
    expect(decision.reason).toBe('never_used');
  });

  it('does not decay a deprecated skill again', () => {
    const skill = makeSkill({
      status: 'deprecated',
      last_used_at: '2024-01-01T00:00:00Z',
    });
    const decision = decideSkillDecay(skill, new Date('2026-05-26T00:00:00Z'));
    expect(decision.should_decay).toBe(false);
    expect(decision.reason).toBe('already_deprecated');
  });

  it('deprecateSkill bumps version and sets decayed_at', () => {
    const skill = makeSkill();
    const decayed = deprecateSkill(skill, new Date('2026-05-26T00:00:00Z'));
    expect(decayed.version).toBe(2);
    expect(decayed.status).toBe('deprecated');
    expect(decayed.decayed_at).toBe('2026-05-26T00:00:00.000Z');
  });
});
