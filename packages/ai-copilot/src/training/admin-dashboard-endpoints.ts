/**
 * Admin dashboard endpoint handlers for adaptive training.
 *
 * The api-gateway router (`routes/training.router.ts`) translates HTTP →
 * these framework-agnostic handlers; the handlers own validation and
 * orchestration across the repository, generator, assignment service, and
 * delivery service.
 */

import { z } from 'zod';
import type { TrainingGenerator } from './training-generator.js';
import type { TrainingAssignmentService } from './training-assignment-service.js';
import type { TrainingDeliveryService } from './training-delivery-service.js';
import type { TrainingRepository } from './training-repository.js';
import type {
  AssignTrainingInput,
  GenerateTrainingPathOpts,
  NextTrainingStep,
  PathEditInput,
  TrainingAssignment,
  TrainingAssignmentStatus,
  TrainingPath,
} from './training-types.js';
import {
  TenantMismatchError,
  TrainingNotFoundError,
} from './training-types.js';

export const TRAINING_AUDIENCES = [
  'station-masters',
  'estate-officers',
  'caretakers',
  'accountants',
  'owners',
  'tenants',
  'custom',
] as const;

export const GenerateSchema = z.object({
  topic: z.string().min(3).max(300),
  audience: z.enum(TRAINING_AUDIENCES),
  durationHours: z.number().positive().max(40),
  language: z.enum(['en', 'sw', 'both']),
  priorMastery: z.record(z.string(), z.number().min(0).max(1)).optional(),
});

export const PersistSchema = z.object({
  path: z.object({
    id: z.string().optional(),
    title: z.string().min(1).max(300),
    topic: z.string().min(1).max(300),
    audience: z.enum(TRAINING_AUDIENCES),
    language: z.enum(['en', 'sw', 'both']),
    durationMinutes: z.number().int().positive().max(40 * 60),
    conceptIds: z.array(z.string()).min(1).max(50),
    summary: z.string().max(2000).optional(),
    steps: z
      .array(
        z.object({
          conceptId: z.string().min(1),
          kind: z.enum([
            'lesson',
            'scenario',
            'quiz',
            'handout',
            'roleplay',
            'reflection',
          ]),
          title: z.string().min(1).max(300),
          content: z.record(z.string(), z.unknown()),
          masteryThreshold: z.number().min(0.1).max(1).optional(),
          estimatedMinutes: z.number().int().positive().max(480).optional(),
        })
      )
      .min(1)
      .max(50),
  }),
});

export const PatchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  summary: z.string().max(2000).optional(),
  durationMinutes: z.number().int().positive().max(40 * 60).optional(),
  steps: z
    .array(
      z.object({
        conceptId: z.string().min(1),
        kind: z.enum([
          'lesson',
          'scenario',
          'quiz',
          'handout',
          'roleplay',
          'reflection',
        ]),
        title: z.string().min(1).max(300),
        content: z.record(z.string(), z.unknown()),
        masteryThreshold: z.number().min(0.1).max(1).optional(),
        estimatedMinutes: z.number().int().positive().max(480).optional(),
      })
    )
    .max(50)
    .optional(),
});

export const AssignSchema = z.object({
  assigneeUserIds: z.array(z.string().min(1)).min(1).max(200),
  dueAt: z
    .string()
    .datetime()
    .optional()
    .transform((s) => (s ? new Date(s) : null)),
});

export const ListAssignmentsSchema = z
  .object({
    status: z
      .enum(['pending', 'in_progress', 'completed', 'abandoned', 'reassigned'])
      .optional(),
    assigneeUserId: z.string().min(1).optional(),
  })
  .optional();

export interface TrainingEndpointsDeps {
  readonly generator: TrainingGenerator;
  readonly assignmentService: TrainingAssignmentService;
  readonly deliveryService: TrainingDeliveryService;
  readonly repo: TrainingRepository;
  readonly idFactory?: (prefix: string) => string;
  readonly now?: () => Date;
}

