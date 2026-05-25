/**
 * Validation — composite validator for AccumulatedEstateContext.
 *
 * Returns a ValidationReport: per-section pass/fail + field-level errors.
 *
 * @module progressive-intelligence/validation
 */

import type { AccumulatedEstateContext } from '../types.js';
import {
  PropertyDraftSchema,
  TenantProfileDraftSchema,
  LeaseTermsDraftSchema,
  MaintenanceCaseDraftSchema,
  MigrationBatchDraftSchema,
  RenewalProposalDraftSchema,
  ComplianceNoticeDraftSchema,
} from './schemas.js';

export * from './schemas.js';

export interface ValidationError {
  readonly section: string;
  readonly field: string;
  readonly message: string;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
  readonly bySection: Record<string, boolean>;
}

export function validateAccumulatedContext(
  ctx: AccumulatedEstateContext,
): ValidationReport {
  const errors: ValidationError[] = [];
  const bySection: Record<string, boolean> = {};

  for (const [name, schema, draft] of [
    ['property', PropertyDraftSchema, ctx.property],
    ['tenantProfile', TenantProfileDraftSchema, ctx.tenantProfile],
    ['leaseTerms', LeaseTermsDraftSchema, ctx.leaseTerms],
    ['maintenanceCase', MaintenanceCaseDraftSchema, ctx.maintenanceCase],
    ['migrationBatch', MigrationBatchDraftSchema, ctx.migrationBatch],
    ['renewalProposal', RenewalProposalDraftSchema, ctx.renewalProposal],
    ['complianceNotice', ComplianceNoticeDraftSchema, ctx.complianceNotice],
  ] as const) {
    const parsed = schema.safeParse(draft);
    if (parsed.success) {
      bySection[name] = true;
    } else {
      bySection[name] = false;
      for (const issue of parsed.error.issues) {
        errors.push({
          section: name,
          field: issue.path.join('.'),
          message: issue.message,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    bySection,
  };
}
