/**
 * Zod schemas for every AccumulatedEstateContext section.
 *
 * Schemas are intentionally permissive on per-field basis (most fields
 * optional) so partial drafts validate during accumulation. Full-commit
 * paths must call {@link assertCommitReady} to enforce hard guarantees.
 *
 * @module progressive-intelligence/validation/schemas
 */

import { z } from 'zod';

export const PropertyDraftSchema = z
  .object({
    propertyId: z.string().uuid().optional(),
    unitId: z.string().uuid().optional(),
    propertyRef: z.string().min(2).max(100).optional(),
    district: z.string().min(2).max(100).optional(),
    blockRef: z.string().min(1).max(50).optional(),
    unitLabel: z.string().min(1).max(20).optional(),
  })
  .strict();

export const TenantProfileDraftSchema = z
  .object({
    tenantName: z.string().min(2).max(200).optional(),
    phone: z
      .string()
      .regex(/^\+?\d{9,15}$/, 'Invalid international phone format')
      .optional(),
    email: z.string().email().optional(),
    nationalId: z.string().min(5).max(40).optional(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/, 'Country code must be ISO 3166-1 alpha-2')
      .optional(),
    occupation: z.string().max(100).optional(),
    employerName: z.string().max(200).optional(),
    monthlyIncomeCents: z.number().int().min(0).optional(),
  })
  .strict();

export const LeaseTermsDraftSchema = z
  .object({
    monthlyRentCents: z.number().int().min(0).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, 'Currency must be ISO 4217')
      .optional(),
    depositCents: z.number().int().min(0).optional(),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional(),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional(),
    tenureMonths: z.number().int().min(1).max(1200).optional(),
    escalationPct: z.number().min(-100).max(1000).optional(),
    paymentDayOfMonth: z.number().int().min(1).max(31).optional(),
  })
  .strict();

export const MaintenanceCaseDraftSchema = z
  .object({
    category: z
      .enum([
        'plumbing',
        'electrical',
        'hvac',
        'structural',
        'appliance',
        'cleaning',
        'pest',
        'security',
        'other',
      ])
      .optional(),
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    description: z.string().min(3).max(4000).optional(),
    reportedAt: z.string().datetime().optional(),
    evidence: z.array(z.string().url()).optional(),
    preferredVisitDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional(),
  })
  .strict();

export const MigrationBatchDraftSchema = z
  .object({
    sourceSystem: z.string().min(1).max(50).optional(),
    sourceFile: z.string().min(1).max(500).optional(),
    detectedEntities: z.array(z.string()).optional(),
    rowCountTotal: z.number().int().min(0).optional(),
    rowCountParsed: z.number().int().min(0).optional(),
    rowCountFailed: z.number().int().min(0).optional(),
    unresolvedFields: z.array(z.string()).optional(),
  })
  .strict();

export const RenewalProposalDraftSchema = z
  .object({
    existingRentCents: z.number().int().min(0).optional(),
    proposedRentCents: z.number().int().min(0).optional(),
    incrementPct: z.number().min(-100).max(1000).optional(),
    proposedTermMonths: z.number().int().min(1).max(1200).optional(),
    incentives: z.array(z.string()).optional(),
    justification: z.string().max(4000).optional(),
  })
  .strict();

export const ComplianceNoticeDraftSchema = z
  .object({
    noticeType: z
      .enum([
        'default',
        'termination',
        'inspection',
        'renewal',
        'rate_adjustment',
        'compliance_breach',
      ])
      .optional(),
    recipientName: z.string().min(2).max(200).optional(),
    issueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
      .optional(),
    complianceFindings: z.array(z.string()).optional(),
    ruleReferences: z.array(z.string()).optional(),
  })
  .strict();

// ============================================================================
// Commit guards — required fields per section
// ============================================================================

export function assertLeaseCommitReady(
  draft: z.infer<typeof LeaseTermsDraftSchema>,
): void {
  if (
    draft.monthlyRentCents === undefined ||
    draft.startDate === undefined ||
    draft.tenureMonths === undefined
  ) {
    throw new Error(
      'lease-terms not commit-ready: monthlyRentCents, startDate, and tenureMonths are all required',
    );
  }
}

export function assertMaintenanceCommitReady(
  draft: z.infer<typeof MaintenanceCaseDraftSchema>,
): void {
  if (!draft.category || !draft.severity || !draft.description) {
    throw new Error(
      'maintenance-case not commit-ready: category, severity, and description are all required',
    );
  }
}

export function assertComplianceNoticeCommitReady(
  draft: z.infer<typeof ComplianceNoticeDraftSchema>,
): void {
  if (!draft.noticeType || !draft.recipientName || !draft.issueDate) {
    throw new Error(
      'compliance-notice not commit-ready: noticeType, recipientName, and issueDate are all required',
    );
  }
}
