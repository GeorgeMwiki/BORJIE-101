/**
 * Mine-planner advisor — produces a 24-hour shift plan by matching
 * polygons to equipment + crew across morning/afternoon/night shifts.
 *
 * Greedy + deterministic; sufficient for the daily-plan use case and
 * cheap enough to re-run on every LMBM update. A future iteration may
 * call an ILP solver, but the public surface stays the same.
 */

import {
  planInputSchema,
  planRecommendationContextSchema,
  type CrewMember,
  type Equipment,
  type EvidenceRef,
  type PlanInput,
  type PlanRecommendation,
  type PlanRecommendationContext,
  type Polygon,
  type ShiftPlan,
  type TaskAssignment,
} from './types.js';
import { NOOP_LOGGER, type Logger } from './ports.js';

export interface MinePlannerAdvisorDeps {
  readonly logger?: Logger;
}

export interface MinePlannerAdvisor {
  analyze(input: PlanInput): Promise<ShiftPlan>;
  recommend(
    context: PlanRecommendationContext,
  ): Promise<ReadonlyArray<PlanRecommendation>>;
}

const SHIFTS: ReadonlyArray<'morning' | 'afternoon' | 'night'> = [
  'morning',
  'afternoon',
  'night',
];
const HOURS_PER_SHIFT = 8;

export function createMinePlannerAdvisor(
  deps: MinePlannerAdvisorDeps = {},
): MinePlannerAdvisor {
  const logger = deps.logger ?? NOOP_LOGGER;
  return {
    async analyze(rawInput) {
      const input = planInputSchema.parse(rawInput);
      logger.info('mine-planner.analyze.start', {
        siteId: input.siteId,
        polygons: input.polygons.length,
        target: input.targetTonnesPerDay,
      });
      const plan = buildShiftPlan(input);
      logger.info('mine-planner.analyze.done', {
        assignments: plan.assignments.length,
        unmetTonnes: plan.unmetTonnes,
      });
      return plan;
    },
    async recommend(rawContext) {
      const context = planRecommendationContextSchema.parse(rawContext);
      const recs = deriveRecommendations(context);
      logger.info('mine-planner.recommend.done', { count: recs.length });
      return recs;
    },
  };
}

// ─── Plan construction ────────────────────────────────────────────

export function buildShiftPlan(input: PlanInput): ShiftPlan {
  const assignments: TaskAssignment[] = [];
  let remainingTarget = input.targetTonnesPerDay;
  const polygonsByTonnage = [...input.polygons].sort(
    (a, b) => b.estimatedTonnes - a.estimatedTonnes,
  );
  const equipmentByCapacity = [...input.fleet].sort(
    (a, b) => b.capacityTonnesPerHour - a.capacityTonnesPerHour,
  );
  const equipmentInUse = new Map<string, number>();

  for (const polygon of polygonsByTonnage) {
    if (remainingTarget <= 0) break;
    for (const shift of SHIFTS) {
      if (remainingTarget <= 0) break;
      const equipment = pickEquipment(
        equipmentByCapacity,
        equipmentInUse,
        input.planDateISO,
      );
      if (!equipment) break;
      const crew = pickCrew(input.crew, equipment.kind, shift);
      if (crew.length === 0) continue;
      const tonnesPossible = Math.min(
        polygon.estimatedTonnes,
        equipment.capacityTonnesPerHour * HOURS_PER_SHIFT,
        remainingTarget,
      );
      const hours = tonnesPossible / equipment.capacityTonnesPerHour;
      assignments.push({
        polygonId: polygon.id,
        shift,
        equipmentId: equipment.id,
        crewIds: crew.map((c) => c.id),
        estimatedTonnes: tonnesPossible,
        estimatedHours: hours,
        estimatedOpex: hours * equipment.hourlyOpex,
      });
      equipmentInUse.set(equipment.id, (equipmentInUse.get(equipment.id) ?? 0) + 1);
      remainingTarget -= tonnesPossible;
    }
  }

  const totalEstimatedTonnes = assignments.reduce(
    (s, a) => s + a.estimatedTonnes,
    0,
  );
  const totalEstimatedOpex = assignments.reduce(
    (s, a) => s + a.estimatedOpex,
    0,
  );

  return {
    siteId: input.siteId,
    planDateISO: input.planDateISO,
    assignments,
    totalEstimatedTonnes,
    totalEstimatedOpex,
    unmetTonnes: Math.max(0, input.targetTonnesPerDay - totalEstimatedTonnes),
  };
}

