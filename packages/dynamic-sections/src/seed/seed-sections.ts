/**
 * Seed sections — mining-domain (Borjie hard-fork).
 *
 * The original BossNyumba-fork seed shipped property-management /
 * CRM entity types (employees · customers · properties · leads ·
 * deals · kra-filings · campaigns · recommendations · internal-staff)
 * which are wrong for Borjie. This rewrite replaces them with the
 * eight mining-domain section descriptors that match the actual
 * owner-cockpit and admin-web surfaces.
 *
 * The eight mining sections:
 *   - pml-licences           — Primary Mining Licence registrations
 *   - royalty-drafts         — Royalty filing drafts (TMAA / GePG)
 *   - active-shifts          — Real-time crew shifts in progress
 *   - ore-parcels            — Ore parcels in inventory
 *   - nemc-filings           — National Env Mgmt Council filings
 *   - geology-logs           — Drill / blast / sample log entries
 *   - compliance-deadlines   — Statutory deadlines ≤ 30 days away
 *   - cooperative-membership — Co-operative membership module
 *
 * Visibility rules (`tabs appear when data exists`):
 *   - Every section gates on a `has-entities` of its own entity_type
 *     so a first-day tenant sees zero tabs. The instant the kernel
 *     creates the first record (PML certified, shift opened, ore
 *     parcel weighed, etc.) the corresponding tab materialises.
 *
 *   - For sections that should appear during a regulator-driven
 *     WINDOW even before data lands (royalty-drafts, nemc-filings)
 *     we OR the `has-entities` predicate with a `feature-flag` the
 *     host portal flips ON during the open window:
 *
 *       royalty-window-open   — 15 March to 30 April (TMAA window)
 *       nemc-window-open      — when a NEMC filing reminder is live
 *
 *     The portal owns the window calculation (calendar concerns
 *     live in the gateway / regulatory-calendar service) — this
 *     package stays library-only.
 *
 *   - geology-logs requires viewer permissions (a worker who lacks
 *     drill-log access must never see the tab). Wrapped in an `and`
 *     with `role-allowed`.
 *
 *   - compliance-deadlines uses a virtual entity_type
 *     `compliance-deadlines-30d` whose count is populated by the
 *     host's regulatory-calendar query (the host materialises only
 *     deadlines within 30 days; the predicate then becomes a simple
 *     `has-entities`).
 *
 *   - cooperative-membership is gated entirely by the
 *     `cooperative-member` feature flag the platform sets when the
 *     org joins a co-operative. It is also restricted to the
 *     `owner-customer` scope (admins do not see this surface).
 *
 *   - admin-web (`internal-admin` scope) gets every section's
 *     customer-side rule OR `role-allowed: platform_ops` so internal
 *     support operators can navigate to a tab for triage even when
 *     the tenant is empty.
 */

import type { Section } from '../contracts/section.js';
import {
  PmlLicencesSection,
  RoyaltyDraftsSection,
  ActiveShiftsSection,
  OreParcelsSection,
  NemcFilingsSection,
  GeologyLogsSection,
  ComplianceDeadlinesSection,
  CooperativeMembershipSection,
} from './section-components.js';

/**
 * Build a predicate that's true when EITHER the tenant has entities
 * of the given type OR the viewer is a Borjie platform operator.
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
    key: 'pml-licences',
    label: 'PML Licences',
    icon: 'badge-check',
    entity_type: 'pml-licences',
    sort_order: 10,
    visibility_predicate: customerSectionPredicate('pml-licences'),
    component_loader: () =>
      Promise.resolve({ default: PmlLicencesSection }),
  },
  {
    key: 'royalty-drafts',
    label: 'Royalty Drafts',
    icon: 'file-edit',
    entity_type: 'royalty-drafts',
    sort_order: 20,
    // Royalty filing window (15 March to 30 April) — visible whenever
    // the regulator-driven window flag is on OR the tenant already
    // has a draft, OR the viewer is a platform operator.
    visibility_predicate: {
      kind: 'or',
      preds: [
        { kind: 'has-entities', entity_type: 'royalty-drafts' },
        { kind: 'feature-flag', flag: 'royalty-window-open' },
        { kind: 'role-allowed', roles: ['platform_ops'] },
      ],
    },
    component_loader: () =>
      Promise.resolve({ default: RoyaltyDraftsSection }),
  },
  {
    key: 'active-shifts',
    label: 'Active Shifts',
    icon: 'play-circle',
    entity_type: 'active-shifts',
    sort_order: 30,
    visibility_predicate: customerSectionPredicate('active-shifts'),
    component_loader: () =>
      Promise.resolve({ default: ActiveShiftsSection }),
  },
  {
    key: 'ore-parcels',
    label: 'Ore Parcels',
    icon: 'package',
    entity_type: 'ore-parcels',
    sort_order: 40,
    visibility_predicate: customerSectionPredicate('ore-parcels'),
    component_loader: () =>
      Promise.resolve({ default: OreParcelsSection }),
  },
  {
    key: 'nemc-filings',
    label: 'NEMC Filings',
    icon: 'leaf',
    entity_type: 'nemc-filings',
    sort_order: 50,
    // NEMC filings — visible during an open environmental filing
    // window OR when filings already exist OR for platform operators.
    visibility_predicate: {
      kind: 'or',
      preds: [
        { kind: 'has-entities', entity_type: 'nemc-filings' },
        { kind: 'feature-flag', flag: 'nemc-window-open' },
        { kind: 'role-allowed', roles: ['platform_ops'] },
      ],
    },
    component_loader: () =>
      Promise.resolve({ default: NemcFilingsSection }),
  },
  {
    key: 'geology-logs',
    label: 'Geology Logs',
    icon: 'compass',
    entity_type: 'geology-logs',
    sort_order: 60,
    // Geology logs — viewer must hold a drill-log-capable role AND
    // logs must exist (or the viewer is a platform operator triaging
    // a tenant). The `role-allowed` enforcement protects against a
    // labourer-tier worker seeing the tab.
    visibility_predicate: {
      kind: 'or',
      preds: [
        {
          kind: 'and',
          preds: [
            { kind: 'has-entities', entity_type: 'geology-logs' },
            {
              kind: 'role-allowed',
              roles: ['geologist', 'mine_manager', 'owner', 'platform_ops'],
            },
          ],
        },
        { kind: 'role-allowed', roles: ['platform_ops'] },
      ],
    },
    component_loader: () =>
      Promise.resolve({ default: GeologyLogsSection }),
  },
  {
    key: 'compliance-deadlines',
    label: 'Compliance Deadlines',
    icon: 'alarm-clock',
    // Virtual entity-type: the host materialises only deadlines
    // within 30 days of now and publishes that count. The predicate
    // therefore stays a simple `has-entities`.
    entity_type: 'compliance-deadlines-30d',
    sort_order: 70,
    visibility_predicate: customerSectionPredicate('compliance-deadlines-30d'),
    component_loader: () =>
      Promise.resolve({ default: ComplianceDeadlinesSection }),
  },
  {
    key: 'cooperative-membership',
    label: 'Cooperative Membership',
    icon: 'users',
    entity_type: 'cooperative-membership',
    sort_order: 80,
    // Co-operative module is owner-side only and is fully gated by
    // the platform-managed `cooperative-member` feature flag — set
    // ON when the org formally joins a registered cooperative.
    scopes: ['owner-customer'],
    visibility_predicate: {
      kind: 'feature-flag',
      flag: 'cooperative-member',
    },
    component_loader: () =>
      Promise.resolve({ default: CooperativeMembershipSection }),
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
