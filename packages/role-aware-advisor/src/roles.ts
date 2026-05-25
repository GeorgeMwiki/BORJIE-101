/**
 * Role taxonomy + per-role Persona records.
 *
 * The role union is INTENTIONALLY narrower than the database `UserRole`
 * enum — this package collapses the operational/admin sub-grades into
 * coarser "audience" buckets the advisor cares about (tone + scope).
 * The api-gateway adapter maps `UserRole` → `Role` at the route edge.
 *
 * Mapping (lossy on purpose, never silently expand scope):
 *   SUPER_ADMIN / ADMIN / SUPPORT / TENANT_ADMIN  → 'admin'
 *   PROPERTY_MANAGER                              → 'property-manager'
 *   ACCOUNTANT / MAINTENANCE_STAFF                → 'estate-manager'
 *   OWNER                                         → 'owner'
 *   RESIDENT                                      → 'tenant'
 *   (unauthenticated / lead capture)              → 'prospect'
 *   (vendor portal / external)                    → 'service-provider'
 *
 * NOTE: `packages/database/src/services/platform/users.platform.service.ts`
 * is the source of truth for the wire-level enum — if it diverges from
 * the mapping above the api-gateway adapter MUST be updated, not this
 * file. Flag any divergence in the report so it isn't silently
 * re-mapped.
 */

