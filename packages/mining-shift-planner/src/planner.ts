/**
 * `createMiningShiftPlanner` — composes the solver, fatigue scorer,
 * and OSHA validator into a dep-injected planner.
 */

import {
  FatigueExceededError,
  OshaViolationError,
  OverloadedScheduleError,
} from './errors.js';
import { scoreFatigue } from './fatigue.js';
import {
  buildComplianceReport,
  DEFAULT_OSHA_THRESHOLDS,
  type OshaThresholds,
} from './osha-rules.js';
import {
  createInMemoryAssignmentSink,
  createInMemoryOshaRulebook,
  NOOP_LOGGER,
  type AssignmentSinkPort,
  type Logger,
  type OshaRulebookPort,
} from './ports.js';
import { solveShiftPlan } from './solver.js';
import {
  shiftRequestSchema,
  workerSchema,
  type ComplianceReport,
  type FatigueScore,
  type ShiftPlan,
  type ShiftRequest,
  type WorkShiftRecord,
} from './types.js';

export interface MiningShiftPlannerDeps {
  readonly assignmentSink?: AssignmentSinkPort;
  readonly oshaRulebook?: OshaRulebookPort;
  readonly logger?: Logger;
  /**
   * When true, the planner throws `OshaViolationError` if any blocking
   * rule fails. Defaults to false — caller inspects the report and
   * decides.
   */
  readonly strictOsha?: boolean;
  /** Hard cap above which the planner refuses to assign. Default 0.85. */
  readonly fatigueHardCap?: number;
}

export interface MiningShiftPlanner {
  planShift(input: ShiftRequest): Promise<ShiftPlan>;
  evaluateFatigue(
    workerId: string,
    last72h: ReadonlyArray<WorkShiftRecord>,
  ): Promise<FatigueScore>;
  validateOshaCompliance(plan: ShiftPlan): Promise<ComplianceReport>;
}

export function createMiningShiftPlanner(
  deps: MiningShiftPlannerDeps = {},
): MiningShiftPlanner {
  const logger = deps.logger ?? NOOP_LOGGER;
  const assignmentSink = deps.assignmentSink ?? createInMemoryAssignmentSink();
  const oshaRulebook = deps.oshaRulebook ?? createInMemoryOshaRulebook();
  const strictOsha = deps.strictOsha ?? false;
  const fatigueHardCap = deps.fatigueHardCap ?? 0.85;

  // Cache of the latest source request keyed by plan signature so that
  // `validateOshaCompliance` can rebuild a report from the plan alone.
  const requestCache = new Map<string, ShiftRequest>();

  function planKey(plan: { tenantId: string; siteId: string; shiftStartISO: string }): string {
    return `${plan.tenantId}|${plan.siteId}|${plan.shiftStartISO}`;
  }

  async function buildThresholds(args: {
    readonly tenantId: string;
    readonly siteId: string;
  }): Promise<OshaThresholds> {
    const overrides = await oshaRulebook.fetchOverrides(args);
    return {
      maxShiftHours: overrides.maxShiftHours ?? DEFAULT_OSHA_THRESHOLDS.maxShiftHours,
      minRestHours: overrides.minRestHours ?? DEFAULT_OSHA_THRESHOLDS.minRestHours,
      maxConsecutiveDays:
        overrides.maxConsecutiveDays ?? DEFAULT_OSHA_THRESHOLDS.maxConsecutiveDays,
      undergroundMaxWeeklyHours:
        overrides.undergroundMaxWeeklyHours ??
        DEFAULT_OSHA_THRESHOLDS.undergroundMaxWeeklyHours,
      hazardRotationHours:
        overrides.hazardRotationHours ?? DEFAULT_OSHA_THRESHOLDS.hazardRotationHours,
      heatStressTempC:
        overrides.heatStressTempC ?? DEFAULT_OSHA_THRESHOLDS.heatStressTempC,
      safetyBriefingMaxAgeHours: DEFAULT_OSHA_THRESHOLDS.safetyBriefingMaxAgeHours,
    };
  }

  return {
    async planShift(rawInput) {
      const request = shiftRequestSchema.parse(rawInput);
      logger.info('shift-planner.plan.start', {
        tenantId: request.tenantId,
        siteId: request.siteId,
        shiftKind: request.shiftKind,
        workers: request.workers.length,
        equipment: request.equipment.length,
        tasks: request.tasks.length,
      });

      const thresholds = await buildThresholds({
        tenantId: request.tenantId,
        siteId: request.siteId,
      });

      // Pre-flight: refuse if any worker is over the fatigue hard cap.
      for (const worker of request.workers) {
        const fatigue = scoreFatigue({
          worker,
          asOfISO: request.shiftStartISO,
        });
        if (fatigue.score > fatigueHardCap) {
          throw new FatigueExceededError(worker.id, fatigue.score);
        }
      }

      const plan = solveShiftPlan(request, { thresholds });

      if (plan.unassignedTasks.length === plan.assignments.length + plan.unassignedTasks.length) {
        // Nothing assigned at all.
        throw new OverloadedScheduleError(
          plan.unassignedTasks.length,
          request.tasks.length,
        );
      }

      requestCache.set(planKey(plan), request);

      if (strictOsha) {
        const report = buildComplianceReport(request, plan, thresholds);
        if (!report.pass) {
          throw new OshaViolationError(report.blockingFailures);
        }
      }

      const { publishedCount } = await assignmentSink.publishAssignments({
        tenantId: request.tenantId,
        siteId: request.siteId,
        assignments: plan.assignments,
      });

      logger.info('shift-planner.plan.done', {
        assignments: plan.assignments.length,
        published: publishedCount,
        unassigned: plan.unassignedTasks.length,
        rotationAlerts: plan.rotationAlerts.length,
      });

      return plan;
    },

    async evaluateFatigue(workerId, last72h) {
      if (!workerId) {
        throw new Error('workerId required');
      }
      const parsedShifts = last72h.map((s) => ({ ...s }));
      // Parse via workerSchema to enforce immutability + shape.
      const stubWorker = workerSchema.parse({
        id: workerId,
        tenantId: '__transient__',
        name: workerId,
        certifications: [],
        shiftPreferences: [],
        last72hShifts: parsedShifts,
        lastSafetyBriefingISO: null,
      });
      const score = scoreFatigue({
        worker: stubWorker,
        asOfISO: new Date().toISOString(),
      });
      logger.info('shift-planner.fatigue.done', {
        workerId,
        score: score.score,
      });
      return score;
    },

    async validateOshaCompliance(plan) {
      const request = requestCache.get(planKey(plan));
      const thresholds = await buildThresholds({
        tenantId: plan.tenantId,
        siteId: plan.siteId,
      });
      if (!request) {
        // No cached request — synthesize a minimal report based on the
        // plan alone (rotation alerts only).
        return {
          tenantId: plan.tenantId,
          siteId: plan.siteId,
          shiftStartISO: plan.shiftStartISO,
          pass: plan.rotationAlerts.length === 0,
          results: [
            {
              ruleId: 'osha-tz-r3b',
              ruleLabel: 'Hazard-zone rotation alerts',
              pass: plan.rotationAlerts.length === 0,
              severity: plan.rotationAlerts.length === 0 ? 'info' : 'medium',
              affectedWorkerIds: plan.rotationAlerts.map((a) => a.workerId),
              detail:
                plan.rotationAlerts.length === 0
                  ? 'No hazard rotations pending.'
                  : `${plan.rotationAlerts.length} hazard-zone rotation(s) pending.`,
            },
          ],
          blockingFailures: [],
        };
      }
      return buildComplianceReport(request, plan, thresholds);
    },
  };
}
