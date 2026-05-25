/**
 * Interactive Report Service (NEW 17)
 *
 * - compile(): builds ReportData from findings + action plans, delegates
 *   to InteractiveHtmlGenerator, persists the bundle via storage port,
 *   writes a versioned row to the repository, and returns the signed URL.
 * - acknowledge(): records an ack + dispatches the action via
 *   ActionPlanHandler, updating the plan status to `acknowledged`.
 *
 * All repositories / storage / creators are injected — the service is
 * immutable and free of IO concerns.
 */

import { createHash, randomBytes } from 'node:crypto';
import { InteractiveHtmlGenerator } from '../generators/interactive-html-generator.js';
import type { ReportData } from '../generators/generator.interface.js';
import { ActionPlanHandler } from './action-plan-handler.js';
import type {
  ActionAckInput,
  ActionAckResult,
  ActionPlan,
  InteractiveReportInput,
  InteractiveReportStorage,
  InteractiveReportVersion,
  InteractiveReportVersionRepository,
  WorkOrderCreator,
  ApprovalRequestCreator,
} from './types.js';

export interface InteractiveReportServiceDeps {
  readonly repository: InteractiveReportVersionRepository;
  readonly storage: InteractiveReportStorage;
  readonly workOrderCreator?: WorkOrderCreator;
  readonly approvalRequestCreator?: ApprovalRequestCreator;
  /** Path template for POST endpoint; must include "{id}". */
  readonly actionPlanPostPath?: string;
  /** TTL for signed URLs in seconds (default 1h). */
  readonly signedUrlTtlSeconds?: number;
  /** Clock override for tests. */
  readonly now?: () => Date;
  /** ID generator override for tests. */
  readonly generateId?: () => string;
}

export const InteractiveReportServiceError = {
  NOT_FOUND: 'NOT_FOUND',
  ACTION_PLAN_NOT_FOUND: 'ACTION_PLAN_NOT_FOUND',
  CROSS_TENANT: 'CROSS_TENANT',
} as const;

export type InteractiveReportServiceErrorCode =
  (typeof InteractiveReportServiceError)[keyof typeof InteractiveReportServiceError];

export class InteractiveReportServiceException extends Error {
  constructor(
    public readonly code: InteractiveReportServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'InteractiveReportServiceException';
  }
}

function defaultId(): string {
  return `irv_${Date.now()}_${randomBytes(4).toString('hex')}`;
}

export class InteractiveReportService {
  private readonly generator = new InteractiveHtmlGenerator();
  private readonly handler: ActionPlanHandler;
  private readonly now: () => Date;
  private readonly generateId: () => string;

  constructor(private readonly deps: InteractiveReportServiceDeps) {
    this.handler = new ActionPlanHandler({
      workOrderCreator: deps.workOrderCreator,
      approvalRequestCreator: deps.approvalRequestCreator,
    });
    this.now = deps.now ?? (() => new Date());
    this.generateId = deps.generateId ?? defaultId;
  }

  async compile(
    input: InteractiveReportInput
  ): Promise<InteractiveReportVersion> {
    const previous = await this.deps.repository.findLatestByReportInstance(
      input.tenantId,
      input.reportInstanceId
    );
    const nextVersion = (previous?.version ?? 0) + 1;
    const versionId = this.generateId();

    const data: ReportData = {
      sections: input.findings.map((f) => ({
        title: f.title,
        content: f.body,
      })),
    };

    const html = (await this.generator.generate(
      {
        title: input.title,
        subtitle: input.subtitle,
        generatedAt: this.now(),
        media: input.media,
        actionPlans: input.actionPlans,
        interactiveReportVersionId: versionId,
        actionPlanPostPath: this.deps.actionPlanPostPath,
      },
      data
    )) as string;

    const ttl = this.deps.signedUrlTtlSeconds ?? 3600;
    const { signedUrl, key, expiresAt } = await this.deps.storage.putHtmlBundle(
      {
        tenantId: input.tenantId,
        reportInstanceId: input.reportInstanceId,
        version: nextVersion,
        html,
        expiresInSeconds: ttl,
      }
    );

    const version: InteractiveReportVersion = {
      id: versionId,
      tenantId: input.tenantId,
      reportInstanceId: input.reportInstanceId,
      version: nextVersion,
      renderKind: input.renderKind ?? 'html_bundle',
      mediaReferences: input.media,
      actionPlans: input.actionPlans,
      signedUrl,
      signedUrlKey: key,
      expiresAt,
      contentHash: createHash('sha256').update(html).digest('hex'),
      generatedAt: this.now().toISOString(),
      generatedBy: input.generatedBy ?? null,
    };

    return this.deps.repository.save(version);
  }

  async getLatest(
    tenantId: string,
    reportInstanceId: string
  ): Promise<InteractiveReportVersion | null> {
    return this.deps.repository.findLatestByReportInstance(
      tenantId,
      reportInstanceId
    );
  }

  async acknowledge(input: ActionAckInput): Promise<ActionAckResult> {
    const version = await this.deps.repository.findById(
      input.tenantId,
      input.interactiveReportVersionId
    );
    if (!version) {
      throw new InteractiveReportServiceException(
        InteractiveReportServiceError.NOT_FOUND,
        'Interactive report version not found'
      );
    }
    if (version.tenantId !== input.tenantId) {
      throw new InteractiveReportServiceException(
        InteractiveReportServiceError.CROSS_TENANT,
        'Interactive report belongs to another tenant'
      );
    }
    const plan = version.actionPlans.find(
      (p: ActionPlan) => p.id === input.actionPlanId
    );
    if (!plan) {
      throw new InteractiveReportServiceException(
        InteractiveReportServiceError.ACTION_PLAN_NOT_FOUND,
        'Action plan not found on this report version'
      );
    }

    const dispatch = await this.handler.handle({
      tenantId: input.tenantId,
      acknowledgedBy: input.acknowledgedBy,
      plan,
    });

    const ackId = this.generateId().replace(/^irv_/, 'ack_');
    await this.deps.repository.recordAck({
      id: ackId,
      tenantId: input.tenantId,
      interactiveReportVersionId: version.id,
      actionPlanId: plan.id,
      resolution: dispatch.resolution,
      resolutionRefId: dispatch.resolutionRefId,
      acknowledgedBy: input.acknowledgedBy,
      metadata: input.metadata ?? {},
    });

    return {
      ackId,
      resolution: dispatch.resolution,
      resolutionRefId: dispatch.resolutionRefId,
    };
  }
}
