/**
 * Seed sections for the J1 entity types.
 *
 * Nine sections cover the J1 spec:
 *   - employees · customers · properties · leads · deals
 *   - kra-filings · campaigns · recommendations · internal-staff
 *
 * Visibility rules (the heart of "tabs appear when data exists"):
 *   - All non-staff sections gate behind `has-entities` of their own
 *     entity_type. A first-day tenant sees zero tabs. The moment
 *     the MD's chat-driven kernel creates the first property /
 *     campaign / recommendation, the corresponding tab materialises.
 *   - `internal-staff` ALSO requires the viewer to hold a platform-
 *     ops role — wrapped in an `and` predicate.
 *   - Sections that should always be available to platform staff for
 *     "even an empty tenant" diagnostic visibility are exposed via
 *     an `or` of `has-entities` and `role-allowed: platform_ops`.
 *     This lets internal admins navigate to tabs that would
 *     otherwise be hidden — useful for support triage.
 *
 * Scopes:
 *   - `owner-customer` portals see the MD-facing sections (the eight
 *     that matter to the tenant).
 *   - `internal-admin` sees all nine PLUS the support-override
 *     visibility on the customer sections.
 */

import type { Section } from '../contracts/section.js';

// "KRA Filings" is a Kenya-specific tax-authority surface (Kenya Revenue
// Authority — a proper noun). The seed exports this label as the default
// for the section registry; consumer apps that have i18n wired up are
// expected to translate the displayed label at render time using their
// own message catalogue. The seed itself stays English so the
// dynamic-sections package remains library-only (no i18n dependency).
const KRA_FILINGS_LABEL = 'KRA Filings';
import {
  EmployeesSection,
  CustomersSection,
  PropertiesSection,
  LeadsSection,
  DealsSection,
  KraFilingsSection,
  CampaignsSection,
  RecommendationsSection,
  InternalStaffSection,
} from './section-components.js';

/**
 * Build a predicate that's true when EITHER the tenant has entities
 * of the given type OR the viewer is a platform support operator.
 * Captures the "internal admins can navigate to empty tabs for
 * triage" rule once instead of duplicating the OR everywhere.
 */
function customerSectionPredicate(entityType: string) {
  return {
    kind: 'or' as const,
    preds: [
      { kind: 'has-entities' as const, entity_type: entityType },
      { kind: 'role-allowed' as const, roles: ['platform_ops'] },
    ],
  };
}

export const seedSections: readonly Section[] = [
  {
    key: 'employees',
    label: 'Employees',
    icon: 'users',
    entity_type: 'employees',
    sort_order: 10,
    visibility_predicate: customerSectionPredicate('employees'),
    component_loader: () =>
      Promise.resolve({ default: EmployeesSection }),
  },
  {
    key: 'customers',
    label: 'Customers',
    icon: 'user-round',
    entity_type: 'customers',
    sort_order: 20,
    visibility_predicate: customerSectionPredicate('customers'),
    component_loader: () =>
      Promise.resolve({ default: CustomersSection }),
  },
  {
    key: 'properties',
    label: 'Properties',
    icon: 'building-2',
    entity_type: 'properties',
    sort_order: 30,
    visibility_predicate: customerSectionPredicate('properties'),
    component_loader: () =>
      Promise.resolve({ default: PropertiesSection }),
  },
  {
    key: 'leads',
    label: 'Leads',
    icon: 'target',
    entity_type: 'leads',
    sort_order: 40,
    visibility_predicate: customerSectionPredicate('leads'),
    component_loader: () =>
      Promise.resolve({ default: LeadsSection }),
  },
  {
    key: 'deals',
    label: 'Deals',
    icon: 'handshake',
    entity_type: 'deals',
    sort_order: 50,
    visibility_predicate: customerSectionPredicate('deals'),
    component_loader: () =>
      Promise.resolve({ default: DealsSection }),
  },
  {
    key: 'kra-filings',
    label: KRA_FILINGS_LABEL,
    icon: 'file-text',
    entity_type: 'kra-filings',
    sort_order: 60,
    visibility_predicate: customerSectionPredicate('kra-filings'),
    component_loader: () =>
      Promise.resolve({ default: KraFilingsSection }),
  },
  {
    key: 'campaigns',
    label: 'Campaigns',
    icon: 'megaphone',
    entity_type: 'campaigns',
    sort_order: 70,
    visibility_predicate: customerSectionPredicate('campaigns'),
    component_loader: () =>
      Promise.resolve({ default: CampaignsSection }),
  },
  {
    key: 'recommendations',
    label: 'Recommendations',
    icon: 'sparkles',
    entity_type: 'recommendations',
    sort_order: 80,
    visibility_predicate: customerSectionPredicate('recommendations'),
    component_loader: () =>
      Promise.resolve({ default: RecommendationsSection }),
  },
  {
    key: 'internal-staff',
    label: 'Internal Staff',
    icon: 'shield',
    entity_type: 'internal-staff',
    sort_order: 90,
    scopes: ['internal-admin'],
    // Internal staff: visible only to internal-admin scope, and only when
    // the viewer holds the platform_ops role. Belt-and-braces in case the
    // section ever leaks into another scope by configuration error.
    visibility_predicate: {
      kind: 'and',
      preds: [
        { kind: 'has-entities', entity_type: 'internal-staff' },
        { kind: 'role-allowed', roles: ['platform_ops', 'platform_admin'] },
      ],
    },
    component_loader: () =>
      Promise.resolve({ default: InternalStaffSection }),
  },
];

/**
 * Sorted keys for the seed registry — exported for tests +
 * documentation. Stable order matters because portal URL slugs
 * derive from these keys.
 */
export const seedSectionKeys: readonly string[] = seedSections.map(
  (s) => s.key,
);
