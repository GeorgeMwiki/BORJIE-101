/**
 * Field Mappings — source signal → target context field.
 *
 * Declarative table mapping extraction patterns and chat signals to
 * AccumulatedEstateContext fields.
 *
 * Example: chat message "the bathroom has been leaking for 3 weeks" +
 * attached photo → maintenance_case.category='plumbing', severity='medium',
 * evidence=[photoUrl], reported_at=now().
 *
 * @module progressive-intelligence/field-mappings
 */

import type { PatternKind, PatternMatch } from './extraction-patterns.js';
import type { DataSource } from './types.js';

export interface FieldMapping {
  readonly targetPath: string; // dotted path into AccumulatedEstateContext
  readonly sourceKinds: readonly PatternKind[];
  readonly sources: readonly DataSource[];
  readonly sectionId: SectionId;
  readonly priority: number;
  readonly confidenceFloor: number;
}

export type SectionId =
  | 'property'
  | 'tenantProfile'
  | 'leaseTerms'
  | 'maintenanceCase'
  | 'migrationBatch'
  | 'renewalProposal'
  | 'complianceNotice';

export const FIELD_MAPPINGS: readonly FieldMapping[] = Object.freeze([
  // Property
  {
    targetPath: 'property.propertyRef',
    sourceKinds: ['property_ref'],
    sources: ['chat', 'document', 'form'],
    sectionId: 'property',
    priority: 10,
    confidenceFloor: 0.8,
  },
  {
    targetPath: 'property.unitLabel',
    sourceKinds: ['unit_label'],
    sources: ['chat', 'document', 'form'],
    sectionId: 'property',
    priority: 9,
    confidenceFloor: 0.7,
  },

  // Tenant profile
  {
    targetPath: 'tenantProfile.phone',
    sourceKinds: ['phone_tz', 'phone_ke'],
    sources: ['chat', 'document', 'form', 'lpms_import'],
    sectionId: 'tenantProfile',
    priority: 10,
    confidenceFloor: 0.85,
  },
  {
    targetPath: 'tenantProfile.email',
    sourceKinds: ['email'],
    sources: ['chat', 'document', 'form'],
    sectionId: 'tenantProfile',
    priority: 9,
    confidenceFloor: 0.9,
  },
  {
    targetPath: 'tenantProfile.nationalId',
    sourceKinds: ['national_id_tz', 'national_id_ke'],
    sources: ['document', 'form'],
    sectionId: 'tenantProfile',
    priority: 10,
    confidenceFloor: 0.9,
  },

  // Lease terms
  {
    targetPath: 'leaseTerms.monthlyRentCents',
    sourceKinds: ['amount'],
    sources: ['chat', 'document', 'form', 'lpms_import'],
    sectionId: 'leaseTerms',
    priority: 8,
    confidenceFloor: 0.6,
  },
  {
    targetPath: 'leaseTerms.startDate',
    sourceKinds: ['date'],
    sources: ['chat', 'document', 'form', 'lpms_import'],
    sectionId: 'leaseTerms',
    priority: 7,
    confidenceFloor: 0.7,
  },
  {
    targetPath: 'leaseTerms.tenureMonths',
    sourceKinds: ['duration_months'],
    sources: ['chat', 'document', 'form'],
    sectionId: 'leaseTerms',
    priority: 7,
    confidenceFloor: 0.85,
  },

  // Renewal
  {
    targetPath: 'renewalProposal.proposedRentCents',
    sourceKinds: ['amount'],
    sources: ['chat', 'form'],
    sectionId: 'renewalProposal',
    priority: 6,
    confidenceFloor: 0.6,
  },
  {
    targetPath: 'renewalProposal.proposedTermMonths',
    sourceKinds: ['duration_months'],
    sources: ['chat', 'form'],
    sectionId: 'renewalProposal',
    priority: 6,
    confidenceFloor: 0.85,
  },
]);

