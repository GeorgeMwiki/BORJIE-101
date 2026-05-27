/**
 * Greedy + deterministic shift-plan constraint solver.
 *
 * Steps:
 *   1. Sort tasks by required-cert count descending (hardest first).
 *   2. For each task, pick the worker with the lowest fatigue who
 *      holds all required certs and prefers the shift kind.
 *   3. Pick the first available equipment whose `requiredCertification`
 *      the worker holds.
 *   4. Reject if either pick is impossible.
 *
 * Hazard-zone rotation: workers assigned to underground or surface-pit
 * tasks are flagged for a rotation swap at `hazardRotationHours` into
 * the shift.
 *
 * The solver itself does not enforce OSHA rules — that is the
 * `validateOshaCompliance` step. The solver only ensures every chosen
 * assignment matches a worker's certifications + equipment requirements
 * and respects fatigue caps.
 */

import { scoreFatigue } from './fatigue.js';
import { DEFAULT_OSHA_THRESHOLDS, type OshaThresholds } from './osha-rules.js';
import {
  shiftRequestSchema,
  type Certification,
  type Equipment,
  type ShiftAssignment,
  type ShiftPlan,
  type ShiftRequest,
  type ShiftTask,
  type Worker,
} from './types.js';

const HOUR_MS = 60 * 60 * 1000;

export interface SolveDeps {
  readonly thresholds?: OshaThresholds;
}

export function solveShiftPlan(
  rawRequest: ShiftRequest,
  deps: SolveDeps = {},
): ShiftPlan {
  const request = shiftRequestSchema.parse(rawRequest);
  const thresholds = deps.thresholds ?? DEFAULT_OSHA_THRESHOLDS;

  const assignments: ShiftAssignment[] = [];
  const unassigned: { taskId: string; reason: string }[] = [];
  const usedWorkers = new Set<string>();
  const usedEquipment = new Set<string>();

  const tasks = [...request.tasks].sort(
    (a, b) =>
      (b.requiredCertifications.length ?? 0) -
      (a.requiredCertifications.length ?? 0),
  );

  const shiftEnd = new Date(
    new Date(request.shiftStartISO).getTime() +
      request.durationHours * HOUR_MS,
  );

  for (const task of tasks) {
    const candidates = pickCandidates({
      task,
      workers: request.workers,
      equipment: request.equipment,
      usedWorkers,
      usedEquipment,
      shiftStartISO: request.shiftStartISO,
      shiftEndISO: shiftEnd.toISOString(),
      maxRecommendedHours: request.durationHours,
    });

    if (!candidates) {
      unassigned.push({
        taskId: task.id,
        reason: buildUnassignedReason(task, request),
      });
      continue;
    }

    const { worker, equipment, fatigueScore } = candidates;
    assignments.push({
      taskId: task.id,
      workerId: worker.id,
      equipmentId: equipment.id,
      zone: task.zone,
      startISO: request.shiftStartISO,
      endISO: shiftEnd.toISOString(),
      fatigueAtAssignment: fatigueScore,
    });
    usedWorkers.add(worker.id);
    usedEquipment.add(equipment.id);
  }

  const rotationAlerts = buildRotationAlerts(
    assignments,
    request,
    thresholds.hazardRotationHours,
  );

  return {
    tenantId: request.tenantId,
    siteId: request.siteId,
    shiftStartISO: request.shiftStartISO,
    shiftEndISO: shiftEnd.toISOString(),
    shiftKind: request.shiftKind,
    assignments,
    unassignedTasks: unassigned,
    rotationAlerts,
  };
}

// ─── Candidate selection ────────────────────────────────────────────

interface PickArgs {
  readonly task: ShiftTask;
  readonly workers: ReadonlyArray<Worker>;
  readonly equipment: ReadonlyArray<Equipment>;
  readonly usedWorkers: ReadonlySet<string>;
  readonly usedEquipment: ReadonlySet<string>;
  readonly shiftStartISO: string;
  readonly shiftEndISO: string;
  readonly maxRecommendedHours: number;
}

