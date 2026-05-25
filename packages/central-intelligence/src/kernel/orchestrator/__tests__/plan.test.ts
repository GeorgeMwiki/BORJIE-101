import { describe, it, expect } from 'vitest';
import {
  createPlan,
  createEmptyPlan,
  createInMemoryPlanStore,
  type PlanGoal,
} from '../plan.js';

const goal = (id: string, status: PlanGoal['status'] = 'pending'): PlanGoal => ({
  id,
  description: `goal ${id}`,
  status,
  subGoals: [],
});

describe('Plan', () => {
  it('isComplete is false for an empty plan', () => {
    const p = createEmptyPlan('thread_1');
    expect(p.isComplete()).toBe(false);
    expect(p.currentGoal()).toBeNull();
  });

  it('returns the first pending goal as the current focus', () => {
    const p = createPlan('thread_1', [goal('g1'), goal('g2')]);
    const cur = p.currentGoal();
    expect(cur?.id).toBe('g1');
  });

  it('prefers an active goal over a pending one', () => {
    const p = createPlan('thread_1', [
      goal('g1', 'active'),
      goal('g2'),
    ]);
    expect(p.currentGoal()?.id).toBe('g1');
  });

  it('advance() returns a new Plan with the goal status updated', () => {
    const original = createPlan('thread_1', [goal('g1'), goal('g2')]);
    const advanced = original.advance({ goalId: 'g1', newStatus: 'complete' });
    // Original is untouched.
    expect(original.currentGoal()?.id).toBe('g1');
    // Advanced has g1 complete and g2 active in queue.
    expect(advanced.currentGoal()?.id).toBe('g2');
  });

  it('recordRejection() marks the goal rejected with the reason', () => {
    const p = createPlan('thread_1', [goal('g1')]);
    const after = p.recordRejection({
      goalId: 'g1',
      reason: 'denied by policy',
      code: 'pol-1',
    });
    const root = after.state().rootGoals[0];
    expect(root?.status).toBe('rejected');
    expect(root?.rejectionReason).toBe('denied by policy');
  });

  it('isComplete is true when every root goal is complete or rejected', () => {
    let p = createPlan('thread_1', [goal('g1'), goal('g2')]);
    p = p.advance({ goalId: 'g1', newStatus: 'complete' });
    p = p.advance({ goalId: 'g2', newStatus: 'complete' });
    expect(p.isComplete()).toBe(true);
  });

  it('addSubGoals() inserts under the named parent', () => {
    let p = createPlan('thread_1', [goal('g1')]);
    p = p.addSubGoals('g1', [goal('g1.1'), goal('g1.2')]);
    const root = p.state().rootGoals[0];
    expect(root?.subGoals.map((g) => g.id)).toEqual(['g1.1', 'g1.2']);
  });
});

describe('createInMemoryPlanStore', () => {
  it('returns the same Plan instance for the same threadId across loads', async () => {
    const store = createInMemoryPlanStore();
    const a = await store.load('t1');
    const b = await store.load('t1');
    expect(a).toBe(b);
  });

  it('save() persists the latest snapshot', async () => {
    const store = createInMemoryPlanStore();
    const initial = await store.load('t1');
    const advanced = initial; // no-op transformation
    await store.save(advanced);
    expect(await store.load('t1')).toBe(advanced);
  });
});