// ============================================================================
// Chat keyword → maintenance mapping
// ============================================================================

interface MaintenanceKeywordMap {
  readonly category: NonNullable<
    import('./types.js').MaintenanceCaseDraft['category']
  >;
  readonly patterns: readonly RegExp[];
  readonly defaultSeverity: NonNullable<
    import('./types.js').MaintenanceCaseDraft['severity']
  >;
}

export const MAINTENANCE_KEYWORD_MAP: readonly MaintenanceKeywordMap[] = [
  {
    category: 'plumbing',
    patterns: [/\b(leak|leaking|pipe|drain|bathroom|toilet|sink)\b/i],
    defaultSeverity: 'medium',
  },
  {
    category: 'electrical',
    patterns: [
      /\b(electric|wiring|socket|outlet|breaker|power|light)\b/i,
    ],
    defaultSeverity: 'high',
  },
  {
    category: 'hvac',
    patterns: [/\b(ac|air[- ]?con|hvac|heating|cooling)\b/i],
    defaultSeverity: 'medium',
  },
  {
    category: 'structural',
    patterns: [/\b(roof|wall|ceiling|crack|structural)\b/i],
    defaultSeverity: 'high',
  },
  {
    category: 'appliance',
    patterns: [/\b(fridge|oven|stove|washing|dryer|appliance)\b/i],
    defaultSeverity: 'low',
  },
  {
    category: 'pest',
    patterns: [/\b(pest|roach|rodent|ant|termite|infest)\b/i],
    defaultSeverity: 'medium',
  },
  {
    category: 'security',
    patterns: [/\b(security|lock|gate|intrusion|break[- ]?in|door)\b/i],
    defaultSeverity: 'high',
  },
];

export function inferMaintenanceCategory(
  text: string,
): { category: MaintenanceKeywordMap['category']; severity: MaintenanceKeywordMap['defaultSeverity'] } | null {
  if (!text) return null;
  for (const entry of MAINTENANCE_KEYWORD_MAP) {
    for (const pat of entry.patterns) {
      if (pat.test(text)) {
        return { category: entry.category, severity: entry.defaultSeverity };
      }
    }
  }
  return null;
}

// ============================================================================
// Section readiness calculation
// ============================================================================

type SectionFieldSpec = Record<SectionId, readonly string[]>;

export const SECTION_REQUIRED_FIELDS: SectionFieldSpec = {
  property: ['property.propertyRef', 'property.unitLabel'],
  tenantProfile: [
    'tenantProfile.tenantName',
    'tenantProfile.phone',
    'tenantProfile.nationalId',
  ],
  leaseTerms: [
    'leaseTerms.monthlyRentCents',
    'leaseTerms.startDate',
    'leaseTerms.tenureMonths',
  ],
  maintenanceCase: [
    'maintenanceCase.category',
    'maintenanceCase.severity',
    'maintenanceCase.description',
  ],
  migrationBatch: ['migrationBatch.sourceSystem', 'migrationBatch.sourceFile'],
  renewalProposal: [
    'renewalProposal.existingRentCents',
    'renewalProposal.proposedRentCents',
    'renewalProposal.proposedTermMonths',
  ],
  complianceNotice: [
    'complianceNotice.noticeType',
    'complianceNotice.recipientName',
    'complianceNotice.issueDate',
  ],
};

export function getAffectedSections(targetPath: string): readonly SectionId[] {
  const section = targetPath.split('.')[0] as SectionId;
  return SECTION_REQUIRED_FIELDS[section] ? [section] : [];
}

/** Select the best mapping for an extraction match. */
export function findBestMapping(match: PatternMatch): FieldMapping | null {
  const candidates = FIELD_MAPPINGS.filter((m) =>
    m.sourceKinds.includes(match.kind) && match.confidence >= m.confidenceFloor,
  );
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => b.priority - a.priority)[0];
}
