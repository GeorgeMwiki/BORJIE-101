/**
 * Letter Service
 *
 * On-demand tenant letter workflow (NEW 10):
 *   1. createRequest()  — capture tenant's ask
 *   2. draft()          — materialize a draft via template + renderer
 *   3. approve()        — landlord/admin approves; transitions to issued
 *   4. reject()         — captures rejection reason
 *   5. download()       — returns the signed URL for the issued doc
 *
 * Integrates with ApprovalService (via a pluggable interface) and uses
 * the document renderer infrastructure for content generation.
 *
 * Immutability: every state transition returns a new record rather than
 * mutating in place.
 */

import { randomHex } from '../../common/id-generator.js';
import type { TenantId, UserId } from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import type { Result } from '@borjie/domain-models';
import type { IDocumentRenderer } from '../renderers/renderer-interface.js';
import {
  generateResidencyProof,
  type ResidencyProofTemplateData,
  RESIDENCY_PROOF_TEMPLATE_ID,
} from '../templates/residency-proof.template.js';
import {
  generateTenancyConfirmation,
  type TenancyConfirmationTemplateData,
  TENANCY_CONFIRMATION_TEMPLATE_ID,
} from '../templates/tenancy-confirmation.template.js';
import {
  generatePaymentConfirmation,
  type PaymentConfirmationTemplateData,
  PAYMENT_CONFIRMATION_TEMPLATE_ID,
} from '../templates/payment-confirmation.template.js';
import {
  generateTenantReference,
  type TenantReferenceTemplateData,
  TENANT_REFERENCE_TEMPLATE_ID,
} from '../templates/tenant-reference.template.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LetterType =
  | 'residency_proof'
  | 'tenancy_confirmation'
  | 'payment_confirmation'
  | 'tenant_reference';

export type LetterStatus =
  | 'requested'
  | 'drafted'
  | 'pending_approval'
  | 'approved'
  | 'issued'
  | 'rejected'
  | 'cancelled';

export type LetterPayload =
  | { type: 'residency_proof'; data: ResidencyProofTemplateData }
  | { type: 'tenancy_confirmation'; data: TenancyConfirmationTemplateData }
  | { type: 'payment_confirmation'; data: PaymentConfirmationTemplateData }
  | { type: 'tenant_reference'; data: TenantReferenceTemplateData };

export interface LetterRequestRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly customerId?: string;
  readonly letterType: LetterType;
  readonly status: LetterStatus;
  readonly requestPayload: Record<string, unknown>;
  readonly draftContent?: string;
  readonly renderJobId?: string;
  readonly approvalId?: string;
  readonly approvedBy?: UserId;
  readonly approvedAt?: string;
  readonly rejectionReason?: string;
  readonly issuedDocumentId?: string;
  readonly issuedAt?: string;
  readonly requestedBy: UserId;
  readonly requestedAt: string;
  readonly updatedAt: string;
}

export interface ILetterRepository {
  create(rec: LetterRequestRecord): Promise<LetterRequestRecord>;
  findById(id: string, tenantId: TenantId): Promise<LetterRequestRecord | null>;
  update(rec: LetterRequestRecord): Promise<LetterRequestRecord>;
}

export interface IApprovalPort {
  requestApproval(input: {
    tenantId: TenantId;
    kind: 'letter';
    entityId: string;
    requestedBy: UserId;
    summary: string;
  }): Promise<{ approvalId: string }>;
}

export interface ISignedUrlPort {
  getSignedUrl(tenantId: TenantId, documentId: string, expiresIn: number): Promise<string>;
}

export const LetterServiceError = {
  NOT_FOUND: 'LETTER_NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  INVALID_STATE: 'INVALID_STATE',
  RENDER_FAILED: 'RENDER_FAILED',
  APPROVAL_FAILED: 'APPROVAL_FAILED',
} as const;

export type LetterServiceErrorCode =
  (typeof LetterServiceError)[keyof typeof LetterServiceError];

