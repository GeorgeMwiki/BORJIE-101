/**
 * Built-in workflow definitions — the canonical 10 the platform ships
 * with. Tenants may register additional kinds via elastic-config but
 * the engine ships with these so every customer has a working surface
 * on day 1.
 *
 * Naming convention:
 *   - id prefix matches the kind for readability in audit dumps.
 *   - version 1 = first ship; bump on breaking changes to the input
 *     schema or the required capability.
 *
 * Approval-router integration:
 *   - `elasticPolicyKey` is the key inside `tenants.settings.elasticConfig
 *     .approvalThresholds` (and the legacy `approval_policies.type`)
 *     that gates approval. `null` means "no threshold lookup — fixed
 *     approver from the assignment".
 */

import type { WorkflowDefinition } from '../types.js';

export const BUILT_IN_WORKFLOW_DEFINITIONS: ReadonlyArray<WorkflowDefinition> =
  Object.freeze([
    {
      id: 'parcel_edit_v1',
      kind: 'parcel_edit',
      version: 1,
      name: 'Parcel edit',
      description:
        'Edit a parcel — area, classification, ownership flag. Captures field-level diff, AI-reviewed for boundary plausibility, human-approved.',
      requiredCapability: 'metadata_edit',
      aiReviewRequired: true,
      humanApprovalRequired: true,
      autoCommitOnApproval: true,
      elasticPolicyKey: null,
    },
    {
      id: 'polygon_draw_v1',
      kind: 'polygon_draw',
      version: 1,
      name: 'Polygon draw / redraw',
      description:
        'Capture a new or redrawn polygon for a parcel. AI checks topology + overlap with adjacent parcels; human approves if area changes more than the tenant tolerance.',
      requiredCapability: 'polygon_edit',
      aiReviewRequired: true,
      humanApprovalRequired: true,
      autoCommitOnApproval: true,
      elasticPolicyKey: null,
    },
    {
      id: 'metadata_update_v1',
      kind: 'metadata_update',
      version: 1,
      name: 'Metadata update',
      description:
        'Generic field-level metadata change on any tenant-scoped entity. AI checks for spec-compliance + completeness.',
      requiredCapability: 'metadata_edit',
      aiReviewRequired: true,
      humanApprovalRequired: false,
      autoCommitOnApproval: true,
      elasticPolicyKey: null,
    },
    {
      id: 'photo_add_v1',
      kind: 'photo_add',
      version: 1,
      name: 'Photo upload',
      description:
        'Attach a photo to a parcel / unit / inspection. AI checks for PII + offensive content + minimum resolution. Auto-commit on AI pass.',
      requiredCapability: 'photo_add',
      aiReviewRequired: true,
      humanApprovalRequired: false,
      autoCommitOnApproval: true,
      elasticPolicyKey: null,
    },
    {
      id: 'inspection_v1',
      kind: 'inspection',
      version: 1,
      name: 'Inspection completion',
      description:
        'Submit a property inspection report. AI checks for required fields + photo-coverage + outlier scores. Human supervisor approves before lease impact.',
      requiredCapability: 'inspection_complete',
      aiReviewRequired: true,
      humanApprovalRequired: true,
      autoCommitOnApproval: true,
      elasticPolicyKey: null,
    },
    {
      id: 'new_lease_v1',
      kind: 'new_lease',
      version: 1,
      name: 'New lease draft',
      description:
        'Draft a new lease agreement. AI checks rent against policy + thresholds; routes via lease_exception elastic policy when threshold breached.',
      requiredCapability: 'lease_draft',
      aiReviewRequired: true,
      humanApprovalRequired: true,
      autoCommitOnApproval: true,
      elasticPolicyKey: 'lease_exception',
    },
    {
      id: 'maintenance_completion_v1',
      kind: 'maintenance_completion',
      version: 1,
      name: 'Maintenance completion',
      description:
        'Mark a maintenance job complete. AI checks for required photos + scope-of-work alignment; routes via maintenance_cost elastic policy when over threshold.',
      requiredCapability: 'maintenance_complete',
      aiReviewRequired: true,
      humanApprovalRequired: true,
      autoCommitOnApproval: true,
      elasticPolicyKey: 'maintenance_cost',
    },
    {
      id: 'document_upload_v1',
      kind: 'document_upload',
      version: 1,
      name: 'Document upload',
      description:
        'Upload a document (lease, deed, inspection report). AI checks for PII redaction + file integrity + classification.',
      requiredCapability: 'document_upload',
      aiReviewRequired: true,
      humanApprovalRequired: false,
      autoCommitOnApproval: true,
      elasticPolicyKey: null,
    },
    {
      id: 'po_approval_v1',
      kind: 'po_approval',
      version: 1,
      name: 'Purchase-order approval',
      description:
        'Approve a vendor purchase-order. AI checks 3-way-match preconditions; routes via maintenance_cost elastic policy.',
      requiredCapability: 'approve_change',
      aiReviewRequired: true,
      humanApprovalRequired: true,
      autoCommitOnApproval: true,
      elasticPolicyKey: 'maintenance_cost',
    },
    {
      id: 'requisition_submission_v1',
      kind: 'requisition_submission',
      version: 1,
      name: 'Requisition submission',
      description:
        'Submit a procurement requisition. AI checks budget availability + vendor coverage; human approver per elastic threshold.',
      requiredCapability: 'submit_for_review',
      aiReviewRequired: true,
      humanApprovalRequired: true,
      autoCommitOnApproval: true,
      elasticPolicyKey: 'maintenance_cost',
    },
  ]);

export function findDefinitionById(
  id: string,
): WorkflowDefinition | null {
  return (
    BUILT_IN_WORKFLOW_DEFINITIONS.find((d) => d.id === id) ?? null
  );
}

export function listBuiltInDefinitions(): ReadonlyArray<WorkflowDefinition> {
  return BUILT_IN_WORKFLOW_DEFINITIONS;
}
