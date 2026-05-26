import { describe, it, expect } from 'vitest';
import {
  createSkillObserve,
  createSkillLookupByIntent,
} from '../skill/skill-registry.js';
import { createInMemorySkillRepository } from '../storage/skill-repository.js';
import { createInMemoryAuditChain } from '../audit/audit-chain-link.js';
import { PersistentMemoryError, type Skill } from '../types.js';

const baseInput = {
  id: 'skl_compose_tumemadini',
  tenant_id: 't1',
  scope_id: 'tenant_root',
  intent: 'compose_tumemadini_return',
  preconditions: [],
  steps: [
    {
      seq: 0,
      tool_or_skill: 'cap:fetch_quarterly_production',
      input_template: { quarter: '{{quarter}}' },
      expected_output_schema: { type: 'object' },
      retry_policy: { max_attempts: 2, backoff_ms: 500, on_failure: 'abort' as const },
    },
  ],
  postconditions: [],
  composed_from_skills: [] as ReadonlyArray<string>,
  now: new Date('2026-05-26T10:00:00Z'),
};

describe('skill-registry', () => {
  it('observes a new skill with status=observed and audit hash', async () => {
    const repo = createInMemorySkillRepository();
    const audit = createInMemoryAuditChain();
    const observe = createSkillObserve({ repo, audit });

    const s: Skill = await observe({
      ...baseInput,
      success_rate: 0.9,
      invocations: 4,
    });

    expect(s.status).toBe('observed');
    expect(s.audit_hash).toMatch(/^pm-chain-/);
    expect(s.version).toBe(1);
    expect(s.id).toBe('skl_compose_tumemadini');
  });

  it('rejects invocations < 0', async () => {
    const repo = createInMemorySkillRepository();
    const audit = createInMemoryAuditChain();
    const observe = createSkillObserve({ repo, audit });

    await expect(
      observe({ ...baseInput, success_rate: 0.9, invocations: -1 }),
    ).rejects.toBeInstanceOf(PersistentMemoryError);
  });

  it('rejects out-of-range success_rate', async () => {
    const repo = createInMemorySkillRepository();
    const audit = createInMemoryAuditChain();
    const observe = createSkillObserve({ repo, audit });

    await expect(
      observe({ ...baseInput, success_rate: 1.5, invocations: 4 }),
    ).rejects.toBeInstanceOf(PersistentMemoryError);
  });

  it('lookup hides deprecated skills', async () => {
    const repo = createInMemorySkillRepository();
    const audit = createInMemoryAuditChain();
    const observe = createSkillObserve({ repo, audit });
    const lookup = createSkillLookupByIntent({ repo });

    await observe({ ...baseInput, success_rate: 0.9, invocations: 4 });
    const matches = await lookup('t1', 'compose_tumemadini_return');
    expect(matches.length).toBe(1);

    // Now insert a deprecated variant — lookup should hide it.
    await repo.insert({
      ...matches[0]!,
      id: 'skl_other',
      version: 2,
      status: 'deprecated',
    });
    const matchesAfter = await lookup('t1', 'compose_tumemadini_return');
    expect(matchesAfter.length).toBe(1);
  });
});
