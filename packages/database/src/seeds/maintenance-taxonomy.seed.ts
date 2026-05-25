/**
 * Maintenance Problem Taxonomy — Platform Default Seed (Wave 8, S7)
 *
 * Seeds the curated, cross-tenant catalog of maintenance problem categories
 * and problems. Rows inserted here use `tenantId = NULL` so every org sees
 * them as platform defaults. Orgs may override any entry by inserting a row
 * with the same `code` scoped to their own `tenantId` — the domain service
 * prefers tenant-scoped rows over platform defaults when merging.
 *
 * Idempotency:
 *   - Deterministic natural-key IDs: `mpc-default-<category_code>` and
 *     `mp-default-<problem_code>`.
 *   - ON CONFLICT DO NOTHING on the (tenant_id, code) unique constraint.
 *   - Safe to run repeatedly; re-running will not duplicate or overwrite.
 *
 * This is a PLATFORM-level seed (not org-specific), so unlike `demo-org-seed.ts`
 * it is NOT gated behind `SEED_ORG_SEEDS`. It can ship in every environment.
 */

import type { DatabaseClient } from '../client.js';
import {
  maintenanceProblemCategories,
  maintenanceProblems,
} from '../schemas/maintenance-taxonomy.schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = 'low' | 'medium' | 'high' | 'critical' | 'emergency';

interface SeedCategory {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly displayOrder: number;
  readonly iconName: string;
}

interface SeedProblem {
  readonly categoryCode: string;
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly defaultSeverity: Severity;
  readonly defaultSlaHours: number;
  readonly suggestedVendorTags: readonly string[];
}

// ---------------------------------------------------------------------------
// Categories (8) — professional real-estate taxonomy
// ---------------------------------------------------------------------------

const CATEGORIES: readonly SeedCategory[] = [
  {
    code: 'plumbing',
    name: 'Plumbing',
    description: 'Water supply, drainage, fixtures, and piping issues.',
    displayOrder: 10,
    iconName: 'droplet',
  },
  {
    code: 'electrical',
    name: 'Electrical',
    description: 'Power, wiring, outlets, switches, and lighting.',
    displayOrder: 20,
    iconName: 'zap',
  },
  {
    code: 'hvac',
    name: 'HVAC',
    description: 'Heating, ventilation, and air conditioning.',
    displayOrder: 30,
    iconName: 'wind',
  },
  {
    code: 'appliances',
    name: 'Appliances',
    description: 'Fridges, stoves, dishwashers, washers, and built-in units.',
    displayOrder: 40,
    iconName: 'home',
  },
  {
    code: 'structural',
    name: 'Structural',
    description: 'Walls, roof, floors, doors, windows, and load-bearing elements.',
    displayOrder: 50,
    iconName: 'layout',
  },
  {
    code: 'finishes',
    name: 'Finishes',
    description: 'Paint, tiles, carpeting, and cosmetic surface issues.',
    displayOrder: 60,
    iconName: 'brush',
  },
  {
    code: 'pest_control',
    name: 'Pest Control',
    description: 'Rodents, insects, termites, and infestations.',
    displayOrder: 70,
    iconName: 'bug',
  },
  {
    code: 'safety',
    name: 'Safety',
    description: 'Fire, smoke, locks, and safety-equipment issues.',
    displayOrder: 80,
    iconName: 'shield',
  },
];

// ---------------------------------------------------------------------------
// Problems (~40) — common real-estate maintenance issues
// ---------------------------------------------------------------------------

