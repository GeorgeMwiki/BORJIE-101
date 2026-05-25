/**
 * Agency — initiative / wake-loop.
 *
 * Periodic detector loop. For each tenant, every wake-trigger runs its
 * `detect()` method and may emit zero or more goal openers. Each
 * detected goal is opened via `goals.open(...)` and immediately handed
 * to `executor.executeGoal(...)`.
 *
 * The loop is single-pass: callers schedule it (cron, queue worker,
 * SaaS scheduler). Trigger-level failures are isolated — a failing
 * detector or executor for one trigger never stops the others.
 */
import type {
  GoalPriority,
  GoalsPort,
  GoalStep,
  GoalStepDraft,
} from '../goals/types.js';
import type { Executor, ExecutorOutcome } from '../executor/executor.js';
import { logger } from '../../../logger.js';

export interface WakeTriggerDetectArgs {
  readonly tenantId: string;
  readonly clock: () => Date;
}

export interface WakeTriggerDetectedGoal {
  readonly userId: string;
  readonly threadId: string;
  readonly title: string;
  readonly description: string;
  readonly priority: GoalPriority;
  readonly steps: ReadonlyArray<
    Omit<
      GoalStep,
      'id' | 'status' | 'startedAt' | 'endedAt' | 'outcome' | 'errorMessage'
    >
  >;
}

export interface WakeTrigger {
  readonly id: string;
  readonly description: string;
  readonly cron?: string;
  detect(
    args: WakeTriggerDetectArgs,
  ): Promise<ReadonlyArray<WakeTriggerDetectedGoal>>;
}

export interface WakeLoopDeps {
  readonly goals: GoalsPort;
  readonly executor: Pick<Executor, 'executeGoal'>;
  readonly triggers: ReadonlyArray<WakeTrigger>;
  readonly clock?: () => Date;
}

export interface WakeCycleArgs {
  readonly tenantIds: ReadonlyArray<string>;
}

export interface WakeCycleOutcome {
  readonly goalsOpened: number;
  readonly goalsExecuted: number;
  readonly perTrigger: Record<string, number>;
}

export async function runWakeCycle(
  args: WakeCycleArgs,
  deps: WakeLoopDeps,
): Promise<WakeCycleOutcome> {
  const clock = deps.clock ?? (() => new Date());
  const perTrigger: Record<string, number> = {};
  let goalsOpened = 0;
  let goalsExecuted = 0;

  for (const trigger of deps.triggers) {
    perTrigger[trigger.id] = 0;
  }

  for (const tenantId of args.tenantIds) {
    if (!tenantId) continue;
    for (const trigger of deps.triggers) {
      let detected: ReadonlyArray<WakeTriggerDetectedGoal> = [];
      try {
        detected = await trigger.detect({ tenantId, clock });
      } catch (err) {
        logger.error(`agency-wake-loop: trigger '${trigger.id}' detect failed for tenant '${tenantId}'`, { error: err });
        continue;
      }

      for (const opener of detected) {
        let goalId: string | null = null;
        try {
          const stepDrafts: ReadonlyArray<GoalStepDraft> = opener.steps.map(
            (s) => ({
              seq: s.seq,
              description: s.description,
              toolName: s.toolName,
              toolPayload: s.toolPayload,
            }),
          );
          const opened = await deps.goals.open({
            tenantId,
            userId: opener.userId,
            threadId: opener.threadId,
            title: opener.title,
            description: opener.description,
            status: 'active',
            priority: opener.priority,
            steps: stepDrafts,
          });
          goalId = opened.id;
        } catch (err) {
          logger.error(`agency-wake-loop: goals.open failed for tenant '${tenantId}' / trigger '${trigger.id}'`, { error: err });
          continue;
        }
        goalsOpened += 1;
        perTrigger[trigger.id] = (perTrigger[trigger.id] ?? 0) + 1;
        let outcome: ExecutorOutcome | null = null;
        try {
          outcome = await deps.executor.executeGoal(goalId);
        } catch (err) {
          logger.error(`agency-wake-loop: executeGoal failed for tenant '${tenantId}' / goal '${goalId}'`, { error: err });
        }
        if (outcome) {
          goalsExecuted += 1;
        }
      }
    }
  }

  return { goalsOpened, goalsExecuted, perTrigger };
}

// ─────────────────────────────────────────────────────────────────────
// Default triggers — three stub detectors. Real readers (arrears,
// lease-expiry, vacancy) wire here at the composition root and replace
// the empty-return body. The IDs and descriptions are stable so
// downstream dashboards can join against them.
// ─────────────────────────────────────────────────────────────────────

export const ARREARS_30D_TRIGGER: WakeTrigger = {
  id: 'arrears.30d-threshold',
  description:
    'Find leases >=30d overdue with no active arrears goal already open.',
  async detect() {
    return [];
  },
};

export const LEASE_EXPIRING_30D_TRIGGER: WakeTrigger = {
  id: 'lease.expiring-30d',
  description:
    'Find active leases ending in 30d with no renewal goal already open.',
  async detect() {
    return [];
  },
};

export const VACANCY_30D_TRIGGER: WakeTrigger = {
  id: 'vacancy.30d-vacant',
  description:
    'Find units vacant >=30d with no listing goal already open.',
  async detect() {
    return [];
  },
};

export const DEFAULT_WAKE_TRIGGERS: ReadonlyArray<WakeTrigger> = [
  ARREARS_30D_TRIGGER,
  LEASE_EXPIRING_30D_TRIGGER,
  VACANCY_30D_TRIGGER,
];
