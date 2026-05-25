/**
 * Stage taxonomy — the 7 named stages of org maturity.
 *
 * Each card is keyed primarily off `unitsManaged`. We deliberately
 * keep the cards as pure data so testing the "is this capability
 * unlocked at sapling stage" question is a simple lookup, not a
 * branchy if/else.
 *
 * Threshold rationale (units managed):
 *   pre-launch  — 0           never managed a property yet, finishing setup
 *   seedling    — 1-9         first 9 units; lease + payments are the world
 *   sprout      — 10-49       enough to need maintenance taxonomy + cadence
 *   sapling     — 50-199      procurement + inventory start to pay off
 *   tree        — 200-999     fleet + advanced reporting + dedicated PM team
 *   forest      — 1000-4999   regional ops + treasury + multi-region expansion
 *   ecosystem   — 5000+       full enterprise stack, multi-jurisdiction
 *
 * Capabilities a stage *unlocks* are visible + functional. Capabilities
 * a stage *hides* are removed from the UI to avoid overwhelming early
 * stages with modules they don't need yet. Anything not unlocked and
 * not hidden defaults to `previewable` — visible behind a "coming soon"
 * affordance so users know what's ahead without being blocked.
 */

import {
  buildPlaybook,
  PRE_LAUNCH_PLAYBOOK,
  SEEDLING_PLAYBOOK,
  SPROUT_PLAYBOOK,
  SAPLING_PLAYBOOK,
  TREE_PLAYBOOK,
  FOREST_PLAYBOOK,
  ECOSYSTEM_PLAYBOOK,
} from '../playbooks/stage-playbooks.js';
import type { CapabilityId, OrgStage, StageCard } from '../types.js';

/**
 * Lookup table — one entry per stage. The order matches the lifecycle
 * sequence so iterating yields a sensible "stage ladder" for UI render.
 */
