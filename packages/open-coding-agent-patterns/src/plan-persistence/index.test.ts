import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createPlan,
  executeStep,
  loadPlan,
  parsePlanMarkdown,
  persistPlan,
  planContentHash,
  recordCheckpoint,
  updateStepStatus,
} from './index.js';
import { cleanup, createMockBrain, createTempDir } from '../__tests__/fixtures/setup.js';
import type { Plan } from '../types.js';

const BRAIN_RESPONSE = [
  'STEP s1 | Add migration | depends:none | A new SQL migration file applied.',
  'STEP s2 | Wire UI selector | depends:s1 | UI shows currency dropdown.',
  'STEP s3 | Tests | depends:s2 | Unit + e2e tests added.',
].join('\n');

describe('plan-persistence :: createPlan', () => {
  it('asks the brain to decompose the goal and parses STEP lines', async () => {
    const brain = createMockBrain({ responses: [BRAIN_RESPONSE] });
    const plan = await createPlan({
      goal: 'Multi-currency tenant settings',
      brain,
      id: 'plan-001',
    });
    expect(plan.id).toBe('plan-001');
    expect(plan.steps).toHaveLength(3);
    expect(plan.steps[0]?.id).toBe('s1');
    expect(plan.steps[1]?.dependsOn).toEqual(['s1']);
    expect(plan.steps[2]?.dependsOn).toEqual(['s2']);
    expect(brain.calls[0]?.prompt).toContain('Multi-currency');
  });

  it('honours maxSteps in the prompt', async () => {
    const brain = createMockBrain({ responses: [''] });
    await createPlan({ goal: 'g', brain, maxSteps: 3 });
    expect(brain.calls[0]?.prompt).toContain('AT MOST 3 atomic steps');
  });
});

describe('plan-persistence :: persistPlan + loadPlan round-trip', () => {
  let root: string;

  beforeEach(async () => {
    root = await createTempDir('ocap-plan-');
  });
  afterEach(async () => {
    await cleanup(root);
  });

  it('persists a plan as markdown and re-parses it without loss', async () => {
    const brain = createMockBrain({ responses: [BRAIN_RESPONSE] });
    const original = await createPlan({
      goal: 'Round-trip test',
      brain,
      id: 'plan-rt',
    });
    const file = await persistPlan({ plan: original, path: root });
    expect(file).toContain('PLAN.md');

    const loaded = await loadPlan(root);
    expect(loaded.id).toBe(original.id);
    expect(loaded.goal).toBe(original.goal);
    expect(loaded.steps).toHaveLength(original.steps.length);
    expect(loaded.steps[1]?.dependsOn).toEqual(['s1']);
  });

  it('preserves checkpoints across round-trip', async () => {
    const brain = createMockBrain({ responses: [BRAIN_RESPONSE] });
    const plan = await createPlan({ goal: 'g', brain, id: 'plan-cp' });
    const cp = {
      stepId: 's1',
      completedAt: 1716552500000,
      artifacts: Object.freeze(['migration.sql', 'README.md']),
      notes: 'applied cleanly',
    };
    const updated = recordCheckpoint(plan, cp);
    await persistPlan({ plan: updated, path: root });
    const loaded = await loadPlan(root);
    const s1 = loaded.steps.find((s) => s.id === 's1');
    expect(s1?.status).toBe('done');
    expect(s1?.checkpoint?.artifacts).toEqual(['migration.sql', 'README.md']);
    expect(s1?.checkpoint?.notes).toBe('applied cleanly');
  });
});

describe('plan-persistence :: parsePlanMarkdown', () => {
  it('throws on missing frontmatter', () => {
    expect(() => parsePlanMarkdown('no frontmatter here')).toThrow(/frontmatter/);
  });

  it('handles plans with no steps', () => {
    const raw = '---\nid: x\ngoal: "g"\ncreatedAt: 1\nupdatedAt: 1\nversion: 1\n---\n';
    const plan = parsePlanMarkdown(raw);
    expect(plan.steps).toHaveLength(0);
  });
});

describe('plan-persistence :: mutation helpers', () => {
  function basePlan(): Plan {
    return Object.freeze({
      id: 'p',
      goal: 'g',
      createdAt: 1,
      updatedAt: 1,
      version: 1,
      steps: Object.freeze([
        Object.freeze({
          id: 's1',
          title: 'Step 1',
          description: 'd',
          dependsOn: Object.freeze([]),
          expectedOutput: 'o',
          status: 'pending' as const,
        }),
      ]),
    });
  }

  it('updateStepStatus returns a new plan with the new status and bumped version', () => {
    const p = basePlan();
    const next = updateStepStatus(p, 's1', 'done');
    expect(next.steps[0]?.status).toBe('done');
    expect(next.version).toBe(p.version + 1);
    expect(p.steps[0]?.status).toBe('pending'); // immutability
  });

  it('planContentHash returns deterministic 24-char hex', () => {
    const h1 = planContentHash(basePlan());
    const h2 = planContentHash(basePlan());
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe('plan-persistence :: executeStep', () => {
  it('runs the executor and records a checkpoint', async () => {
    const brain = createMockBrain({ responses: [BRAIN_RESPONSE] });
    const plan = await createPlan({ goal: 'g', brain, id: 'plan-x' });
    const out = await executeStep({
      plan,
      stepId: 's1',
      brain,
      executor: async () => ['migration.sql'],
    });
    expect(out.checkpoint.stepId).toBe('s1');
    expect(out.checkpoint.artifacts).toEqual(['migration.sql']);
    const s1 = out.plan.steps.find((s) => s.id === 's1');
    expect(s1?.status).toBe('done');
  });

  it('refuses to run a step whose dependencies are not done', async () => {
    const brain = createMockBrain({ responses: [BRAIN_RESPONSE] });
    const plan = await createPlan({ goal: 'g', brain, id: 'plan-x' });
    await expect(
      executeStep({
        plan,
        stepId: 's2',
        brain,
        executor: async () => [],
      }),
    ).rejects.toThrow(/dependency/);
  });

  it('throws on unknown stepId', async () => {
    const brain = createMockBrain({ responses: [BRAIN_RESPONSE] });
    const plan = await createPlan({ goal: 'g', brain, id: 'plan-x' });
    await expect(
      executeStep({
        plan,
        stepId: 'sXX',
        brain,
        executor: async () => [],
      }),
    ).rejects.toThrow(/unknown step/);
  });
});