function pickEquipment(
  fleet: ReadonlyArray<Equipment>,
  inUse: Map<string, number>,
  planDateISO: string,
): Equipment | null {
  for (const eq of fleet) {
    if (planDateISO < eq.availableFromISO) continue;
    if (planDateISO > eq.availableToISO) continue;
    // Cap each equipment at 3 shifts/day (morning + afternoon + night).
    if ((inUse.get(eq.id) ?? 0) >= 3) continue;
    return eq;
  }
  return null;
}

function pickCrew(
  crew: ReadonlyArray<CrewMember>,
  kind: Equipment['kind'],
  shift: 'morning' | 'afternoon' | 'night',
): ReadonlyArray<CrewMember> {
  return crew.filter(
    (c) => c.skills.includes(kind) && c.shiftAvailability.includes(shift),
  );
}

// ─── Recommendations ──────────────────────────────────────────────

export function deriveRecommendations(
  context: PlanRecommendationContext,
): ReadonlyArray<PlanRecommendation> {
  const out: PlanRecommendation[] = [];
  const { input, plan } = context;

  // R1: unmet target
  if (plan.unmetTonnes > 0) {
    out.push({
      id: 'unmet-target',
      kind: 'add-shift',
      title: `Unmet target ${plan.unmetTonnes.toFixed(0)}t`,
      rationale:
        'Planned tonnage falls short of daily target. Consider adding an ' +
        'overlap shift, extending equipment availability, or rebalancing ' +
        'crew skills.',
      severity: 'high',
      evidence: [
        evidence('assignment', `plan.${plan.planDateISO}.unmet`),
      ],
    });
  }

  // R2: equipment skill gap
  const skillGaps = findSkillGaps(input, plan);
  for (const gap of skillGaps) {
    out.push({
      id: `skill-gap-${gap.kind}-${gap.shift}`,
      kind: 'hire-skill',
      title: `No crew with ${gap.kind} skill for ${gap.shift} shift`,
      rationale:
        `Polygon work for the ${gap.shift} shift requires ${gap.kind} ` +
        'capability but no rostered crew member has the matching skill.',
      severity: 'medium',
      evidence: [evidence('crew', `crew.skill.${gap.kind}.${gap.shift}`)],
    });
  }

  return out;
}

function findSkillGaps(
  input: PlanInput,
  plan: ShiftPlan,
): ReadonlyArray<{ kind: Equipment['kind']; shift: 'morning' | 'afternoon' | 'night' }> {
  const needed = new Set<string>();
  for (const a of plan.assignments) {
    const eq = input.fleet.find((e) => e.id === a.equipmentId);
    if (!eq) continue;
    needed.add(`${eq.kind}|${a.shift}`);
  }
  const gaps: { kind: Equipment['kind']; shift: 'morning' | 'afternoon' | 'night' }[] = [];
  for (const key of needed) {
    const parts = key.split('|');
    const kindStr = parts[0];
    const shiftStr = parts[1];
    if (!kindStr || !shiftStr) continue;
    const kind = kindStr as Equipment['kind'];
    const shift = shiftStr as 'morning' | 'afternoon' | 'night';
    const has = input.crew.some(
      (c) => c.skills.includes(kind) && c.shiftAvailability.includes(shift),
    );
    if (!has) gaps.push({ kind, shift });
  }
  return gaps;
}

function evidence(kind: EvidenceRef['kind'], pointer: string): EvidenceRef {
  return { id: `${kind}:${pointer}`, kind, pointer };
}

// ─── Polygon helpers ──────────────────────────────────────────────

/**
 * Shoelace formula for polygon area in square units of the provided
 * coordinates. Caller is responsible for projecting lat/lng to a
 * planar CRS first if real-world area is required.
 */
export function polygonAreaSqUnits(polygon: Polygon): number {
  const ring = polygon.ring;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const p0 = ring[i];
    const p1 = ring[i + 1];
    if (!p0 || !p1) continue;
    const [x0, y0] = p0;
    const [x1, y1] = p1;
    area += x0 * y1 - x1 * y0;
  }
  return Math.abs(area) / 2;
}
