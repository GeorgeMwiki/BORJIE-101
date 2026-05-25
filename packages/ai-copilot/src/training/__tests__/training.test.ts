/**
 * Adaptive training — full-stack unit tests.
 *
 * 20+ covering generation, idempotency, assignment, tenant isolation,
 * delivery progression against BKT, stall detection, path edits, feature-flag
 * gating, and force-complete.
 */

import { describe, it, expect } from 'vitest';
import { createTrainingGenerator } from '../training-generator.js';
import { createInMemoryTrainingRepository } from '../training-repository.js';
import {
  createTrainingAssignmentService,
  type FeatureFlagLike,
  type TrainingEventPublisher,
} from '../training-assignment-service.js';
import {
  createTrainingDeliveryService,
  type MasteryPort,
} from '../training-delivery-service.js';
import { createTrainingAdminEndpoints } from '../admin-dashboard-endpoints.js';
import {
  TrainingDisabledError,
  TenantMismatchError,
  type TrainingPath,
} from '../training-types.js';

const TEN_A = 'tenant-alpha';
const TEN_B = 'tenant-beta';
const ADMIN = 'admin-user-1';

function fixedNow(): Date {
  return new Date('2026-01-15T10:00:00Z');
}

function seqId(): (prefix: string) => string {
  let n = 0;
  return (prefix: string) => `${prefix}_${++n}`;
}

async function makePath(
  overrides: Partial<Parameters<ReturnType<typeof createTrainingGenerator>['generateTrainingPath']>[0]> = {}
): Promise<TrainingPath> {
  // Each generator call uses its own monotonically-unique id factory so
  // two paths made in sequence never collide, regardless of topic/tenant.
  const gen = createTrainingGenerator({ now: fixedNow });
  return gen.generateTrainingPath({
    topic: 'arrears ladder onboarding',
    audience: 'estate-officers',
    durationHours: 1,
    language: 'en',
    tenantId: TEN_A,
    createdBy: ADMIN,
    ...overrides,
  });
}

describe('TrainingGenerator', () => {
  it('produces a path for arrears-ladder / estate-officer audience', async () => {
    const p = await makePath();
    expect(p.tenantId).toBe(TEN_A);
    expect(p.audience).toBe('estate-officers');
    expect(p.steps.length).toBeGreaterThan(0);
    expect(p.conceptIds.length).toBeGreaterThan(0);
    expect(p.steps.every((s) => s.masteryThreshold === 0.8)).toBe(true);
  });

  it('orders steps with index starting at 0 and monotonically increasing', async () => {
    const p = await makePath();
    p.steps.forEach((s, i) => expect(s.orderIndex).toBe(i));
  });

  it('honours durationHours by matching total estimated minutes roughly', async () => {
    const p = await makePath({ durationHours: 2 });
    const total = p.steps.reduce((a, s) => a + s.estimatedMinutes, 0);
    expect(total).toBeGreaterThanOrEqual(20);
  });

  it('generates Swahili prompts when language is sw', async () => {
    const p = await makePath({ language: 'sw' });
    const first = p.steps[0];
    expect(first.content.socraticPrompts.length).toBeGreaterThan(0);
    expect(first.content.socraticPrompts[0]).toMatch(/Habari|tujifunze/);
  });

  it('rejects empty topic', async () => {
    const gen = createTrainingGenerator();
    await expect(
      gen.generateTrainingPath({
        topic: '   ',
        audience: 'caretakers',
        durationHours: 1,
        language: 'en',
        tenantId: TEN_A,
        createdBy: ADMIN,
      })
    ).rejects.toThrow(/topic/);
  });

  it('rejects zero / negative durationHours', async () => {
    const gen = createTrainingGenerator();
    await expect(
      gen.generateTrainingPath({
        topic: 'arrears',
        audience: 'estate-officers',
        durationHours: 0,
        language: 'en',
        tenantId: TEN_A,
        createdBy: ADMIN,
      })
    ).rejects.toThrow(/duration/);
  });

  it('de-prioritises already-mastered concepts', async () => {
    const gen = createTrainingGenerator({ idFactory: seqId() });
    const p = await gen.generateTrainingPath({
      topic: 'rent affordability',
      audience: 'estate-officers',
      durationHours: 1,
      language: 'en',
      priorMastery: { rent_affordability: 0.95 },
      tenantId: TEN_A,
      createdBy: ADMIN,
    });
    // a deprioritised-but-still-relevant concept may still be included, but
    // the first step should not be rent_affordability
    expect(p.steps[0].conceptId).not.toBe('rent_affordability');
  });
});

