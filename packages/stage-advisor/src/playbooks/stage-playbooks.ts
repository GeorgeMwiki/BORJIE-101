/**
 * Stage onboarding playbooks — one per OrgStage.
 *
 * Each playbook has a small set of objectives (typically 3-5) with
 * concrete tasks the org should walk through to feel "done" at that
 * stage. Tasks carry a `completionPredicate` that evaluates the org's
 * snapshot state — the brain calls these to decide which tasks to
 * surface as the next-best-action set.
 *
 * The predicates are deliberately tolerant — most accept a missing
 * field as `not done` rather than throwing — so the playbook still
 * evaluates against a sparsely-populated `OrgState`.
 */

import type {
  OrgStage,
  OrgState,
  PlaybookObjective,
  StagePlaybook,
} from '../types.js';

/**
 * Slim builder shape that the stage cards use. Lets us keep the per-
 * stage data as plain objects without re-stating the stage key on each
 * objective.
 */
export interface PlaybookSeed {
  readonly objectives: ReadonlyArray<PlaybookObjective>;
}

export function buildPlaybook(
  stage: OrgStage,
  seed: PlaybookSeed,
): StagePlaybook {
  return { stage, objectives: seed.objectives };
}

const pred = {
  orgSetupComplete: (s: OrgState) => s.orgSetupComplete === true,
  hasProperty: (s: OrgState) => s.propertyCount >= 1,
  hasFiveUnits: (s: OrgState) => s.unitsManaged >= 5,
  hasFirstLease: (s: OrgState) => s.leaseCount >= 1,
  hasPaymentMethod: (s: OrgState) => s.paymentMethodsConfigured >= 1,
  hasMaintenanceCategories: (s: OrgState) =>
    s.maintenanceCategoriesDefined >= 5,
  hasScheduledInspection: (s: OrgState) =>
    s.scheduledInspectionsConfigured >= 1,
  hasFiveVendors: (s: OrgState) => s.vendorCount >= 5,
  hasInventoryLocation: (s: OrgState) => s.inventoryLocationsCount >= 1,
  hasFirstRfq: (s: OrgState) => s.rfqCount >= 1,
  hasFleetVehicle: (s: OrgState) => s.fleetVehicleCount >= 1,
  hasReportCadence: (s: OrgState) => s.reportCadenceCount >= 1,
  hasRegion: (s: OrgState) => s.regionsConfigured >= 2,
  hasTreasuryAccount: (s: OrgState) => s.treasuryAccountCount >= 1,
  hasMultiJurisdiction: (s: OrgState) => s.jurisdictionsConfigured >= 2,
};

// ─────────────────────────────────────────────────────────────────────
// Per-stage playbooks
// ─────────────────────────────────────────────────────────────────────

export const PRE_LAUNCH_PLAYBOOK: PlaybookSeed = {
  objectives: [
    {
      id: 'pl-obj-1',
      name: 'Stand up your org',
      description: 'Finish the basics so the platform knows who you are.',
      tasks: [
        {
          id: 'pl-task-1-1',
          name: 'Complete org setup',
          description: 'Brand, legal entity, base currency, primary timezone.',
          requiredCapability: 'org-setup',
          completionPredicate: pred.orgSetupComplete,
        },
        {
          id: 'pl-task-1-2',
          name: 'Add your first property',
          description: 'Address, asset class, unit count.',
          requiredCapability: 'first-property',
          completionPredicate: pred.hasProperty,
        },
      ],
    },
    {
      id: 'pl-obj-2',
      name: 'Invite your team',
      description: 'Bring in the 1-2 people you operate with.',
      tasks: [
        {
          id: 'pl-task-2-1',
          name: 'Invite a co-manager',
          description: 'At least one other user to share the workload.',
          requiredCapability: 'org-setup',
          completionPredicate: (s) =>
            (typeof s.extra?.activeUsers === 'number'
              ? (s.extra.activeUsers as number)
              : 0) >= 2,
        },
      ],
    },
    {
      id: 'pl-obj-3',
      name: 'Plan your first lease',
      description: 'Get ready to onboard your first tenant.',
      tasks: [
        {
          id: 'pl-task-3-1',
          name: 'Configure a payment method',
          description: 'Connect M-Pesa, bank, card — at least one rail.',
          requiredCapability: 'payment-basics',
          completionPredicate: pred.hasPaymentMethod,
        },
      ],
    },
  ],
};