interface CandidatePick {
  readonly worker: Worker;
  readonly equipment: Equipment;
  readonly fatigueScore: number;
}

function pickCandidates(args: PickArgs): CandidatePick | null {
  const eligibleWorkers = args.workers
    .filter((w) => !args.usedWorkers.has(w.id))
    .filter((w) => hasAllCertifications(w, args.task.requiredCertifications))
    .map((w) => {
      const fatigue = scoreFatigue({
        worker: w,
        asOfISO: args.shiftStartISO,
      });
      return { worker: w, fatigue };
    })
    .filter((c) => c.fatigue.recommendedMaxHours >= args.maxRecommendedHours)
    .sort((a, b) => a.fatigue.score - b.fatigue.score);

  if (eligibleWorkers.length === 0) return null;

  for (const candidate of eligibleWorkers) {
    const eq = pickEquipmentForWorker({
      worker: candidate.worker,
      task: args.task,
      equipment: args.equipment,
      usedEquipment: args.usedEquipment,
      shiftStartISO: args.shiftStartISO,
      shiftEndISO: args.shiftEndISO,
    });
    if (eq) {
      return {
        worker: candidate.worker,
        equipment: eq,
        fatigueScore: candidate.fatigue.score,
      };
    }
  }
  return null;
}

function hasAllCertifications(
  worker: Worker,
  required: ReadonlyArray<Certification>,
): boolean {
  for (const cert of required) {
    if (!worker.certifications.includes(cert)) return false;
  }
  return true;
}

interface EquipmentPickArgs {
  readonly worker: Worker;
  readonly task: ShiftTask;
  readonly equipment: ReadonlyArray<Equipment>;
  readonly usedEquipment: ReadonlySet<string>;
  readonly shiftStartISO: string;
  readonly shiftEndISO: string;
}

function pickEquipmentForWorker(args: EquipmentPickArgs): Equipment | null {
  for (const eq of args.equipment) {
    if (args.usedEquipment.has(eq.id)) continue;
    if (!args.task.requiredEquipment.includes(eq.kind)) continue;
    if (args.shiftStartISO < eq.availableFromISO) continue;
    if (args.shiftEndISO > eq.availableToISO) continue;
    if (!args.worker.certifications.includes(eq.requiredCertification)) continue;
    return eq;
  }
  return null;
}

// ─── Reason + alerts ────────────────────────────────────────────────

function buildUnassignedReason(
  task: ShiftTask,
  request: ShiftRequest,
): string {
  // Diagnose the most likely cause for caller visibility.
  const anyWorkerHasCerts = request.workers.some((w) =>
    hasAllCertifications(w, task.requiredCertifications),
  );
  if (!anyWorkerHasCerts) {
    return `No worker holds required certifications: ${task.requiredCertifications.join(', ') || 'n/a'}`;
  }
  const anyEqMatches = request.equipment.some((e) =>
    task.requiredEquipment.includes(e.kind),
  );
  if (!anyEqMatches) {
    return `No equipment matches required kinds: ${task.requiredEquipment.join(', ')}`;
  }
  return 'All eligible workers or equipment already assigned';
}

function buildRotationAlerts(
  assignments: ReadonlyArray<ShiftAssignment>,
  request: ShiftRequest,
  rotationHours: number,
): ShiftPlan['rotationAlerts'] {
  const alerts: ShiftPlan['rotationAlerts'] = [];
  const hazardZones = new Set(['underground', 'surface-pit']);
  for (const a of assignments) {
    if (!hazardZones.has(a.zone)) continue;
    if (request.durationHours <= rotationHours) continue;
    const at = new Date(
      new Date(a.startISO).getTime() + rotationHours * HOUR_MS,
    ).toISOString();
    alerts.push({
      workerId: a.workerId,
      atISO: at,
      label: `Hazard-zone rotation required after ${rotationHours}h in ${a.zone}`,
    });
  }
  return alerts;
}