describe('Repository idempotency + isolation', () => {
  it('upserts paths idempotently by (tenantId, topic, audience)', async () => {
    const repo = createInMemoryTrainingRepository();
    const p1 = await makePath();
    const saved1 = await repo.upsertPath(p1);
    const p2 = await makePath();
    const saved2 = await repo.upsertPath({ ...p2, title: 'changed' });
    expect(saved1.id).toBe(saved2.id);
    expect(saved2.title).toBe('changed');
  });

  it('blocks cross-tenant path reads', async () => {
    const repo = createInMemoryTrainingRepository();
    const p = await makePath();
    await repo.upsertPath(p);
    await expect(repo.getPath(TEN_B, p.id)).rejects.toBeInstanceOf(
      TenantMismatchError
    );
  });

  it('list only returns the tenant’s own paths', async () => {
    const repo = createInMemoryTrainingRepository();
    await repo.upsertPath(await makePath());
    await repo.upsertPath(await makePath({ tenantId: TEN_B, topic: 'onboarding' }));
    const rowsA = await repo.listPaths(TEN_A);
    const rowsB = await repo.listPaths(TEN_B);
    expect(rowsA.length).toBe(1);
    expect(rowsB.length).toBe(1);
    expect(rowsA[0].tenantId).toBe(TEN_A);
  });

  it('updatePath reorders and regenerates step ids', async () => {
    const repo = createInMemoryTrainingRepository();
    const p = await repo.upsertPath(await makePath());
    const updated = await repo.updatePath(
      TEN_A,
      p.id,
      {
        title: 'Edited',
        steps: [
          {
            conceptId: p.steps[1].conceptId,
            kind: 'lesson',
            title: 'Reordered A',
            content: { socraticPrompts: ['q1'] },
          },
          {
            conceptId: p.steps[0].conceptId,
            kind: 'quiz',
            title: 'Reordered B',
            content: { socraticPrompts: ['q2'] },
          },
        ],
      },
      seqId()
    );
    expect(updated.title).toBe('Edited');
    expect(updated.steps.length).toBe(2);
    expect(updated.steps[0].title).toBe('Reordered A');
  });
});

describe('TrainingAssignmentService', () => {
  it('creates assignments and publishes a training.assigned event', async () => {
    const repo = createInMemoryTrainingRepository();
    const path = await repo.upsertPath(await makePath());
    const events: Array<{ type: string }> = [];
    const bus: TrainingEventPublisher = {
      publish(evt) {
        events.push({ type: evt.type });
      },
    };
    const svc = createTrainingAssignmentService({ repo, eventBus: bus });
    const assignments = await svc.assignTraining({
      pathId: path.id,
      tenantId: TEN_A,
      assigneeUserIds: ['u-1', 'u-2'],
      dueAt: new Date('2026-02-01T00:00:00Z'),
      assignedBy: ADMIN,
    });
    expect(assignments.length).toBe(2);
    expect(events.filter((e) => e.type === 'training.assigned').length).toBe(2);
  });

  it('blocks cross-tenant assignments', async () => {
    const repo = createInMemoryTrainingRepository();
    const path = await repo.upsertPath(await makePath());
    const svc = createTrainingAssignmentService({ repo });
    // Trying to assign a tenant-A path from tenant-B context must fail with
    // either TenantMismatchError (path visible but wrong tenant) or
    // TrainingNotFoundError (path hidden from tenant B).
    await expect(
      svc.assignTraining({
        pathId: path.id,
        tenantId: TEN_B,
        assigneeUserIds: ['u-3'],
        assignedBy: ADMIN,
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/TENANT_MISMATCH|NOT_FOUND/) });
  });

  it('feature-flag off blocks assignment', async () => {
    const repo = createInMemoryTrainingRepository();
    const path = await repo.upsertPath(await makePath());
    const flags: FeatureFlagLike = {
      isEnabled: () => false,
    };
    const svc = createTrainingAssignmentService({ repo, featureFlags: flags });
    await expect(
      svc.assignTraining({
        pathId: path.id,
        tenantId: TEN_A,
        assigneeUserIds: ['u-1'],
        assignedBy: ADMIN,
      })
    ).rejects.toBeInstanceOf(TrainingDisabledError);
  });

  it('force-complete stamps completedAt and publishes an event', async () => {
    const repo = createInMemoryTrainingRepository();
    const path = await repo.upsertPath(await makePath());
    const events: string[] = [];
    const svc = createTrainingAssignmentService({
      repo,
      eventBus: { publish: (e) => void events.push(e.type) },
    });
    const [a] = await svc.assignTraining({
      pathId: path.id,
      tenantId: TEN_A,
      assigneeUserIds: ['u-5'],
      assignedBy: ADMIN,
    });
    const done = await svc.forceComplete(TEN_A, a.id, ADMIN);
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeTruthy();
    expect(events).toContain('training.force_completed');
  });
});

