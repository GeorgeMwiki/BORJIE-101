/**
 * Tests for the in-memory `GoalsPort` reference implementation.
 *
 * Mirrors the contract the Drizzle service must honour:
 *
 *   1. open() + get()
 *   2. list() filtered by status
 *   3. get() returns null for unknown id
 *   4. updateStepStatus() rewrites the step + bumps stepsDone
 *   5. setStatus('completed') stamps completedAt
 *   6. list() orders by createdAt DESC
 */
import { describe, it, expect } from 'vitest';
import { createInMemoryGoalsPort } from '../goals/goal-tracker.js';

describe('createInMemoryGoalsPort', () => {
  it('open() then get() round-trip', async () => {
    const port = createInMemoryGoalsPort();
    const { id } = await port.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'Resolve arrears',
      description: 'Unit 4B is 30+ days overdue.',
      status: 'active',
      priority: 'high',
      steps: [
        {
          seq: 0,
          description: 'Send reminder',
          toolName: 'rent.send-reminder',
          toolPayload: { leaseId: 'L1', channel: 'sms' },
        },
      ],
    });
    const fetched = await port.get(id);
    expect(fetched?.title).toBe('Resolve arrears');
    expect(fetched?.steps).toHaveLength(1);
    expect(fetched?.steps[0]?.status).toBe('pending');
  });

  it('list() filtered by status returns only matching goals', async () => {
    const port = createInMemoryGoalsPort();
    const a = await port.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'A',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [],
    });
    await port.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'B',
      description: '',
      status: 'completed',
      priority: 'low',
      steps: [],
    });
    const active = await port.list({
      tenantId: 't',
      userId: 'u',
      status: 'active',
    });
    expect(active.map((g) => g.id)).toEqual([a.id]);
  });

  it('get() returns null for unknown id', async () => {
    const port = createInMemoryGoalsPort();
    expect(await port.get('nope')).toBeNull();
  });

  it('updateStepStatus() rewrites the step and bumps stepsDone', async () => {
    const port = createInMemoryGoalsPort();
    const { id } = await port.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'A',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [
        { seq: 0, description: 's0', toolName: null, toolPayload: null },
        { seq: 1, description: 's1', toolName: null, toolPayload: null },
      ],
    });
    const before = await port.get(id);
    const stepId = before!.steps[0]!.id;
    await port.updateStepStatus({
      goalId: id,
      stepId,
      status: 'done',
      outcome: 'ok',
    });
    const after = await port.get(id);
    expect(after?.metrics.stepsDone).toBe(1);
    expect(after?.steps[0]?.status).toBe('done');
    expect(after?.steps[0]?.outcome).toBe('ok');
  });

  it("setStatus('completed') stamps completedAt", async () => {
    const port = createInMemoryGoalsPort();
    const { id } = await port.open({
      tenantId: 't',
      userId: 'u',
      threadId: 'th',
      title: 'A',
      description: '',
      status: 'active',
      priority: 'low',
      steps: [],
    });
    await port.setStatus(id, 'completed');
    const g = await port.get(id);
    expect(g?.status).toBe('completed');
    expect(g?.completedAt).not.toBeNull();
  });

  it('list() orders by createdAt DESC', async () => {
    let now = new Date('2026-01-01T00:00:00Z').getTime();
    const clock = () => new Date(now);
    const port = createInMemoryGoalsPort({ clock });
    const aId = (
      await port.open({
        tenantId: 't',
        userId: 'u',
        threadId: 'th',
        title: 'older',
        description: '',
        status: 'active',
        priority: 'low',
        steps: [],
      })
    ).id;
    now += 2_000;
    const bId = (
      await port.open({
        tenantId: 't',
        userId: 'u',
        threadId: 'th',
        title: 'newer',
        description: '',
        status: 'active',
        priority: 'low',
        steps: [],
      })
    ).id;
    const out = await port.list({ tenantId: 't', userId: 'u' });
    expect(out.map((g) => g.id)).toEqual([bId, aId]);
  });
});