export const SEEDLING_PLAYBOOK: PlaybookSeed = {
  objectives: [
    {
      id: 'se-obj-1',
      name: 'Master the lease loop',
      description: 'Lease in, payment in, renewal coming up — repeatable.',
      tasks: [
        {
          id: 'se-task-1-1',
          name: 'Sign your first lease',
          description: 'Get a tenant signed on the platform.',
          requiredCapability: 'lease-lifecycle',
          completionPredicate: pred.hasFirstLease,
        },
        {
          id: 'se-task-1-2',
          name: 'Collect first month rent',
          description: 'Issue invoice + receive payment via configured rail.',
          requiredCapability: 'payment-basics',
          completionPredicate: pred.hasPaymentMethod,
        },
      ],
    },
    {
      id: 'se-obj-2',
      name: 'Open the communication channel',
      description: 'Tenant messaging works end-to-end.',
      tasks: [
        {
          id: 'se-task-2-1',
          name: 'Send first tenant broadcast',
          description: 'Confirm your messaging integration is reachable.',
          requiredCapability: 'communications',
          completionPredicate: (s) =>
            (typeof s.extra?.broadcastsSent === 'number'
              ? (s.extra.broadcastsSent as number)
              : 0) >= 1,
        },
      ],
    },
    {
      id: 'se-obj-3',
      name: 'Get to 5 units',
      description: 'Cross the threshold where workflows start to repeat.',
      tasks: [
        {
          id: 'se-task-3-1',
          name: 'Manage 5 units',
          description: 'You will start to feel patterns.',
          requiredCapability: 'lease-lifecycle',
          completionPredicate: pred.hasFiveUnits,
        },
      ],
    },
  ],
};

export const SPROUT_PLAYBOOK: PlaybookSeed = {
  objectives: [
    {
      id: 'sp-obj-1',
      name: 'Tame maintenance',
      description: 'Define the categories that match how you actually work.',
      tasks: [
        {
          id: 'sp-task-1-1',
          name: 'Define 5+ maintenance categories',
          description: 'Plumbing, electrical, HVAC, cleaning, common areas.',
          requiredCapability: 'maintenance-taxonomy',
          completionPredicate: pred.hasMaintenanceCategories,
        },
      ],
    },
    {
      id: 'sp-obj-2',
      name: 'Schedule the recurring work',
      description: 'Quarterly inspections, monthly common-area sweeps.',
      tasks: [
        {
          id: 'sp-task-2-1',
          name: 'Configure your first scheduled inspection',
          description: 'Pick a property, pick a cadence — quarterly is fine.',
          requiredCapability: 'scheduled-inspections',
          completionPredicate: pred.hasScheduledInspection,
        },
      ],
    },
    {
      id: 'sp-obj-3',
      name: 'Establish reporting cadence',
      description: 'Weekly arrears, monthly maintenance — habit-forming.',
      tasks: [
        {
          id: 'sp-task-3-1',
          name: 'Subscribe to weekly arrears digest',
          description: 'You should be looking at arrears every Monday.',
          requiredCapability: 'basic-reporting',
          completionPredicate: pred.hasReportCadence,
        },
      ],
    },
  ],
};

export const SAPLING_PLAYBOOK: PlaybookSeed = {
  objectives: [
    {
      id: 'sa-obj-1',
      name: 'Build your supplier bench',
      description: 'You can no longer hold all the vendors in your head.',
      tasks: [
        {
          id: 'sa-task-1-1',
          name: 'Register your top-5 suppliers',
          description: 'KYC, payment terms, SLA expectations on each.',
          requiredCapability: 'vendor-management',
          completionPredicate: pred.hasFiveVendors,
        },
      ],
    },
    {
      id: 'sa-obj-2',
      name: 'Set up inventory',
      description: 'Buy in bulk; track what you actually have on hand.',
      tasks: [
        {
          id: 'sa-task-2-1',
          name: 'Create your first inventory location',
          description: 'Usually the main warehouse or central hub.',
          requiredCapability: 'inventory-management',
          completionPredicate: pred.hasInventoryLocation,
        },
      ],
    },
    {
      id: 'sa-obj-3',
      name: 'Run your first RFQ',
      description: 'Procurement coordination — competitive sourcing.',
      tasks: [
        {
          id: 'sa-task-3-1',
          name: 'Publish your first RFQ',
          description: 'Start with a maintenance contract or paint job.',
          requiredCapability: 'procurement-coordination',
          completionPredicate: pred.hasFirstRfq,
        },
      ],
    },
  ],
};

