/**
 * `compileSkillFromNL` — integration tests against the stubbed AOP
 * compiler. Covers the happy path, every failure stage, scope routing,
 * destructive-tool gating, and conversation-anchor materialisation.
 */

import { describe, expect, it } from 'vitest';
import { compileSkillFromNL } from '../compile/compile-skill.js';
import {
  ARREARS_CHASE_AOP,
  buildAllowAutonomyValidator,
  buildDenyAutonomyValidator,
  buildRegistry,
  buildStubLLM,
  fixedNow,
  LEASE_RENEWAL_AOP,
  stableIdGenerator,
  UNGUARDED_EVICTION_AOP,
  WEEKLY_BRIEF_AOP,
} from './_helpers.js';

const baseArgs = {
  scope: 'owner-customer' as const,
  tenantId: 'tenant-001',
  authorActorId: 'actor-001',
  conversationId: 'conv-abc',
  messageId: 'msg-1',
  nowIso: fixedNow,
};

describe('compileSkillFromNL — happy path', () => {
  it('compiles a weekly-brief recurring NL into a SkillRegistryEntry', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday morning', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL(
      {
        ...baseArgs,
        nl: 'Every Monday morning send me a one-page brief on the previous week.',
        llm,
        toolRegistry: buildRegistry(),
      },
      { idGenerator: stableIdGenerator() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registryEntry.aopName).toBe('weekly-brief');
    expect(result.registryEntry.lifecycle).toBe('active');
    expect(result.registryEntry.scope).toBe('owner-customer');
    expect(result.registryEntry.tenantId).toBe('tenant-001');
  });

  it('persists the conversation anchor on the entry', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday morning', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL(
      {
        ...baseArgs,
        nl: 'Every Monday morning send me a one-page brief on the previous week.',
        llm,
        toolRegistry: buildRegistry(),
      },
      { idGenerator: stableIdGenerator() },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.registryEntry.anchor.conversationId).toBe('conv-abc');
    expect(result.registryEntry.anchor.messageId).toBe('msg-1');
    expect(result.registryEntry.anchor.createdAt).toBe(fixedNow);
    expect(result.registryEntry.anchor.originalNL).toContain('Every Monday morning');
  });

  it('emits a friendly chat confirmation', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL(
      {
        ...baseArgs,
        nl: 'Every Monday morning send me a one-page brief on the previous week.',
        llm,
        toolRegistry: buildRegistry(),
      },
      { idGenerator: stableIdGenerator() },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.chatConfirmation).toMatch(/Done\./);
    expect(result.chatConfirmation).toMatch(/Monday/);
  });

  it('history has both "created" and "activated" events', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL(
      {
        ...baseArgs,
        nl: 'Every Monday morning send me a one-page brief on the previous week.',
        llm,
        toolRegistry: buildRegistry(),
      },
      { idGenerator: stableIdGenerator() },
    );
    if (!result.ok) throw new Error('expected ok');
    const kinds = result.registryEntry.history.map((h) => h.kind);
    expect(kinds).toContain('created');
    expect(kinds).toContain('activated');
  });

  it('compiles a conditional (event-triggered) AOP', async () => {
    const llm = buildStubLLM([{ contains: 'lease ends in 60 days', respond: LEASE_RENEWAL_AOP }]);
    const result = await compileSkillFromNL(
      {
        ...baseArgs,
        nl: 'If a lease ends in 60 days, draft a renewal offer and ask me to approve.',
        llm,
        toolRegistry: buildRegistry(),
      },
      { idGenerator: stableIdGenerator() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registryEntry.aopName).toBe('lease-renewal-60d');
    expect(result.aopResult.cron).toBeNull();
  });

  it('compiles a guarded eviction (destructive tool with ask-owner)', async () => {
    const llm = buildStubLLM([
      { contains: 'On day 25 every month', respond: ARREARS_CHASE_AOP },
    ]);
    const result = await compileSkillFromNL(
      {
        ...baseArgs,
        nl: 'On day 25 every month, chase tenants in arrears for 7+ days. Ask me before drafting an eviction notice.',
        llm,
        toolRegistry: buildRegistry(),
      },
      { idGenerator: stableIdGenerator() },
    );
    expect(result.ok).toBe(true);
  });
});