export interface LetterServiceErrorResult {
  readonly code: LetterServiceErrorCode;
  readonly message: string;
}

export interface LetterServiceOptions {
  readonly repository: ILetterRepository;
  readonly renderer: IDocumentRenderer;
  readonly approval?: IApprovalPort;
  readonly signedUrl?: ISignedUrlPort;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LetterService {
  constructor(private readonly options: LetterServiceOptions) {}

  /** Step 1 — create a new letter request in 'requested' state. */
  async createRequest(input: {
    tenantId: TenantId;
    letterType: LetterType;
    customerId?: string;
    requestedBy: UserId;
    payload: Record<string, unknown>;
  }): Promise<Result<LetterRequestRecord, LetterServiceErrorResult>> {
    if (!input.letterType) {
      return err({ code: LetterServiceError.INVALID_INPUT, message: 'letterType required' });
    }
    const now = new Date().toISOString();
    const rec: LetterRequestRecord = {
      id: `lr_${Date.now()}_${randomHex(4)}`,
      tenantId: input.tenantId,
      ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
      letterType: input.letterType,
      status: 'requested',
      requestPayload: input.payload,
      requestedBy: input.requestedBy,
      requestedAt: now,
      updatedAt: now,
    };
    const saved = await this.options.repository.create(rec);
    return ok(saved);
  }

  /** Step 2 — render the draft using the appropriate template + renderer. */
  async draft(
    letterId: string,
    tenantId: TenantId,
    payload: LetterPayload
  ): Promise<Result<LetterRequestRecord, LetterServiceErrorResult>> {
    const existing = await this.options.repository.findById(letterId, tenantId);
    if (!existing) {
      return err({ code: LetterServiceError.NOT_FOUND, message: 'letter request not found' });
    }
    if (existing.status !== 'requested' && existing.status !== 'drafted') {
      return err({
        code: LetterServiceError.INVALID_STATE,
        message: `cannot draft from status '${existing.status}'`,
      });
    }

    let draftContent: string;
    let templateId: string;
    let templateVersion = '1';

    try {
      switch (payload.type) {
        case 'residency_proof':
          draftContent = generateResidencyProof(payload.data);
          templateId = RESIDENCY_PROOF_TEMPLATE_ID;
          break;
        case 'tenancy_confirmation':
          draftContent = generateTenancyConfirmation(payload.data);
          templateId = TENANCY_CONFIRMATION_TEMPLATE_ID;
          break;
        case 'payment_confirmation':
          draftContent = generatePaymentConfirmation(payload.data);
          templateId = PAYMENT_CONFIRMATION_TEMPLATE_ID;
          break;
        case 'tenant_reference':
          draftContent = generateTenantReference(payload.data);
          templateId = TENANT_REFERENCE_TEMPLATE_ID;
          break;
        default: {
          const _exhaust: never = payload;
          return err({
            code: LetterServiceError.INVALID_INPUT,
            message: `unknown letter payload: ${JSON.stringify(_exhaust)}`,
          });
        }
      }
    } catch (e) {
      return err({
        code: LetterServiceError.RENDER_FAILED,
        message: e instanceof Error ? e.message : 'draft render failed',
      });
    }

    // Also invoke the renderer to capture mime/buffer for storage (best-effort).
    try {
      await this.options.renderer.render(
        {
          id: templateId,
          version: templateVersion,
          source: { generate: () => draftContent },
        },
        {}
      );
    } catch {
      // Renderer is advisory here; we still persist the raw content.
    }

    const now = new Date().toISOString();
    const updated: LetterRequestRecord = {
      ...existing,
      draftContent,
      status: 'drafted',
      updatedAt: now,
    };
    const saved = await this.options.repository.update(updated);
    return ok(saved);
  }

  /** Request approval — transitions drafted → pending_approval. */
  async submitForApproval(
    letterId: string,
    tenantId: TenantId,
    requestedBy: UserId
  ): Promise<Result<LetterRequestRecord, LetterServiceErrorResult>> {
    const existing = await this.options.repository.findById(letterId, tenantId);
    if (!existing) {
      return err({ code: LetterServiceError.NOT_FOUND, message: 'letter request not found' });
    }
    if (existing.status !== 'drafted') {
      return err({
        code: LetterServiceError.INVALID_STATE,
        message: `cannot submit for approval from status '${existing.status}'`,
      });
    }
    if (!this.options.approval) {
      return err({
        code: LetterServiceError.APPROVAL_FAILED,
        message: 'approval port not configured',
      });
    }

    const { approvalId } = await this.options.approval.requestApproval({
      tenantId,
      kind: 'letter',
      entityId: letterId,
      requestedBy,
      summary: `Letter ${existing.letterType} for ${existing.customerId ?? 'tenant'}`,
    });

    const updated: LetterRequestRecord = {
      ...existing,
      status: 'pending_approval',
      approvalId,
      updatedAt: new Date().toISOString(),
    };
    const saved = await this.options.repository.update(updated);
    return ok(saved);
  }

  /** Step 3 — approve & issue the letter, linking to an issued document. */
  async approve(
    letterId: string,
    tenantId: TenantId,
    approvedBy: UserId,
    issuedDocumentId: string
  ): Promise<Result<LetterRequestRecord, LetterServiceErrorResult>> {
    const existing = await this.options.repository.findById(letterId, tenantId);
    if (!existing) {
      return err({ code: LetterServiceError.NOT_FOUND, message: 'letter request not found' });
    }
    if (existing.status !== 'pending_approval' && existing.status !== 'drafted') {
      return err({
        code: LetterServiceError.INVALID_STATE,
        message: `cannot approve from status '${existing.status}'`,
      });
    }
    const now = new Date().toISOString();
    const updated: LetterRequestRecord = {
      ...existing,
      status: 'issued',
      approvedBy,
      approvedAt: now,
      issuedDocumentId,
      issuedAt: now,
      updatedAt: now,
    };
    const saved = await this.options.repository.update(updated);
    return ok(saved);
  }

  async reject(
    letterId: string,
    tenantId: TenantId,
    reason: string
  ): Promise<Result<LetterRequestRecord, LetterServiceErrorResult>> {
    const existing = await this.options.repository.findById(letterId, tenantId);
    if (!existing) {
      return err({ code: LetterServiceError.NOT_FOUND, message: 'letter request not found' });
    }
    if (existing.status === 'issued') {
      return err({
        code: LetterServiceError.INVALID_STATE,
        message: 'cannot reject an issued letter',
      });
    }
    const now = new Date().toISOString();
    const updated: LetterRequestRecord = {
      ...existing,
      status: 'rejected',
      rejectionReason: reason,
      updatedAt: now,
    };
    const saved = await this.options.repository.update(updated);
    return ok(saved);
  }

  /** Step 4 — generate a time-limited download URL for the issued letter. */
  async download(
    letterId: string,
    tenantId: TenantId,
    expiresIn = 300
  ): Promise<Result<{ url: string }, LetterServiceErrorResult>> {
    const existing = await this.options.repository.findById(letterId, tenantId);
    if (!existing) {
      return err({ code: LetterServiceError.NOT_FOUND, message: 'letter request not found' });
    }
    if (existing.status !== 'issued' || !existing.issuedDocumentId) {
      return err({
        code: LetterServiceError.INVALID_STATE,
        message: 'letter has not been issued yet',
      });
    }
    if (!this.options.signedUrl) {
      return err({
        code: LetterServiceError.INVALID_INPUT,
        message: 'signed url port not configured',
      });
    }
    const url = await this.options.signedUrl.getSignedUrl(
      tenantId,
      existing.issuedDocumentId,
      expiresIn
    );
    return ok({ url });
  }
}