export const TREE_PLAYBOOK: PlaybookSeed = {
  objectives: [
    {
      id: 'tr-obj-1',
      name: 'Move the fleet onto the platform',
      description: 'Vehicles, drivers, maintenance, fuel — one place.',
      tasks: [
        {
          id: 'tr-task-1-1',
          name: 'Register your first fleet vehicle',
          description: 'Start with the most-used pickup or service van.',
          requiredCapability: 'fleet-management',
          completionPredicate: pred.hasFleetVehicle,
        },
      ],
    },
    {
      id: 'tr-obj-2',
      name: 'Stand up the dedicated PM teams',
      description: 'Cluster properties so PMs own a coherent portfolio.',
      tasks: [
        {
          id: 'tr-task-2-1',
          name: 'Define 3+ PM portfolio clusters',
          description: 'By geography, by asset class, or by client.',
          requiredCapability: 'dedicated-pm-teams',
          completionPredicate: (s) =>
            (typeof s.extra?.pmClusterCount === 'number'
              ? (s.extra.pmClusterCount as number)
              : 0) >= 3,
        },
      ],
    },
    {
      id: 'tr-obj-3',
      name: 'Tighten the reporting cadence',
      description: 'Daily arrears, weekly NOI, monthly board pack.',
      tasks: [
        {
          id: 'tr-task-3-1',
          name: 'Subscribe to advanced reporting',
          description: 'NOI, capex pipeline, occupancy forecast — go beyond basic.',
          requiredCapability: 'advanced-reporting',
          completionPredicate: pred.hasReportCadence,
        },
      ],
    },
  ],
};

export const FOREST_PLAYBOOK: PlaybookSeed = {
  objectives: [
    {
      id: 'fo-obj-1',
      name: 'Carve into regions',
      description: 'A regional director per cluster, with their own P&L.',
      tasks: [
        {
          id: 'fo-task-1-1',
          name: 'Define 2+ operating regions',
          description: 'Each region gets its own ops command + treasury.',
          requiredCapability: 'regional-ops',
          completionPredicate: pred.hasRegion,
        },
      ],
    },
    {
      id: 'fo-obj-2',
      name: 'Stand up treasury',
      description: 'Cash-management at portfolio scale; FX matters now.',
      tasks: [
        {
          id: 'fo-task-2-1',
          name: 'Configure your first treasury account',
          description: 'Operating + reserve + escrow — split the pots.',
          requiredCapability: 'treasury',
          completionPredicate: pred.hasTreasuryAccount,
        },
      ],
    },
    {
      id: 'fo-obj-3',
      name: 'Plan expansion deliberately',
      description: 'Acquisition + development pipeline, ranked.',
      tasks: [
        {
          id: 'fo-task-3-1',
          name: 'Build the expansion pipeline',
          description: 'Use the expansion-advisor to rank opportunities.',
          requiredCapability: 'expansion-planning',
          completionPredicate: (s) =>
            (typeof s.extra?.expansionPipelineEntries === 'number'
              ? (s.extra.expansionPipelineEntries as number)
              : 0) >= 1,
        },
      ],
    },
  ],
};

export const ECOSYSTEM_PLAYBOOK: PlaybookSeed = {
  objectives: [
    {
      id: 'ec-obj-1',
      name: 'Operate across jurisdictions',
      description: 'Each country with its own compliance + tax regime.',
      tasks: [
        {
          id: 'ec-task-1-1',
          name: 'Configure 2+ jurisdictions',
          description: 'Tax rates, statutory holidays, compliance plugins.',
          requiredCapability: 'multi-jurisdiction',
          completionPredicate: pred.hasMultiJurisdiction,
        },
      ],
    },
    {
      id: 'ec-obj-2',
      name: 'Spin up IR / AOR reporting',
      description: 'Investor relations + annual operating reports cadence.',
      tasks: [
        {
          id: 'ec-task-2-1',
          name: 'Subscribe to IR / AOR monthly report',
          description: 'Auto-generated, board-ready.',
          requiredCapability: 'ir-aor-reports',
          completionPredicate: pred.hasReportCadence,
        },
      ],
    },
    {
      id: 'ec-obj-3',
      name: 'Light up the ops command center',
      description: 'Real-time operational picture across the whole estate.',
      tasks: [
        {
          id: 'ec-task-3-1',
          name: 'Enable ops command dashboard',
          description: 'Multi-region pulse + escalation routing.',
          requiredCapability: 'ops-command',
          completionPredicate: (s) =>
            (typeof s.extra?.opsCommandEnabled === 'boolean'
              ? (s.extra.opsCommandEnabled as boolean)
              : false) === true,
        },
      ],
    },
  ],
};
