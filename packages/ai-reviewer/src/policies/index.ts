/**
 * Policy registry — single source of truth mapping WorkflowKind to its
 * PolicyRule implementation. Adding a new kind requires both a new
 * entry here AND a new value in `WORKFLOW_KINDS` in `../types.ts`;
 * TypeScript exhaustiveness on `Record<WorkflowKind, PolicyRule>`
 * forces both to stay in sync.
 */

import type { PolicyRule, WorkflowKind } from '../types.js';
import { parcelEditPolicy } from './parcel-edit-policy.js';
import { polygonDrawPolicy } from './polygon-draw-policy.js';
import { metadataUpdatePolicy } from './metadata-update-policy.js';
import { photoAddPolicy } from './photo-add-policy.js';
import { inspectionPolicy } from './inspection-policy.js';
import { newLeasePolicy } from './new-lease-policy.js';
import { maintenanceCompletionPolicy } from './maintenance-completion-policy.js';
import { documentUploadPolicy } from './document-upload-policy.js';
import { poApprovalPolicy } from './po-approval-policy.js';
import { requisitionSubmissionPolicy } from './requisition-submission-policy.js';

export const POLICY_REGISTRY: Readonly<
  Record<WorkflowKind, PolicyRule<Readonly<Record<string, unknown>>>>
> = Object.freeze({
  parcel_edit: parcelEditPolicy,
  polygon_draw: polygonDrawPolicy,
  metadata_update: metadataUpdatePolicy,
  photo_add: photoAddPolicy,
  inspection: inspectionPolicy,
  new_lease: newLeasePolicy,
  maintenance_completion: maintenanceCompletionPolicy,
  document_upload: documentUploadPolicy,
  po_approval: poApprovalPolicy,
  requisition_submission: requisitionSubmissionPolicy,
});

export function policyFor(
  kind: WorkflowKind,
): PolicyRule<Readonly<Record<string, unknown>>> {
  return POLICY_REGISTRY[kind];
}

export {
  parcelEditPolicy,
  polygonDrawPolicy,
  metadataUpdatePolicy,
  photoAddPolicy,
  inspectionPolicy,
  newLeasePolicy,
  maintenanceCompletionPolicy,
  documentUploadPolicy,
  poApprovalPolicy,
  requisitionSubmissionPolicy,
};