const PROBLEMS: readonly SeedProblem[] = [
  // Plumbing
  {
    categoryCode: 'plumbing',
    code: 'leaking_tap',
    name: 'Leaking tap',
    description: 'A tap or faucet that drips continuously or on open.',
    defaultSeverity: 'medium',
    defaultSlaHours: 48,
    suggestedVendorTags: ['plumber'],
  },
  {
    categoryCode: 'plumbing',
    code: 'blocked_drain',
    name: 'Blocked drain',
    description: 'Sink, shower, or floor drain is not draining.',
    defaultSeverity: 'high',
    defaultSlaHours: 24,
    suggestedVendorTags: ['plumber'],
  },
  {
    categoryCode: 'plumbing',
    code: 'burst_pipe',
    name: 'Burst pipe',
    description: 'Ruptured water pipe causing active leak or flooding.',
    defaultSeverity: 'critical',
    defaultSlaHours: 4,
    suggestedVendorTags: ['plumber', 'emergency'],
  },
  {
    categoryCode: 'plumbing',
    code: 'no_hot_water',
    name: 'No hot water',
    description: 'Hot water supply is unavailable at one or more fixtures.',
    defaultSeverity: 'medium',
    defaultSlaHours: 48,
    suggestedVendorTags: ['plumber'],
  },
  {
    categoryCode: 'plumbing',
    code: 'toilet_not_flushing',
    name: 'Toilet not flushing',
    description: 'Toilet does not flush or flushes incompletely.',
    defaultSeverity: 'high',
    defaultSlaHours: 24,
    suggestedVendorTags: ['plumber'],
  },

  // Electrical
  {
    categoryCode: 'electrical',
    code: 'blown_fuse',
    name: 'Blown fuse / tripped breaker',
    description: 'Circuit breaker or fuse has tripped, disabling a circuit.',
    defaultSeverity: 'high',
    defaultSlaHours: 12,
    suggestedVendorTags: ['electrician'],
  },
  {
    categoryCode: 'electrical',
    code: 'no_power',
    name: 'No power',
    description: 'Total loss of power to unit or property.',
    defaultSeverity: 'critical',
    defaultSlaHours: 4,
    suggestedVendorTags: ['electrician', 'emergency'],
  },
  {
    categoryCode: 'electrical',
    code: 'faulty_socket',
    name: 'Faulty socket',
    description: 'Power outlet is loose, sparking, or not providing power.',
    defaultSeverity: 'medium',
    defaultSlaHours: 48,
    suggestedVendorTags: ['electrician'],
  },
  {
    categoryCode: 'electrical',
    code: 'flickering_lights',
    name: 'Flickering lights',
    description: 'Lights flicker, dim, or turn on/off intermittently.',
    defaultSeverity: 'low',
    defaultSlaHours: 96,
    suggestedVendorTags: ['electrician'],
  },
  {
    categoryCode: 'electrical',
    code: 'exposed_wiring',
    name: 'Exposed wiring',
    description: 'Bare or frayed wiring visible — immediate shock/fire risk.',
    defaultSeverity: 'critical',
    defaultSlaHours: 4,
    suggestedVendorTags: ['electrician', 'emergency'],
  },

  // HVAC
  {
    categoryCode: 'hvac',
    code: 'ac_not_cooling',
    name: 'AC not cooling',
    description: 'Air conditioning unit runs but does not cool the room.',
    defaultSeverity: 'medium',
    defaultSlaHours: 48,
    suggestedVendorTags: ['hvac_technician'],
  },
  {
    categoryCode: 'hvac',
    code: 'ac_noisy',
    name: 'AC noisy',
    description: 'Air conditioning unit produces abnormal noise in operation.',
    defaultSeverity: 'low',
    defaultSlaHours: 96,
    suggestedVendorTags: ['hvac_technician'],
  },
  {
    categoryCode: 'hvac',
    code: 'no_ventilation',
    name: 'No ventilation',
    description: 'Extractor fans or ventilation ducts are not functioning.',
    defaultSeverity: 'medium',
    defaultSlaHours: 48,
    suggestedVendorTags: ['hvac_technician'],
  },
  {
    categoryCode: 'hvac',
    code: 'thermostat_broken',
    name: 'Thermostat broken',
    description: 'Thermostat is unresponsive or reading incorrect temperature.',
    defaultSeverity: 'low',
    defaultSlaHours: 96,
    suggestedVendorTags: ['hvac_technician'],
  },

  // Appliances
  {
    categoryCode: 'appliances',
    code: 'fridge_not_cooling',
    name: 'Fridge not cooling',
    description: 'Refrigerator is not maintaining cold temperature.',
    defaultSeverity: 'medium',
    defaultSlaHours: 48,
    suggestedVendorTags: ['appliance_technician'],
  },
  {
    categoryCode: 'appliances',
    code: 'stove_burner_out',
    name: 'Stove burner out',
    description: 'One or more stove burners are not igniting or heating.',
    defaultSeverity: 'low',
    defaultSlaHours: 96,
    suggestedVendorTags: ['appliance_technician'],
  },
  {
    categoryCode: 'appliances',
    code: 'dishwasher_leak',
    name: 'Dishwasher leak',
    description: 'Dishwasher leaking water during or after cycle.',
    defaultSeverity: 'medium',
    defaultSlaHours: 48,
    suggestedVendorTags: ['appliance_technician', 'plumber'],
  },
  {
    categoryCode: 'appliances',
    code: 'washer_broken',
    name: 'Washer broken',
    description: 'Washing machine does not start, spin, or drain.',
    defaultSeverity: 'medium',
    defaultSlaHours: 72,
    suggestedVendorTags: ['appliance_technician'],
  },

  // Structural
  {
    categoryCode: 'structural',
    code: 'crack_in_wall',
    name: 'Crack in wall',
    description: 'Visible crack in interior or exterior wall.',
    defaultSeverity: 'high',
    defaultSlaHours: 72,
    suggestedVendorTags: ['mason', 'structural_engineer'],
  },
  {
    categoryCode: 'structural',
    code: 'damp_patch',
    name: 'Damp patch',
    description: 'Damp or mould patch on wall, ceiling, or floor.',
    defaultSeverity: 'medium',
    defaultSlaHours: 72,
    suggestedVendorTags: ['mason', 'waterproofing'],
  },
  {
    categoryCode: 'structural',
    code: 'roof_leak',
    name: 'Roof leak',
    description: 'Water ingress through the roof or ceiling.',
    defaultSeverity: 'critical',
    defaultSlaHours: 12,
    suggestedVendorTags: ['roofer', 'emergency'],
  },
  {
    categoryCode: 'structural',
    code: 'door_broken',
    name: 'Door broken',
    description: 'Door does not close, lock, or is off its hinges.',
    defaultSeverity: 'medium',
    defaultSlaHours: 48,
    suggestedVendorTags: ['carpenter'],
  },
  {
    categoryCode: 'structural',
    code: 'window_broken',
    name: 'Window broken',
    description: 'Broken pane, frame, or window mechanism.',
    defaultSeverity: 'high',
    defaultSlaHours: 24,
    suggestedVendorTags: ['glazier', 'carpenter'],
  },
  {
    categoryCode: 'structural',
    code: 'floor_damage',
    name: 'Floor damage',
    description: 'Damage to flooring material or subfloor.',
    defaultSeverity: 'medium',
    defaultSlaHours: 72,
    suggestedVendorTags: ['carpenter', 'mason'],
  },

  // Finishes
  {
    categoryCode: 'finishes',
    code: 'paint_peeling',
    name: 'Paint peeling',
    description: 'Interior or exterior paint peeling, flaking, or bubbling.',
    defaultSeverity: 'low',
    defaultSlaHours: 168,
    suggestedVendorTags: ['painter'],
  },
  {
    categoryCode: 'finishes',
    code: 'tile_loose',
    name: 'Tile loose',
    description: 'Floor or wall tile loose, cracked, or missing.',
    defaultSeverity: 'low',
    defaultSlaHours: 168,
    suggestedVendorTags: ['tiler', 'mason'],
  },
  {
    categoryCode: 'finishes',
    code: 'carpet_damaged',
    name: 'Carpet damaged',
    description: 'Carpeting torn, stained, or detached.',
    defaultSeverity: 'low',
    defaultSlaHours: 168,
    suggestedVendorTags: ['flooring'],
  },

  // Pest control
  {
    categoryCode: 'pest_control',
    code: 'rodents',
    name: 'Rodents',
    description: 'Rats or mice present on premises.',
    defaultSeverity: 'high',
    defaultSlaHours: 48,
    suggestedVendorTags: ['pest_control'],
  },
  {
    categoryCode: 'pest_control',
    code: 'cockroaches',
    name: 'Cockroaches',
    description: 'Cockroach infestation in unit or property.',
    defaultSeverity: 'medium',
    defaultSlaHours: 72,
    suggestedVendorTags: ['pest_control'],
  },
  {
    categoryCode: 'pest_control',
    code: 'termites',
    name: 'Termites',
    description: 'Termite activity or visible damage to wood.',
    defaultSeverity: 'critical',
    defaultSlaHours: 24,
    suggestedVendorTags: ['pest_control', 'structural_engineer'],
  },

  // Safety
  {
    categoryCode: 'safety',
    code: 'smoke_detector_beeping',
    name: 'Smoke detector beeping',
    description: 'Smoke detector chirping or alarming without fire.',
    defaultSeverity: 'medium',
    defaultSlaHours: 24,
    suggestedVendorTags: ['electrician', 'safety'],
  },
  {
    categoryCode: 'safety',
    code: 'fire_extinguisher_expired',
    name: 'Fire extinguisher expired',
    description: 'Fire extinguisher past its certified service date.',
    defaultSeverity: 'high',
    defaultSlaHours: 48,
    suggestedVendorTags: ['safety'],
  },
  {
    categoryCode: 'safety',
    code: 'broken_lock',
    name: 'Broken lock',
    description: 'Entry lock not securing door — security risk.',
    defaultSeverity: 'high',
    defaultSlaHours: 24,
    suggestedVendorTags: ['locksmith'],
  },
  {
    categoryCode: 'safety',
    code: 'missing_safety_sign',
    name: 'Missing safety sign',
    description: 'Required safety or exit signage is missing or illegible.',
    defaultSeverity: 'low',
    defaultSlaHours: 168,
    suggestedVendorTags: ['safety'],
  },
];

