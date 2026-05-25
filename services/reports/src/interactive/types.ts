/**
 * Interactive Report Types (NEW 17)
 *
 * Shared types for the interactive-html-generator and
 * interactive-report-service.
 */

export type InteractiveReportRenderKind =
  | 'html_bundle'
  | 'html_with_video'
  | 'html_with_charts'
  | 'print_pdf_fallback';

export interface MediaReference {
  readonly id: string;
  readonly kind: 'image' | 'video' | 'chart' | 'audio';
  /** Storage key (S3-style path). */
  readonly storageKey: string;
  /** Pre-signed URL for temporary access. */
  readonly signedUrl: string;
  /** Poster/thumbnail key (videos). */
  readonly posterKey?: string;
  /** Caption to render under the media. */
  readonly caption?: string;
  /** MIME type for correct embedding. */
  readonly mimeType?: string;
}

export type ActionPlanActionKind =
  | 'create_work_order'
  | 'create_approval_request'
  | 'acknowledge'
  | 'external_link';

export interface ActionPlanAction {
  readonly kind: ActionPlanActionKind;
  /** Arbitrary payload forwarded to the handler. */
  readonly payload: Readonly<Record<string, unknown>>;
}

export type ActionPlanStatus =
  | 'pending'
  | 'acknowledged'
  | 'resolved'
  | 'dismissed';

export interface ActionPlan {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  readonly action: ActionPlanAction;
  readonly status: ActionPlanStatus;
  readonly createdAt: string;
}

export interface InteractiveReportVersion {
  readonly id: string;
  readonly tenantId: string;
  readonly reportInstanceId: string;
  readonly version: number;
  readonly renderKind: InteractiveReportRenderKind;
  readonly mediaReferences: readonly MediaReference[];
  readonly actionPlans: readonly ActionPlan[];
  readonly signedUrl: string | null;
  readonly signedUrlKey: string | null;
  readonly expiresAt: string | null;
  readonly contentHash: string | null;
  readonly generatedAt: string;
  readonly generatedBy: string | null;
}

export interface InteractiveReportInput {
  readonly tenantId: string;
  readonly reportInstanceId: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly findings: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly mediaIds?: readonly string[];
  }>;
  readonly media: readonly MediaReference[];
  readonly actionPlans: readonly ActionPlan[];
  readonly renderKind?: InteractiveReportRenderKind;
  readonly generatedBy?: string;
}

export interface ActionAckInput {
  readonly tenantId: string;
  readonly interactiveReportVersionId: string;
  readonly actionPlanId: string;
  readonly acknowledgedBy: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ActionAckResult {
  readonly ackId: string;
  readonly resolution: string;
  readonly resolutionRefId: string | null;
}

/** Ports — wired from the application layer, not imported cross-service. */
export interface WorkOrderCreator {
  create(input: {
    tenantId: string;
    createdBy: string;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<{ workOrderId: string }>;
}

export interface ApprovalRequestCreator {
  create(input: {
    tenantId: string;
    requesterId: string;
    payload: Readonly<Record<string, unknown>>;
  }): Promise<{ approvalRequestId: string }>;
}

export interface InteractiveReportStorage {
  /**
   * Persist the generated HTML bundle and return a signed URL + key.
   */
  putHtmlBundle(input: {
    tenantId: string;
    reportInstanceId: string;
    version: number;
    html: string;
    expiresInSeconds: number;
  }): Promise<{ signedUrl: string; key: string; expiresAt: string }>;
}

export interface InteractiveReportVersionRepository {
  save(version: InteractiveReportVersion): Promise<InteractiveReportVersion>;
  findById(
    tenantId: string,
    id: string
  ): Promise<InteractiveReportVersion | null>;
  findLatestByReportInstance(
    tenantId: string,
    reportInstanceId: string
  ): Promise<InteractiveReportVersion | null>;
  recordAck(input: {
    id: string;
    tenantId: string;
    interactiveReportVersionId: string;
    actionPlanId: string;
    resolution: string;
    resolutionRefId: string | null;
    acknowledgedBy: string;
    metadata: Readonly<Record<string, unknown>>;
  }): Promise<void>;
}