describe('compileSkillFromNL — intent rejection', () => {
  it('rejects a question (non-compile-eligible)', async () => {
    const result = await compileSkillFromNL({
      ...baseArgs,
      nl: 'What is my arrears total this month?',
      llm: buildStubLLM([]),
      toolRegistry: buildRegistry(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('intent-rejected');
    expect(result.chatRejection).toMatch(/recurring or conditional/);
  });

  it('rejects an ad-hoc imperative', async () => {
    const result = await compileSkillFromNL({
      ...baseArgs,
      nl: 'Send tenant John an SMS now.',
      llm: buildStubLLM([]),
      toolRegistry: buildRegistry(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('intent-rejected');
  });
});

describe('compileSkillFromNL — scope validation', () => {
  it('rejects owner-customer with no tenantId', async () => {
    const result = await compileSkillFromNL({
      ...baseArgs,
      tenantId: null,
      nl: 'Every Monday send me a brief.',
      llm: buildStubLLM([]),
      toolRegistry: buildRegistry(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('intent-rejected');
    expect(result.errors[0]!.code).toBe('invalid-scope-args');
  });

  it('accepts internal-admin with null tenantId (platform-wide)', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL(
      {
        ...baseArgs,
        scope: 'internal-admin',
        tenantId: null,
        nl: 'Every Monday at 9am, send all platform admins the churn report.',
        llm,
        toolRegistry: buildRegistry(),
      },
      { idGenerator: stableIdGenerator() },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.registryEntry.scope).toBe('internal-admin');
    expect(result.registryEntry.tenantId).toBeNull();
  });

  it('accepts internal-admin with a tenantId (tenant-scoped admin skill)', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL(
      {
        ...baseArgs,
        scope: 'internal-admin',
        tenantId: 'tenant-X',
        nl: 'Every Monday at 9am, send tenant X owner their churn report.',
        llm,
        toolRegistry: buildRegistry(),
      },
      { idGenerator: stableIdGenerator() },
    );
    expect(result.ok).toBe(true);
  });
});

describe('compileSkillFromNL — AOP failures', () => {
  it('returns aop-parse-failed on bad JSON from LLM', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: '{ not json' }]);
    const result = await compileSkillFromNL({
      ...baseArgs,
      nl: 'Every Monday send me a brief.',
      llm,
      toolRegistry: buildRegistry(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('aop-parse-failed');
  });

  it('returns aop-validation-failed on unknown tool', async () => {
    const badAop = {
      ...WEEKLY_BRIEF_AOP,
      steps: [{ kind: 'tool' as const, id: 'x', tool: 'unknown.tool', args: {} }],
      entry: 'x',
    };
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: badAop as never }]);
    const result = await compileSkillFromNL({
      ...baseArgs,
      nl: 'Every Monday send me a brief.',
      llm,
      toolRegistry: buildRegistry(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('aop-validation-failed');
  });

  it('returns destructive-blocked when an eviction step has no ask-owner guard', async () => {
    const llm = buildStubLLM([
      { contains: 'Every Monday I want to evict', respond: UNGUARDED_EVICTION_AOP },
    ]);
    const result = await compileSkillFromNL({
      ...baseArgs,
      nl: 'Every Monday I want to evict the latest defaulter automatically.',
      llm,
      toolRegistry: buildRegistry(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(['destructive-blocked', 'aop-validation-failed']).toContain(result.stage);
  });
});

describe('compileSkillFromNL — autonomy validation', () => {
  it('passes when validator allows', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL(
      {
        ...baseArgs,
        nl: 'Every Monday morning send me a one-page brief on the previous week.',
        llm,
        toolRegistry: buildRegistry(),
        autonomyValidator: buildAllowAutonomyValidator(),
      },
      { idGenerator: stableIdGenerator() },
    );
    expect(result.ok).toBe(true);
  });

  it('rejects autonomy-rejected when validator denies', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL({
      ...baseArgs,
      nl: 'Every Monday morning send me a one-page brief on the previous week.',
      llm,
      toolRegistry: buildRegistry(),
      autonomyValidator: buildDenyAutonomyValidator('over cap'),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.stage).toBe('autonomy-rejected');
    expect(result.chatRejection).toMatch(/cap/);
  });

  it('emits the autonomy reason in the chat rejection', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL({
      ...baseArgs,
      nl: 'Every Monday morning send me a one-page brief on the previous week.',
      llm,
      toolRegistry: buildRegistry(),
      autonomyValidator: buildDenyAutonomyValidator('mutations over 80% of daily cap'),
    });
    if (result.ok) throw new Error('expected fail');
    expect(result.chatRejection).toMatch(/80%/);
  });
});

describe('compileSkillFromNL — id determinism', () => {
  it('uses the injected id generator', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL(
      {
        ...baseArgs,
        nl: 'Every Monday morning send me a one-page brief on the previous week.',
        llm,
        toolRegistry: buildRegistry(),
      },
      { idGenerator: () => 'fixed-id-123' },
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.registryEntry.id).toBe('fixed-id-123');
  });

  it('generates a non-empty unique-ish id when no generator is supplied', async () => {
    const llm = buildStubLLM([{ contains: 'Every Monday', respond: WEEKLY_BRIEF_AOP }]);
    const result = await compileSkillFromNL({
      ...baseArgs,
      nl: 'Every Monday morning send me a one-page brief on the previous week.',
      llm,
      toolRegistry: buildRegistry(),
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.registryEntry.id.length).toBeGreaterThan(5);
    expect(result.registryEntry.id.startsWith('skl_')).toBe(true);
  });
});