function defaultId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export class TrainingAdminEndpoints {
  private readonly deps: TrainingEndpointsDeps;
  private readonly idFactory: (prefix: string) => string;
  private readonly now: () => Date;

  constructor(deps: TrainingEndpointsDeps) {
    this.deps = deps;
    this.idFactory = deps.idFactory ?? defaultId;
    this.now = deps.now ?? (() => new Date());
  }

  async generate(
    tenantId: string,
    createdBy: string,
    body: unknown
  ): Promise<TrainingPath> {
    const parsed = GenerateSchema.parse(body);
    const opts: GenerateTrainingPathOpts = {
      topic: parsed.topic,
      audience: parsed.audience,
      durationHours: parsed.durationHours,
      language: parsed.language,
      priorMastery: parsed.priorMastery,
      tenantId,
      createdBy,
    };
    return this.deps.generator.generateTrainingPath(opts);
  }

  async persistPath(
    tenantId: string,
    generatedBy: string,
    body: unknown
  ): Promise<TrainingPath> {
    const parsed = PersistSchema.parse(body);
    const base = parsed.path;
    const pathId = base.id ?? this.idFactory('tpath');
    const path: TrainingPath = {
      id: pathId,
      tenantId,
      title: base.title,
      topic: base.topic,
      audience: base.audience,
      language: base.language,
      durationMinutes: base.durationMinutes,
      conceptIds: base.conceptIds,
      summary: base.summary ?? '',
      generatedBy,
      steps: base.steps.map((s, i) => ({
        id: this.idFactory('tstep'),
        pathId,
        orderIndex: i,
        conceptId: s.conceptId,
        kind: s.kind,
        title: s.title,
        content: {
          socraticPrompts: Array.isArray(
            (s.content as { socraticPrompts?: unknown }).socraticPrompts
          )
            ? ((s.content as { socraticPrompts: string[] }).socraticPrompts)
            : [],
          scenario: (s.content as { scenario?: string }).scenario,
          handoutMarkdown: (s.content as { handoutMarkdown?: string })
            .handoutMarkdown,
          checkpointQuestion: (s.content as { checkpointQuestion?: string })
            .checkpointQuestion,
          expectedAnswer: (s.content as { expectedAnswer?: string })
            .expectedAnswer,
        },
        masteryThreshold: s.masteryThreshold ?? 0.8,
        estimatedMinutes: s.estimatedMinutes ?? 5,
      })),
      createdAt: this.now().toISOString(),
      updatedAt: this.now().toISOString(),
      deletedAt: null,
    };
    return this.deps.repo.upsertPath(path);
  }

  async listPaths(tenantId: string): Promise<readonly TrainingPath[]> {
    return this.deps.repo.listPaths(tenantId);
  }

  async editPath(
    tenantId: string,
    pathId: string,
    body: unknown
  ): Promise<TrainingPath> {
    const parsed = PatchSchema.parse(body);
    const edits: PathEditInput = {
      title: parsed.title,
      summary: parsed.summary,
      durationMinutes: parsed.durationMinutes,
      steps: parsed.steps?.map((s) => ({
        conceptId: s.conceptId,
        kind: s.kind,
        title: s.title,
        content: {
          socraticPrompts: Array.isArray(
            (s.content as { socraticPrompts?: unknown }).socraticPrompts
          )
            ? ((s.content as { socraticPrompts: string[] }).socraticPrompts)
            : [],
          scenario: (s.content as { scenario?: string }).scenario,
          handoutMarkdown: (s.content as { handoutMarkdown?: string })
            .handoutMarkdown,
          checkpointQuestion: (s.content as { checkpointQuestion?: string })
            .checkpointQuestion,
          expectedAnswer: (s.content as { expectedAnswer?: string })
            .expectedAnswer,
        },
        masteryThreshold: s.masteryThreshold,
        estimatedMinutes: s.estimatedMinutes,
      })),
    };
    return this.deps.repo.updatePath(tenantId, pathId, edits, this.idFactory);
  }

  async assign(
    tenantId: string,
    pathId: string,
    assignedBy: string,
    body: unknown
  ): Promise<readonly TrainingAssignment[]> {
    const parsed = AssignSchema.parse(body);
    const input: AssignTrainingInput = {
      tenantId,
      pathId,
      assigneeUserIds: parsed.assigneeUserIds,
      dueAt: parsed.dueAt ?? null,
      assignedBy,
    };
    return this.deps.assignmentService.assignTraining(input);
  }

  async listAssignments(
    tenantId: string,
    query: unknown
  ): Promise<readonly TrainingAssignment[]> {
    const parsed = ListAssignmentsSchema.parse(query ?? {});
    return this.deps.repo.listAssignments(tenantId, parsed);
  }

  async getAssignment(
    tenantId: string,
    id: string
  ): Promise<{
    readonly assignment: TrainingAssignment;
    readonly path: TrainingPath | null;
    readonly perConceptMastery: Readonly<Record<string, number>>;
  }> {
    const assignment = await this.deps.repo.getAssignment(tenantId, id);
    if (!assignment) throw new TrainingNotFoundError('assignment not found');
    const path = await this.deps.repo.getPath(tenantId, assignment.pathId);
    const mastery = await (
      this.deps.deliveryService as unknown as {
        mastery?: { getMastery: (t: string, u: string) => Promise<Readonly<Record<string, number>>> };
      }
    ).mastery?.getMastery?.(tenantId, assignment.assigneeUserId);
    return {
      assignment,
      path,
      perConceptMastery: mastery ?? {},
    };
  }

  async getUserMastery(
    tenantId: string,
    userId: string,
    callerTenantId: string
  ): Promise<Readonly<Record<string, number>>> {
    if (tenantId !== callerTenantId) throw new TenantMismatchError();
    const masteryPort = (
      this.deps.deliveryService as unknown as {
        mastery?: { getMastery: (t: string, u: string) => Promise<Readonly<Record<string, number>>> };
      }
    ).mastery;
    if (!masteryPort) return {};
    return masteryPort.getMastery(tenantId, userId);
  }

  async markAssignmentComplete(
    tenantId: string,
    assignmentId: string,
    actorUserId: string
  ): Promise<TrainingAssignment> {
    return this.deps.assignmentService.forceComplete(
      tenantId,
      assignmentId,
      actorUserId
    );
  }

  async getNextStep(
    tenantId: string,
    userId: string
  ): Promise<NextTrainingStep | null> {
    return this.deps.deliveryService.getNextTrainingStep(tenantId, userId);
  }

  async filterByStatus(
    tenantId: string,
    status: TrainingAssignmentStatus
  ): Promise<readonly TrainingAssignment[]> {
    return this.deps.repo.listAssignments(tenantId, { status });
  }
}

export function createTrainingAdminEndpoints(
  deps: TrainingEndpointsDeps
): TrainingAdminEndpoints {
  return new TrainingAdminEndpoints(deps);
}