export const STAGE_CARDS: Readonly<Record<OrgStage, StageCard>> = {
  'pre-launch': {
    name: 'pre-launch',
    displayName: 'Pre-launch',
    range: { min: 0, max: 0 },
    focusAreas: ['org-setup', 'first-property', 'invite-team'],
    capabilitiesUnlocked: ['org-setup', 'first-property'],
    capabilitiesHidden: [
      'procurement-coordination',
      'inventory-management',
      'fleet-management',
      'treasury',
      'multi-jurisdiction',
      'ir-aor-reports',
      'enterprise-stack',
      'ops-command',
      'regional-ops',
      'advanced-reporting',
      'dedicated-pm-teams',
      'vendor-management',
    ],
    recommendedTabs: ['setup', 'properties'],
    recommendedReports: [],
    recommendedAdvisors: ['onboarding'],
    stageOnboardingPlaybook: buildPlaybook('pre-launch', PRE_LAUNCH_PLAYBOOK),
  },
  seedling: {
    name: 'seedling',
    displayName: 'Seedling',
    range: { min: 1, max: 9 },
    focusAreas: ['lease', 'payments', 'communications'],
    capabilitiesUnlocked: [
      'org-setup',
      'first-property',
      'lease-lifecycle',
      'payment-basics',
      'communications',
    ],
    capabilitiesHidden: [
      'procurement-coordination',
      'inventory-management',
      'fleet-management',
      'treasury',
      'multi-jurisdiction',
      'ir-aor-reports',
      'enterprise-stack',
      'ops-command',
      'regional-ops',
      'advanced-reporting',
      'dedicated-pm-teams',
    ],
    recommendedTabs: ['dashboard', 'leases', 'payments', 'messaging'],
    recommendedReports: ['arrears-weekly'],
    recommendedAdvisors: ['lifecycle-advisor', 'role-aware-advisor'],
    stageOnboardingPlaybook: buildPlaybook('seedling', SEEDLING_PLAYBOOK),
  },
  sprout: {
    name: 'sprout',
    displayName: 'Sprout',
    range: { min: 10, max: 49 },
    focusAreas: ['maintenance', 'inspections', 'reporting-basics'],
    capabilitiesUnlocked: [
      'org-setup',
      'first-property',
      'lease-lifecycle',
      'payment-basics',
      'communications',
      'maintenance-taxonomy',
      'scheduled-inspections',
      'basic-reporting',
    ],
    capabilitiesHidden: [
      'fleet-management',
      'treasury',
      'multi-jurisdiction',
      'ir-aor-reports',
      'enterprise-stack',
      'ops-command',
      'regional-ops',
      'dedicated-pm-teams',
    ],
    recommendedTabs: [
      'dashboard',
      'leases',
      'payments',
      'maintenance',
      'inspections',
      'reports',
    ],
    recommendedReports: ['arrears-weekly', 'maintenance-monthly'],
    recommendedAdvisors: ['lifecycle-advisor', 'estate-department-advisor'],
    stageOnboardingPlaybook: buildPlaybook('sprout', SPROUT_PLAYBOOK),
  },
  sapling: {
    name: 'sapling',
    displayName: 'Sapling',
    range: { min: 50, max: 199 },
    focusAreas: ['procurement', 'inventory', 'vendor-management'],
    capabilitiesUnlocked: [
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
    ],
    capabilitiesHidden: [
      'multi-jurisdiction',
      'ir-aor-reports',
      'enterprise-stack',
      'ops-command',
    ],
    recommendedTabs: [
      'dashboard',
      'leases',
      'payments',
      'maintenance',
      'procurement',
      'inventory',
      'vendors',
      'reports',
    ],
    recommendedReports: [
      'arrears-weekly',
      'maintenance-monthly',
      'procurement-monthly',
      'inventory-quarterly',
    ],
    recommendedAdvisors: [
      'lifecycle-advisor',
      'estate-department-advisor',
      'estate-auto-management',
    ],
    stageOnboardingPlaybook: buildPlaybook('sapling', SAPLING_PLAYBOOK),
  },
  tree: {
    name: 'tree',
    displayName: 'Tree',
    range: { min: 200, max: 999 },
    focusAreas: ['fleet', 'advanced-reporting', 'dedicated-pm-teams'],
    capabilitiesUnlocked: [
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
    ],
    capabilitiesHidden: ['multi-jurisdiction', 'ir-aor-reports', 'enterprise-stack', 'ops-command'],
    recommendedTabs: [
      'dashboard',
      'leases',
      'payments',
      'maintenance',
      'procurement',
      'inventory',
      'vendors',
      'fleet',
      'reports',
      'teams',
    ],
    recommendedReports: [
      'arrears-weekly',
      'maintenance-monthly',
      'procurement-monthly',
      'inventory-quarterly',
      'fleet-monthly',
      'noi-monthly',
    ],
    recommendedAdvisors: [
      'lifecycle-advisor',
      'estate-department-advisor',
      'estate-auto-management',
      'expansion-advisor',
    ],
    stageOnboardingPlaybook: buildPlaybook('tree', TREE_PLAYBOOK),
  },
  forest: {
    name: 'forest',
    displayName: 'Forest',
    range: { min: 1000, max: 4999 },
    focusAreas: ['regional-ops', 'treasury', 'expansion'],
    capabilitiesUnlocked: [
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
      'treasury',
      'expansion-planning',
    ],
    capabilitiesHidden: ['multi-jurisdiction', 'ir-aor-reports'],
    recommendedTabs: [
      'dashboard',
      'leases',
      'payments',
      'maintenance',
      'procurement',
      'inventory',
      'vendors',
      'fleet',
      'reports',
      'teams',
      'regions',
      'treasury',
    ],
    recommendedReports: [
      'arrears-daily',
      'maintenance-monthly',
      'procurement-monthly',
      'inventory-monthly',
      'fleet-monthly',
      'noi-monthly',
      'treasury-weekly',
      'expansion-quarterly',
    ],
    recommendedAdvisors: [
      'lifecycle-advisor',
      'estate-department-advisor',
      'estate-auto-management',
      'expansion-advisor',
      'acquisition-advisor',
    ],
    stageOnboardingPlaybook: buildPlaybook('forest', FOREST_PLAYBOOK),
  },
  ecosystem: {
    name: 'ecosystem',
    displayName: 'Ecosystem',
    range: { min: 5000, max: null },
    focusAreas: ['enterprise-stack', 'multi-jurisdiction', 'ops-command'],
    capabilitiesUnlocked: [
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
      'treasury',
      'expansion-planning',
      'multi-jurisdiction',
      'ir-aor-reports',
      'enterprise-stack',
      'ops-command',
    ],
    capabilitiesHidden: [],
    recommendedTabs: [
      'dashboard',
      'leases',
      'payments',
      'maintenance',
      'procurement',
      'inventory',
      'vendors',
      'fleet',
      'reports',
      'teams',
      'regions',
      'treasury',
      'jurisdictions',
      'ops-command',
    ],
    recommendedReports: [
      'arrears-daily',
      'maintenance-weekly',
      'procurement-weekly',
      'inventory-monthly',
      'fleet-weekly',
      'noi-monthly',
      'treasury-daily',
      'expansion-quarterly',
      'ir-aor-monthly',
      'multi-jurisdiction-quarterly',
    ],
    recommendedAdvisors: [
      'lifecycle-advisor',
      'estate-department-advisor',
      'estate-auto-management',
      'expansion-advisor',
      'acquisition-advisor',
      'sustainability-advisor',
      'green-angle-advisor',
    ],
    stageOnboardingPlaybook: buildPlaybook('ecosystem', ECOSYSTEM_PLAYBOOK),
  },
};

/**
 * Iteration helper — returns stages in lifecycle order.
 */
export const STAGE_ORDER: ReadonlyArray<OrgStage> = [
  'pre-launch',
  'seedling',
  'sprout',
  'sapling',
  'tree',
  'forest',
  'ecosystem',
];

/**
 * Map every known capability to the set of stages that unlock it. Used
 * for the "you might want this when..." preview affordance.
 */
export function stagesUnlocking(capability: CapabilityId): ReadonlyArray<OrgStage> {
  const out: OrgStage[] = [];
  for (const stage of STAGE_ORDER) {
    if (STAGE_CARDS[stage].capabilitiesUnlocked.includes(capability)) {
      out.push(stage);
    }
  }
  return out;
}

/**
 * Returns the earliest stage that unlocks the given capability, or
 * `null` if no stage ever does (a misconfigured capability).
 */
export function firstStageUnlocking(capability: CapabilityId): OrgStage | null {
  for (const stage of STAGE_ORDER) {
    if (STAGE_CARDS[stage].capabilitiesUnlocked.includes(capability)) {
      return stage;
    }
  }
  return null;
}
