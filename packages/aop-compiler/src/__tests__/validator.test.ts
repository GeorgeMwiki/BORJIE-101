import { describe, expect, it } from 'vitest';
import {
  validate,
  validateInvariants,
  validatePermissions,
  validateSchema,
  validateTools,
} from '../validator/index.js';
import { arrearsChase } from './fixtures/arrears-chase.aop.js';
import { leaseRenewal } from './fixtures/lease-renewal.aop.js';
import { kraFiling } from './fixtures/kra-filing.aop.js';
import { buildRegistry, FIXTURE_TOOLS } from './_test-helpers.js';
import type { AOP } from '../types.js';

describe('validateSchema', () => {
  it('accepts the three fixtures', () => {
    for (const ast of [arrearsChase, leaseRenewal, kraFiling]) {
      expect(validateSchema(ast).ok).toBe(true);
    }
  });

  it('rejects an AOP with no steps', () => {
    const bad = { ...arrearsChase, steps: [] };
    expect(validateSchema(bad).ok).toBe(false);
  });

  it('rejects bad cron expressions', () => {
    const bad = {
      ...arrearsChase,
      trigger: { kind: 'cron', schedule: 'not-a-cron' } as const,
    };
    expect(validateSchema(bad).ok).toBe(false);
  });

  it('rejects a step id that is not kebab/snake', () => {
    const bad: AOP = {
      ...arrearsChase,
      steps: [
        {
          kind: 'tool',
          id: 'BadID',
          tool: 'tenant.send_reminder',
          args: {},
        },
      ],
      entry: 'BadID',
    };
    expect(validateSchema(bad).ok).toBe(false);
  });

  it('rejects an AOP whose top-level steps array exceeds AOP_MAX_STEPS (H5)', () => {
    // 201 trivial tool steps — would pass without the cap. We use the same
    // tool id repeated so the fixture stays tiny and deterministic.
    const tooMany = Array.from({ length: 201 }, (_, i) => ({
      kind: 'tool' as const,
      id: `s-${i}`,
      tool: 'tenant.send_reminder',
      args: {},
    }));
    const bad = {
      ...arrearsChase,
      steps: tooMany,
      entry: 's-0',
    };
    expect(validateSchema(bad).ok).toBe(false);
  });

  it('rejects monitor without a timeout', () => {
    const bad: unknown = {
      ...arrearsChase,
      steps: [
        {
          kind: 'monitor',
          id: 'no-timeout',
          monitor: { kind: 'wait', until_event: 'x' },
          on_trigger: 'no-timeout',
        },
      ],
    };
    expect(validateSchema(bad).ok).toBe(false);
  });
});

describe('validateInvariants', () => {
  it('passes on the three fixtures', () => {
    for (const ast of [arrearsChase, leaseRenewal, kraFiling]) {
      const r = validateInvariants(ast);
      expect(r.ok).toBe(true);
    }
  });

  it('detects orphan references', () => {
    const bad: AOP = {
      ...arrearsChase,
      steps: [
        {
          kind: 'tool',
          id: 'a',
          tool: 'tenant.send_reminder',
          args: {},
          on_success: 'does-not-exist',
        },
      ],
      entry: 'a',
    };
    const r = validateInvariants(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'orphan-ref')).toBe(true);
  });

  it('detects duplicate step ids', () => {
    const bad: AOP = {
      ...arrearsChase,
      steps: [
        { kind: 'tool', id: 'a', tool: 'tenant.send_reminder', args: {} },
        { kind: 'tool', id: 'a', tool: 'tenant.voice_call', args: {} },
      ],
      entry: 'a',
    };
    const r = validateInvariants(bad);
    expect(r.errors.some((e) => e.code === 'duplicate-step-id')).toBe(true);
  });

  it('detects unbounded cycles (no loop block)', () => {
    const bad: AOP = {
      ...arrearsChase,
      steps: [
        {
          kind: 'tool',
          id: 'a',
          tool: 'tenant.send_reminder',
          args: {},
          on_success: 'b',
        },
        {
          kind: 'tool',
          id: 'b',
          tool: 'tenant.voice_call',
          args: {},
          on_success: 'a',
        },
      ],
      entry: 'a',
    };
    const r = validateInvariants(bad);
    expect(r.errors.some((e) => e.code === 'unbounded-cycle')).toBe(true);
  });

  it('permits bounded loop cycles', () => {
    const ok: AOP = {
      ...arrearsChase,
      steps: [
        {
          kind: 'loop',
          id: 'retry',
          exit_when: { kind: 'count', max: 3 },
          body: [
            {
              kind: 'tool',
              id: 'try',
              tool: 'tenant.send_reminder',
              args: {},
              on_success: 'try',
            },
          ],
        },
      ],
      entry: 'retry',
    };
    expect(validateInvariants(ok).ok).toBe(true);
  });

  it('detects no-terminal-step when every step is non-terminal and not in a loop', () => {
    const bad: AOP = {
      ...arrearsChase,
      steps: [
        {
          kind: 'tool',
          id: 'a',
          tool: 'tenant.send_reminder',
          args: {},
          on_success: 'b',
        },
        {
          kind: 'tool',
          id: 'b',
          tool: 'tenant.voice_call',
          args: {},
          on_success: 'a',
        },
      ],
      entry: 'a',
    };
    const r = validateInvariants(bad);
    expect(r.errors.some((e) => e.code === 'no-terminal-step')).toBe(true);
  });

  it('detects unknown entry id', () => {
    const bad: AOP = {
      ...arrearsChase,
      entry: 'nope-not-here',
    };
    const r = validateInvariants(bad);
    expect(r.errors.some((e) => e.code === 'unknown-entry')).toBe(true);
  });
});

