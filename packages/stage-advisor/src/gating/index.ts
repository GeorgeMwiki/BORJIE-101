/**
 * Capability gating — answer "given this stage + role + jurisdiction,
 * which capabilities are unlocked / hidden / previewable?".
 *
 * Returns three buckets:
 *   - `unlocked`   visible + functional in the UI
 *   - `hidden`     not shown anywhere (don't overwhelm early-stage)
 *   - `previewable` visible behind a "coming soon" affordance
 *
 * Role is a hard cap: tenant / prospect / service-provider never see
 * fleet, inventory, treasury — regardless of stage. That intersection
 * with the stage allow-list happens here so the stage table can stay
 * role-agnostic.
 *
 * Jurisdiction is currently used only to suppress capabilities that
 * require a feature flag we don't yet have a plugin for in that
 * jurisdiction — implemented as a small allow-list per jurisdiction.
 */

import { STAGE_CARDS } from '../stages/definitions.js';
import { CAPABILITY_IDS } from '../types.js';
import type {
  CapabilityGatingInput,
  CapabilityGatingResult,
  CapabilityId,
  StageRole,
} from '../types.js';

/**
 * Role-level allow-lists. A capability that's not on this list is
 * suppressed for that role regardless of stage. Admin/PM/estate-manager
 * see everything their stage unlocks. Owner sees portfolio-level
 * capabilities. Tenant / prospect / service-provider see the bare
 * minimum.
 */
const ROLE_ALLOW: Readonly<Record<StageRole, ReadonlyArray<CapabilityId>>> = {
  admin: CAPABILITY_IDS,
  'property-manager': CAPABILITY_IDS,
  'estate-manager': [
    'org-setup',
    'first-property',
    'lease-lifecycle',
    'payment-basics',
    'communications',
    'maintenance-taxonomy',
    'scheduled-inspections',
    'basic-reporting',
    'procurement-coordination',
    'inventory-management',
    'vendor-management',
    'fleet-management',
    'advanced-reporting',
    'dedicated-pm-teams',
    'regional-ops',
  ],
  owner: [
    'org-setup',
    'first-property',
    'lease-lifecycle',
    'payment-basics',
    'communications',
    'basic-reporting',
    'advanced-reporting',
    'expansion-planning',
    'treasury',
    'ir-aor-reports',
  ],
  tenant: ['lease-lifecycle', 'payment-basics', 'communications'],
  prospect: ['first-property'],
  'service-provider': [
    'maintenance-taxonomy',
    'vendor-management',
    'procurement-coordination',
  ],
};

/**
 * Jurisdiction-level deny-list. Empty by default — extend this as we
 * add jurisdiction-specific plugins.
 */
const JURISDICTION_DENY: Readonly<Record<string, ReadonlyArray<CapabilityId>>> = {
  // Example: 'XX' jurisdiction has no fleet-management licensing plugin.
  // 'XX': ['fleet-management'],
};

/**
 * Feature-flag key suggestions per capability. These are recommendations
 * for which platform feature-flag rows to enable for a stage's unlocked
 * set. The api-gateway can pass these straight into the feature-flags
 * service to seed defaults when an org transitions stages.
 *
 * Naming: `cap.<capability-id>` — matches the existing flag-key
 * convention (`<namespace>.<feature>`) used elsewhere in the codebase
 * for platform feature flags.
 */
export const CAPABILITY_FLAG_KEYS: Readonly<Record<CapabilityId, string>> = {
  'org-setup': 'cap.org-setup',
  'first-property': 'cap.first-property',
  'lease-lifecycle': 'cap.lease-lifecycle',
  'payment-basics': 'cap.payment-basics',
  communications: 'cap.communications',
  'maintenance-taxonomy': 'cap.maintenance-taxonomy',
  'scheduled-inspections': 'cap.scheduled-inspections',
  'basic-reporting': 'cap.basic-reporting',
  'procurement-coordination': 'cap.procurement-coordination',
  'inventory-management': 'cap.inventory-management',
  'vendor-management': 'cap.vendor-management',
  'fleet-management': 'cap.fleet-management',
  'advanced-reporting': 'cap.advanced-reporting',
  'dedicated-pm-teams': 'cap.dedicated-pm-teams',
  'regional-ops': 'cap.regional-ops',
  treasury: 'cap.treasury',
  'expansion-planning': 'cap.expansion-planning',
  'multi-jurisdiction': 'cap.multi-jurisdiction',
  'ir-aor-reports': 'cap.ir-aor-reports',
  'enterprise-stack': 'cap.enterprise-stack',
  'ops-command': 'cap.ops-command',
};

export function gatedCapabilities(
  input: CapabilityGatingInput,
): CapabilityGatingResult {
  const card = STAGE_CARDS[input.stage];
  const roleAllow = new Set(ROLE_ALLOW[input.role]);
  const jurisdictionDeny = new Set(
    input.jurisdiction
      ? JURISDICTION_DENY[input.jurisdiction.toUpperCase()] ?? []
      : [],
  );

  // 1. Start with the stage's unlocked set; intersect with role; subtract jurisdiction deny.
  const unlocked: CapabilityId[] = [];
  for (const cap of card.capabilitiesUnlocked) {
    if (!roleAllow.has(cap)) continue;
    if (jurisdictionDeny.has(cap)) continue;
    unlocked.push(cap);
  }

  // 2. Hidden = stage hidden list, intersected with role allow (we
  //    only need to hide things the role could otherwise see — capabilities
  //    that are already role-denied don't need a "hidden" entry).
  const hidden: CapabilityId[] = [];
  for (const cap of card.capabilitiesHidden) {
    if (roleAllow.has(cap)) hidden.push(cap);
  }

  // 3. Previewable = every known capability that's neither unlocked
  //    nor hidden, intersected with role allow. These are the "coming
  //    soon" slots the UI can show with a "you might want this when..."
  //    affordance pointing at the stage that unlocks them.
  const unlockedSet = new Set<CapabilityId>(unlocked);
  const hiddenSet = new Set<CapabilityId>(hidden);
  const previewable: CapabilityId[] = [];
  for (const cap of CAPABILITY_IDS) {
    if (unlockedSet.has(cap)) continue;
    if (hiddenSet.has(cap)) continue;
    if (!roleAllow.has(cap)) continue;
    if (jurisdictionDeny.has(cap)) continue;
    previewable.push(cap);
  }

  const recommendedFlagKeys = unlocked.map(
    (cap) => CAPABILITY_FLAG_KEYS[cap],
  );

  return {
    unlocked,
    hidden,
    previewable,
    recommendedFlagKeys,
  };
}