describe('TrainingDeliveryService', () => {
  function buildPipeline(mastery: Record<string, number> = {}) {
    const repo = createInMemoryTrainingRepository();
    const port: MasteryPort = {
      async getMastery() {
        return mastery;
      },
    };
    const delivery = createTrainingDeliveryService({ repo, mastery: port });
    return { repo, delivery, port };
  }

  it('returns next un-mastered step for an assignee', async () => {
    const { repo, delivery } = buildPipeline();
    const path = await repo.upsertPath(await makePath());
    await repo.createAssignment({
      id: 'a-1',
      tenantId: TEN_A,
      pathId: path.id,
      assigneeUserId: 'u-10',
      assignedBy: ADMIN,
      assignedAt: new Date().toISOString(),
      dueAt: null,
      status: 'pending',
      completedAt: null,
      progressPct: 0,
      lastDeliveredStep: null,
    });
    const next = await delivery.getNextTrainingStep(TEN_A, 'u-10');
    expect(next).not.toBeNull();
    expect(next!.step.orderIndex).toBe(0);
    expect(next!.greeting).toContain('training');
  });

  it('skips steps whose concept mastery already exceeds threshold', async () => {
    const path = await makePath();
    const mastery = Object.fromEntries(
      path.conceptIds.slice(0, 2).map((c) => [c, 0.95])
    );
    const { repo, delivery } = buildPipeline(mastery);
    await repo.upsertPath(path);
    await repo.createAssignment({
      id: 'a-2',
      tenantId: TEN_A,
      pathId: path.id,
      assigneeUserId: 'u-20',
      assignedBy: ADMIN,
      assignedAt: new Date().toISOString(),
      dueAt: null,
      status: 'pending',
      completedAt: null,
      progressPct: 0,
      lastDeliveredStep: null,
    });
    const next = await delivery.getNextTrainingStep(TEN_A, 'u-20');
    // first two concepts are mastered; delivery should pick order index >= 2
    // (or null if all are mastered)
    if (next) expect(next.step.orderIndex).toBeGreaterThanOrEqual(2);
  });

  it('auto-completes an assignment when all concepts mastered', async () => {
    const path = await makePath();
    const mastery = Object.fromEntries(path.conceptIds.map((c) => [c, 0.99]));
    const { repo, delivery } = buildPipeline(mastery);
    await repo.upsertPath(path);
    await repo.createAssignment({
      id: 'a-3',
      tenantId: TEN_A,
      pathId: path.id,
      assigneeUserId: 'u-30',
      assignedBy: ADMIN,
      assignedAt: new Date().toISOString(),
      dueAt: null,
      status: 'pending',
      completedAt: null,
      progressPct: 0,
      lastDeliveredStep: null,
    });
    const next = await delivery.getNextTrainingStep(TEN_A, 'u-30');
    expect(next).toBeNull();
    const assignment = await repo.getAssignment(TEN_A, 'a-3');
    expect(assignment?.status).toBe('completed');
    expect(assignment?.completedAt).toBeTruthy();
  });

  it('records delivery events and flips status pending → in_progress', async () => {
    const path = await makePath();
    const { repo, delivery } = buildPipeline();
    await repo.upsertPath(path);
    const a = await repo.createAssignment({
      id: 'a-4',
      tenantId: TEN_A,
      pathId: path.id,
      assigneeUserId: 'u-40',
      assignedBy: ADMIN,
      assignedAt: new Date().toISOString(),
      dueAt: null,
      status: 'pending',
      completedAt: null,
      progressPct: 0,
      lastDeliveredStep: null,
    });
    await delivery.recordDelivery(TEN_A, a.id, path.steps[0].id, 'step_started');
    const after = await repo.getAssignment(TEN_A, a.id);
    expect(after?.status).toBe('in_progress');
    expect(after?.lastDeliveredStep).toBe(path.steps[0].id);
  });

  it('refreshProgress returns fractional progress from mastery map', async () => {
    const path = await makePath();
    const mastery: Record<string, number> = {};
    mastery[path.conceptIds[0]] = 0.95;
    const { repo, delivery } = buildPipeline(mastery);
    await repo.upsertPath(path);
    await repo.createAssignment({
      id: 'a-5',
      tenantId: TEN_A,
      pathId: path.id,
      assigneeUserId: 'u-50',
      assignedBy: ADMIN,
      assignedAt: new Date().toISOString(),
      dueAt: null,
      status: 'pending',
      completedAt: null,
      progressPct: 0,
      lastDeliveredStep: null,
    });
    const updated = await delivery.refreshProgress(TEN_A, 'a-5');
    expect(updated.progressPct).toBeGreaterThan(0);
    expect(updated.progressPct).toBeLessThan(1);
  });

  it('detects stall when last event is older than threshold', async () => {
    const path = await makePath();
    const repo = createInMemoryTrainingRepository();
    const port: MasteryPort = { async getMastery() { return {}; } };
    let clock = new Date('2026-01-01T00:00:00Z');
    const delivery = createTrainingDeliveryService({
      repo,
      mastery: port,
      now: () => clock,
      stallThresholdMs: 10_000,
    });
    await repo.upsertPath(path);
    const a = await repo.createAssignment({
      id: 'a-6',
      tenantId: TEN_A,
      pathId: path.id,
      assigneeUserId: 'u-60',
      assignedBy: ADMIN,
      assignedAt: clock.toISOString(),
      dueAt: null,
      status: 'in_progress',
      completedAt: null,
      progressPct: 0,
      lastDeliveredStep: null,
    });
    await delivery.recordDelivery(TEN_A, a.id, path.steps[0].id, 'step_started');
    clock = new Date(clock.getTime() + 30_000);
    const stalled = await delivery.isStalled(TEN_A, a.id, path.steps[0].id);
    expect(stalled).toBe(true);
  });
});