describe('validateTools', () => {
  it('passes when all tools are registered', () => {
    const reg = buildRegistry(FIXTURE_TOOLS);
    for (const ast of [arrearsChase, leaseRenewal, kraFiling]) {
      expect(validateTools(ast, reg).ok).toBe(true);
    }
  });

  it('reports unknown tools', () => {
    const reg = buildRegistry({}); // empty
    const r = validateTools(arrearsChase, reg);
    expect(r.ok).toBe(false);
    expect(r.errors.every((e) => e.code === 'unknown-tool')).toBe(true);
  });
});

describe('validatePermissions', () => {
  it('passes when destructive tools are guarded (arrears-chase)', () => {
    const reg = buildRegistry(FIXTURE_TOOLS);
    expect(validatePermissions(arrearsChase, reg).ok).toBe(true);
  });

  it('flags a destructive tool that is NOT preceded by an ask-owner hook', () => {
    const reg = buildRegistry({ ...FIXTURE_TOOLS });
    const bad: AOP = {
      ...arrearsChase,
      steps: [
        {
          kind: 'tool',
          id: 'evict-now',
          tool: 'notice.draft_eviction_notice',
          args: {},
        },
      ],
      entry: 'evict-now',
    };
    const r = validatePermissions(bad, reg);
    expect(r.ok).toBe(false);
    expect(r.errors[0]!.code).toBe('destructive-tool-unguarded');
  });

  it('fail-closed: when the registry exposes no tier info, every tool step is treated as destructive and must be guarded (C1)', () => {
    // arrears-chase contains a destructive eviction tool that IS guarded by
    // ask-owner — but it also contains write-tier tools (send_reminder,
    // voice_call) which are NOT guarded. With tier() absent, ALL of them
    // are now treated as destructive, so the AOP must fail.
    const reg = { has: () => true };
    const r = validatePermissions(arrearsChase, reg);
    expect(r.ok).toBe(false);
    // Every error must be the destructive-tool-unguarded code, and the
    // failure reason must explain the fail-closed default so operators
    // see the contract.
    expect(r.errors.length).toBeGreaterThan(0);
    for (const err of r.errors) {
      expect(err.code).toBe('destructive-tool-unguarded');
    }
    expect(r.errors[0]!.message).toMatch(/fail-closed/i);
  });

  it('inspects step.args recursively for PII keys and rejects without grants (H4)', () => {
    const reg = buildRegistry({ ...FIXTURE_TOOLS });
    const bad: AOP = {
      ...arrearsChase,
      steps: [
        {
          kind: 'tool',
          id: 'send-reminder-with-pii',
          tool: 'tenant.send_reminder',
          args: {
            template: 'arrears-reminder',
            metadata: { kra_pin: '{{tenant.kra_pin}}' },
          },
        },
      ],
      entry: 'send-reminder-with-pii',
    };
    const r = validatePermissions(bad, reg);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'pii-key-not-granted')).toBe(true);
  });

  it('allows PII keys in step.args when an explicit grant is declared (H4)', () => {
    const reg = buildRegistry({ ...FIXTURE_TOOLS });
    const ok: AOP & { grants: ReadonlyArray<string> } = {
      ...arrearsChase,
      steps: [
        {
          kind: 'tool',
          id: 'send-reminder-with-pii',
          tool: 'tenant.send_reminder',
          args: { template: 'arrears-reminder', kra_pin: 'P123' },
        },
      ],
      entry: 'send-reminder-with-pii',
      grants: ['kra_pin'],
    };
    const r = validatePermissions(ok, reg);
    expect(r.ok).toBe(true);
  });

  it('detects PII keys nested inside arrays (H4)', () => {
    const reg = buildRegistry({ ...FIXTURE_TOOLS });
    const bad: AOP = {
      ...arrearsChase,
      steps: [
        {
          kind: 'tool',
          id: 'send-many',
          tool: 'tenant.send_reminder',
          args: { recipients: [{ name: 'A', nin: '12345' }] },
        },
      ],
      entry: 'send-many',
    };
    const r = validatePermissions(bad, reg);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.code === 'pii-key-not-granted')).toBe(true);
  });
});

describe('validate (composed)', () => {
  it('runs end-to-end on all three fixtures', () => {
    const reg = buildRegistry(FIXTURE_TOOLS);
    for (const ast of [arrearsChase, leaseRenewal, kraFiling]) {
      const r = validate(ast, reg);
      if (!r.ok) {
        // Surface the errors so debugging the fixture is fast.
        throw new Error(
          `validate failed for ${ast.name}: ${JSON.stringify(r.errors, null, 2)}`,
        );
      }
      expect(r.ok).toBe(true);
    }
  });
});