export const ROLES = [
  'admin',
  'property-manager',
  'estate-manager',
  'owner',
  'tenant',
  'prospect',
  'service-provider',
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Persona — the system-prompt + tone + visibility envelope that
 * shapes every response the orchestrator returns to that role.
 *
 * - `systemPrompt`  the brain receives this verbatim, prefixed to the
 *                   role-routed sub-advisor's own system prompt
 * - `tone`          three coarse buckets so callers can also pick the
 *                   right output template (e.g. a sales-friendly
 *                   render for prospects vs. an audit-style render
 *                   for admins)
 * - `canSee`        positive list of resource types this role may
 *                   read; the guard treats anything outside this list
 *                   as `deny` unless it's in `cannotSee` explicitly
 * - `cannotSee`     redaction-only list — these resource types CAN be
 *                   touched but PII fields must be stripped before
 *                   they reach the answer text
 * - `defaultDepth`  rough output length: 'brief' ≤ ~120 tokens,
 *                   'standard' ≤ ~400, 'deep' ≤ ~900. The orchestrator
 *                   converts these to a token budget for the brain.
 */
export interface Persona {
  readonly role: Role;
  readonly systemPrompt: string;
  readonly tone: 'friendly' | 'professional' | 'authoritative';
  readonly canSee: ReadonlyArray<ResourceKind>;
  readonly cannotSee: ReadonlyArray<ResourceKind>;
  readonly defaultDepth: 'brief' | 'standard' | 'deep';
}

/**
 * The closed set of resource kinds the guard reasons about. New kinds
 * MUST be added here AND to each role's persona — silently widening a
 * persona is a SOC 2 violation.
 */
export const RESOURCE_KINDS = [
  'own-lease',
  'own-unit',
  'own-maintenance',
  'own-payment-history',
  'building-public-info',
  'public-listing',
  'public-market-data',
  'public-neighborhood-data',
  'owned-properties',
  'tenant-aggregate-no-pii',
  'tenant-pii',
  'managed-portfolio',
  'staff-notes',
  'org-wide-financials',
  'assigned-jobs',
  'lesson-store',
] as const;

export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/**
 * Persona table. Each persona is a pure record; consumers should treat
 * it as immutable and never mutate fields in-place (would leak across
 * tenants since the table is a module-level singleton).
 */
export const PERSONAS: Readonly<Record<Role, Persona>> = {
  admin: {
    role: 'admin',
    systemPrompt: [
      'You are advising a BORJIE platform administrator.',
      'Be concise, structured, and audit-friendly. Cite sources by id.',
      'Surface compliance + risk implications first; commercial second.',
      'Never invent figures — if a number is not in the evidence, say so.',
    ].join(' '),
    tone: 'authoritative',
    canSee: [
      'own-lease',
      'own-unit',
      'own-maintenance',
      'own-payment-history',
      'building-public-info',
      'public-listing',
      'public-market-data',
      'public-neighborhood-data',
      'owned-properties',
      'tenant-aggregate-no-pii',
      'tenant-pii',
      'managed-portfolio',
      'staff-notes',
      'org-wide-financials',
      'assigned-jobs',
      'lesson-store',
    ],
    cannotSee: [],
    defaultDepth: 'deep',
  },
  'property-manager': {
    role: 'property-manager',
    systemPrompt: [
      'You are advising a property manager responsible for a portfolio.',
      'Lead with actions they can take today; quote money in their currency.',
      'Frame answers around renewal-rate, occupancy, arrears, NOI levers.',
      'Cite tenant + unit ids — never names, never national-id digits.',
    ].join(' '),
    tone: 'professional',
    canSee: [
      'own-lease',
      'own-unit',
      'own-maintenance',
      'own-payment-history',
      'building-public-info',
      'public-listing',
      'public-market-data',
      'public-neighborhood-data',
      'managed-portfolio',
      'tenant-aggregate-no-pii',
      'staff-notes',
      'assigned-jobs',
    ],
    cannotSee: ['tenant-pii', 'org-wide-financials'],
    defaultDepth: 'standard',
  },
  'estate-manager': {
    role: 'estate-manager',
    systemPrompt: [
      'You are advising an estate / facilities manager.',
      'Keep guidance operational — schedules, SLAs, vendor selection.',
      'Surface safety + compliance implications before cost.',
    ].join(' '),
    tone: 'professional',
    canSee: [
      'own-unit',
      'own-maintenance',
      'building-public-info',
      'managed-portfolio',
      'tenant-aggregate-no-pii',
      'staff-notes',
      'assigned-jobs',
    ],
    cannotSee: ['tenant-pii', 'org-wide-financials', 'own-payment-history'],
    defaultDepth: 'standard',
  },
  owner: {
    role: 'owner',
    systemPrompt: [
      'You are advising a property owner.',
      'Frame the answer around return on investment, risk, and reputation.',
      'When a number depends on a tenant, ALWAYS aggregate — never name.',
      'Provide one clear recommendation + the reasoning, not a list of options.',
    ].join(' '),
    tone: 'professional',
    canSee: [
      'building-public-info',
      'public-listing',
      'public-market-data',
      'public-neighborhood-data',
      'owned-properties',
      'tenant-aggregate-no-pii',
    ],
    cannotSee: ['tenant-pii', 'staff-notes', 'org-wide-financials'],
    defaultDepth: 'standard',
  },
  tenant: {
    role: 'tenant',
    systemPrompt: [
      'You are advising a residential tenant.',
      'Be warm and plain-spoken; explain jargon.',
      'Only use the tenant\'s OWN records as evidence — never other units.',
      'When the answer involves the landlord, suggest the most constructive next step.',
    ].join(' '),
    tone: 'friendly',
    canSee: [
      'own-lease',
      'own-unit',
      'own-maintenance',
      'own-payment-history',
      'building-public-info',
      'public-listing',
      'public-market-data',
      'public-neighborhood-data',
    ],
    cannotSee: [
      'owned-properties',
      'managed-portfolio',
      'tenant-aggregate-no-pii',
      'tenant-pii',
      'staff-notes',
      'org-wide-financials',
      'assigned-jobs',
    ],
    defaultDepth: 'standard',
  },
  prospect: {
    role: 'prospect',
    systemPrompt: [
      'You are advising a prospective renter or buyer.',
      'Be welcoming. Use public-listing + market data only.',
      'Offer to connect them with an agent for anything tenancy-specific.',
    ].join(' '),
    tone: 'friendly',
    canSee: ['public-listing', 'public-market-data', 'public-neighborhood-data'],
    cannotSee: [
      'own-lease',
      'own-unit',
      'own-maintenance',
      'own-payment-history',
      'building-public-info',
      'owned-properties',
      'tenant-aggregate-no-pii',
      'tenant-pii',
      'managed-portfolio',
      'staff-notes',
      'org-wide-financials',
      'assigned-jobs',
    ],
    defaultDepth: 'brief',
  },
  'service-provider': {
    role: 'service-provider',
    systemPrompt: [
      'You are advising a vendor / service provider working an assigned job.',
      'Stick to job scope: site, time window, materials, SLA.',
      'Do NOT discuss tenant identity beyond the unit number on the work order.',
    ].join(' '),
    tone: 'professional',
    canSee: ['assigned-jobs', 'building-public-info'],
    cannotSee: [
      'own-lease',
      'own-payment-history',
      'owned-properties',
      'tenant-aggregate-no-pii',
      'tenant-pii',
      'managed-portfolio',
      'staff-notes',
      'org-wide-financials',
    ],
    defaultDepth: 'brief',
  },
};

/** Get the persona for a role, or `null` if the role is unknown. */
export function getPersona(role: Role): Persona {
  return PERSONAS[role];
}

/**
 * Convert the API-gateway `UserRole` enum string into the coarser
 * `Role` used here. Returns `null` for unknown values so the caller
 * can decide whether to default to `prospect` or refuse the request.
 *
 * Kept here (not in api-gateway) so the mapping table is in the same
 * file as the persona definitions — that's the only way to keep them
 * in sync over time.
 */
export function mapWireRoleToRole(wireRole: string): Role | null {
  switch (wireRole) {
    case 'SUPER_ADMIN':
    case 'ADMIN':
    case 'SUPPORT':
    case 'TENANT_ADMIN':
      return 'admin';
    case 'PROPERTY_MANAGER':
      return 'property-manager';
    case 'ACCOUNTANT':
    case 'MAINTENANCE_STAFF':
      return 'estate-manager';
    case 'OWNER':
      return 'owner';
    case 'RESIDENT':
      return 'tenant';
    default:
      return null;
  }
}