// ---------------------------------------------------------------------------
// Seed runner
// ---------------------------------------------------------------------------

/**
 * Seed platform-default maintenance taxonomy (NULL tenant rows).
 *
 * Idempotent — safe to re-run. Existing rows with matching (tenantId=NULL,
 * code) are left untouched via ON CONFLICT DO NOTHING.
 */
export async function seedMaintenanceTaxonomyPlatformDefaults(
  db: DatabaseClient,
): Promise<{ categoriesInserted: number; problemsInserted: number }> {
  // Build category rows with deterministic IDs.
  const categoryRows = CATEGORIES.map((c) => ({
    id: `mpc-default-${c.code}`,
    tenantId: null,
    code: c.code,
    name: c.name,
    description: c.description,
    displayOrder: c.displayOrder,
    iconName: c.iconName,
    active: true,
  }));

  // Build problem rows with deterministic IDs, resolving category references
  // to the platform-default category IDs.
  const problemRows = PROBLEMS.map((p) => ({
    id: `mp-default-${p.code}`,
    tenantId: null,
    categoryId: `mpc-default-${p.categoryCode}`,
    code: p.code,
    name: p.name,
    description: p.description,
    defaultSeverity: p.defaultSeverity,
    defaultSlaHours: p.defaultSlaHours,
    assetTypeScope: [] as string[],
    roomScope: [] as string[],
    evidenceRequired: true,
    suggestedVendorTags: [...p.suggestedVendorTags],
    active: true,
    metadata: {},
  }));

  await db.transaction(async (tx) => {
    // Insert categories first so problems' FK references resolve.
    await tx
      .insert(maintenanceProblemCategories)
      .values(categoryRows)
      .onConflictDoNothing({
        target: [
          maintenanceProblemCategories.tenantId,
          maintenanceProblemCategories.code,
        ],
      });

    await tx
      .insert(maintenanceProblems)
      .values(problemRows)
      .onConflictDoNothing({
        target: [maintenanceProblems.tenantId, maintenanceProblems.code],
      });
  });

  return {
    categoriesInserted: categoryRows.length,
    problemsInserted: problemRows.length,
  };
}

// Re-export the raw data so tests and other consumers can reference the
// curated catalog without re-running the seed.
export const PLATFORM_DEFAULT_CATEGORIES = CATEGORIES;
export const PLATFORM_DEFAULT_PROBLEMS = PROBLEMS;