describe('TrainingAdminEndpoints (router facade)', () => {
  function buildEndpoints() {
    const repo = createInMemoryTrainingRepository();
    const generator = createTrainingGenerator();
    const mastery: MasteryPort = { async getMastery() { return {}; } };
    const delivery = createTrainingDeliveryService({ repo, mastery });
    const assignmentService = createTrainingAssignmentService({ repo });
    const endpoints = createTrainingAdminEndpoints({
      generator,
      assignmentService,
      deliveryService: delivery,
      repo,
    });
    return { repo, endpoints };
  }

  it('generate → persist → list round-trip', async () => {
    const { endpoints } = buildEndpoints();
    const generated = await endpoints.generate(TEN_A, ADMIN, {
      topic: 'arrears ladder',
      audience: 'estate-officers',
      durationHours: 1,
      language: 'en',
    });
    const saved = await endpoints.persistPath(TEN_A, ADMIN, {
      path: {
        title: generated.title,
        topic: generated.topic,
        audience: generated.audience,
        language: generated.language,
        durationMinutes: generated.durationMinutes,
        conceptIds: [...generated.conceptIds],
        summary: generated.summary,
        steps: generated.steps.map((s) => ({
          conceptId: s.conceptId,
          kind: s.kind,
          title: s.title,
          content: {
            socraticPrompts: s.content.socraticPrompts.slice(),
          },
          masteryThreshold: s.masteryThreshold,
          estimatedMinutes: s.estimatedMinutes,
        })),
      },
    });
    const list = await endpoints.listPaths(TEN_A);
    expect(list.some((p) => p.id === saved.id)).toBe(true);
  });

  it('rejects malformed generate input', async () => {
    const { endpoints } = buildEndpoints();
    await expect(
      endpoints.generate(TEN_A, ADMIN, {
        topic: 'x',
        audience: 'estate-officers',
        durationHours: 1,
        language: 'en',
      })
    ).rejects.toBeTruthy();
  });

  it('mark-complete force-closes an assignment', async () => {
    const { repo, endpoints } = buildEndpoints();
    const path = await repo.upsertPath(await makePath());
    const [assigned] = await endpoints.assign(TEN_A, path.id, ADMIN, {
      assigneeUserIds: ['u-100'],
    });
    const done = await endpoints.markAssignmentComplete(
      TEN_A,
      assigned.id,
      ADMIN
    );
    expect(done.status).toBe('completed');
  });

  it('getUserMastery rejects cross-tenant reads', async () => {
    const { endpoints } = buildEndpoints();
    await expect(
      endpoints.getUserMastery(TEN_B, 'u-whoever', TEN_A)
    ).rejects.toBeInstanceOf(TenantMismatchError);
  });

  it('getNextStep returns null when no pending assignments', async () => {
    const { endpoints } = buildEndpoints();
    const next = await endpoints.getNextStep(TEN_A, 'u-nobody');
    expect(next).toBeNull();
  });
});
