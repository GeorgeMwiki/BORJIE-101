/**
 * End-to-end integration: assign → followup dispatch → check-in →
 * performance signal → coaching → escalation. Exercises every module
 * through a single thread.
 */

import { describe, expect, it } from 'vitest';
import { assignTask } from '../assign-task.js';
import { receiveCheckIn } from '../check-in-receiver.js';
import { autoTriggerCoaching } from '../coaching-generator.js';
import { runEscalationOnce } from '../escalation-rules.js';
import { runFollowupSchedulerOnce } from '../followup-scheduler.js';
import { runSkillInferrer } from '../skill-inferrer.js';
import { makeFixture, seedEmployee } from './fixtures.js';

describe('integration — full agentic workforce loop', () => {
  it('runs assign → followup → check-in → coaching → escalation', async () => {
    const fx = makeFixture({ nowIso: '2026-05-22T08:00:00Z' });
    seedEmployee(fx.store, {
      id: 'emp-mgr',
      tenantId: 't1',
      personEntityId: 'p-mgr',
    });
    seedEmployee(fx.store, {
      id: 'emp-1',
      tenantId: 't1',
      personEntityId: 'p1',
      managerEmployeeId: 'emp-mgr',
    });

    // 1. Assign — daily cadence guarantees a slot before the
    // integration's clock advance.
    const assignResult = await assignTask(fx.deps, {
      tenantId: 't1',
      title: 'Survey unit 12A',
      description: 'condition survey',
      assignedEmployeeId: 'emp-1',
      assignedByUserId: 'u-mgr',
      priority: 'urgent',
      dueAt: new Date(Date.parse('2026-05-25T17:00:00Z')).toISOString(),
    });
    expect(assignResult.followupIds.length).toBeGreaterThan(0);

    // 2. Advance the clock past the first followup.
    fx.setClock(new Date(Date.parse('2026-05-23T09:00:00Z')));
    const dispatched = await runFollowupSchedulerOnce(fx.deps, 't1');
    expect(dispatched.length).toBeGreaterThan(0);

    // 3. Employee reports a blocker.
    const ci = await receiveCheckIn(fx.deps, {
      tenantId: 't1',
      assignmentId: assignResult.assignment.id,
      employeeId: 'emp-1',
      responseKind: 'blocker',
      responseText: 'stuck, broken vendor',
    });
    expect(ci.assignment.status).toBe('blocked');

    // 4. Two more blockers to trigger repeated_blocker.
    await receiveCheckIn(fx.deps, {
      tenantId: 't1',
      assignmentId: assignResult.assignment.id,
      employeeId: 'emp-1',
      responseKind: 'blocker',
      responseText: 'still stuck',
    });
    await receiveCheckIn(fx.deps, {
      tenantId: 't1',
      assignmentId: assignResult.assignment.id,
      employeeId: 'emp-1',
      responseKind: 'blocker',
      responseText: 'still stuck again',
    });
    const blockerSignals = fx.store.signals.filter((s) => s.signalKind === 'repeated_blocker');
    expect(blockerSignals.length).toBeGreaterThan(0);

    // 5. Auto-trigger coaching.
    fx.content.coachingText = 'Let us set up a 1-on-1 to unstick you.';
    const triggers = await autoTriggerCoaching(fx.deps, {
      tenantId: 't1',
      employeeId: 'emp-1',
    });
    expect(triggers).toContain('repeated_blocker');
    expect(fx.store.coaching.some((c) => c.status === 'sent')).toBe(true);

    // 6. Time passes; escalation fires on blocked-too-long.
    fx.setClock(new Date(Date.parse('2026-05-26T09:00:00Z')));
    const escalations = await runEscalationOnce(fx.deps, 't1');
    expect(escalations.length).toBeGreaterThan(0);
    expect(fx.tickets.created.length).toBeGreaterThan(0);

    // 7. Skill inference reflects the negative signals.
    const skills = await runSkillInferrer(fx.deps, {
      tenantId: 't1',
      employeeId: 'emp-1',
    });
    const help = skills.find((s) => s.skillSlug === 'help_seeking');
    expect(help).toBeTruthy();
  });

  it('rejects cross-tenant operations', async () => {
    const fx = makeFixture();
    seedEmployee(fx.store, { id: 'emp-1', tenantId: 't1', personEntityId: 'p1' });
    // Try to assign from tenant t2 — store returns null for the
    // employee, so assign refuses.
    await expect(
      assignTask(fx.deps, {
        tenantId: 't2',
        title: 'x',
        description: 'x',
        assignedEmployeeId: 'emp-1',
        assignedByUserId: 'u1',
      })
    ).rejects.toThrow();
  });
});
