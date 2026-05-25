/**
 * Agency — REAL wake-trigger detectors.
 *
 * Replaces the empty-return stub `detect()` bodies on the three default
 * triggers with real per-tenant queries. Each detector takes a small
 * duck-typed read port (NOT a Drizzle handle directly — the central-
 * intelligence package must not compile-time-depend on @borjie/
 * database) and emits zero or more `WakeTriggerDetectedGoal`s.
 *
 *   arrears.30d-threshold — leases with active arrears cases >=30d overdue
 *   lease.expiring-30d    — active leases ending within the next 30d
 *   vacancy.30d-vacant    — units vacant >=30d (using updatedAt as proxy
 *                           for last_vacated when no dedicated column)
 *
 * Each detector returns goal openers with multi-step plans the executor
 * can walk: an informational "review" step (toolName=null) followed by
 * action-tool steps (rent.send-reminder, listing.publish, etc.) the
 * executor invokes through the registered tools.
 *
 * Errors inside a detector are NOT swallowed here — the wake-loop's
 * outer try/catch catches them and skips the trigger for that tenant.
 */
import type {
  WakeTrigger,
  WakeTriggerDetectArgs,
  WakeTriggerDetectedGoal,
} from './wake-loop.js';

// ─────────────────────────────────────────────────────────────────────
// Read ports — duck-typed against the Drizzle service shapes used by
// the api-gateway composition root. Each port returns a flat row
// shape with the minimum fields the detector needs to emit a goal.
// ─────────────────────────────────────────────────────────────────────

export interface ArrearsCaseRow {
  readonly leaseId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly daysOverdue: number;
  readonly unitCode: string | null;
}

export interface ArrearsReadPort {
  listActiveOverdue(args: {
    readonly tenantId: string;
    readonly minDaysOverdue: number;
    readonly asOf: Date;
    readonly limit: number;
  }): Promise<ReadonlyArray<ArrearsCaseRow>>;
}

export interface LeaseExpiringRow {
  readonly leaseId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly endDate: string;
  readonly unitCode: string | null;
}

export interface LeaseReadPort {
  listExpiringWithin(args: {
    readonly tenantId: string;
    readonly windowDays: number;
    readonly asOf: Date;
    readonly limit: number;
  }): Promise<ReadonlyArray<LeaseExpiringRow>>;
}

export interface VacancyRow {
  readonly unitId: string;
  readonly tenantId: string;
  readonly propertyId: string;
  readonly unitCode: string | null;
  readonly headlineRent: number | null;
  readonly currency: string | null;
  readonly daysVacant: number;
}

export interface VacancyReadPort {
  listLongVacant(args: {
    readonly tenantId: string;
    readonly minDaysVacant: number;
    readonly asOf: Date;
    readonly limit: number;
  }): Promise<ReadonlyArray<VacancyRow>>;
}

export interface RealDetectorDeps {
  readonly arrears?: ArrearsReadPort;
  readonly leases?: LeaseReadPort;
  readonly vacancy?: VacancyReadPort;
  /** Default fan-out per detector per tenant (safety cap). */
  readonly perTenantLimit?: number;
  /** Resolves the userId the goal should be assigned to (typically the
   *  tenant's autonomy escalation primary). When omitted we fall back
   *  to a synthetic 'agency-bot' user so goals can still be opened. */
  readonly resolveAssigneeUserId?: (
    tenantId: string,
  ) => Promise<string | null>;
}

const DEFAULT_PER_TENANT_LIMIT = 50;

async function resolveAssignee(
  deps: RealDetectorDeps,
  tenantId: string,
): Promise<string> {
  if (!deps.resolveAssigneeUserId) return 'agency-bot';
  const resolved = await deps.resolveAssigneeUserId(tenantId).catch(() => null);
  return resolved ?? 'agency-bot';
}

// ─────────────────────────────────────────────────────────────────────
// arrears.30d-threshold
// ─────────────────────────────────────────────────────────────────────

export function createArrears30dDetector(
  deps: RealDetectorDeps,
): WakeTrigger {
  const limit = deps.perTenantLimit ?? DEFAULT_PER_TENANT_LIMIT;
  return {
    id: 'arrears.30d-threshold',
    description:
      'Find leases >=30d overdue with no active arrears goal already open.',
    async detect({
      tenantId,
      clock,
    }: WakeTriggerDetectArgs): Promise<ReadonlyArray<WakeTriggerDetectedGoal>> {
      if (!deps.arrears) return [];
      const asOf = clock();
      const rows = await deps.arrears.listActiveOverdue({
        tenantId,
        minDaysOverdue: 30,
        asOf,
        limit,
      });
      if (!rows.length) return [];

      const userId = await resolveAssignee(deps, tenantId);

      return rows.map<WakeTriggerDetectedGoal>((row) => ({
        userId,
        threadId: `wake-arrears-${row.leaseId}`,
        title: `Arrears review for ${row.unitCode ?? row.leaseId}`,
        description: `Lease ${row.leaseId} is ${row.daysOverdue} days overdue.`,
        priority: 'high',
        steps: [
          {
            seq: 1,
            description: `Review arrears case for lease ${row.leaseId}`,
            toolName: null,
            toolPayload: null,
          },
          {
            seq: 2,
            description: `Send first SMS reminder for lease ${row.leaseId}`,
            toolName: 'rent.send-reminder',
            toolPayload: {
              leaseId: row.leaseId,
              channel: 'sms',
            },
          },
          {
            seq: 3,
            description: `Escalate arrears to ladder step 1 if reminder unanswered`,
            toolName: 'arrears.escalate',
            toolPayload: {
              leaseId: row.leaseId,
              ladderStep: 1,
            },
          },
        ],
      }));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// lease.expiring-30d
// ─────────────────────────────────────────────────────────────────────

export function createLeaseExpiring30dDetector(
  deps: RealDetectorDeps,
): WakeTrigger {
  const limit = deps.perTenantLimit ?? DEFAULT_PER_TENANT_LIMIT;
  return {
    id: 'lease.expiring-30d',
    description:
      'Find active leases ending in 30d with no renewal goal already open.',
    async detect({
      tenantId,
      clock,
    }: WakeTriggerDetectArgs): Promise<ReadonlyArray<WakeTriggerDetectedGoal>> {
      if (!deps.leases) return [];
      const asOf = clock();
      const rows = await deps.leases.listExpiringWithin({
        tenantId,
        windowDays: 30,
        asOf,
        limit,
      });
      if (!rows.length) return [];

      const userId = await resolveAssignee(deps, tenantId);

      return rows.map<WakeTriggerDetectedGoal>((row) => ({
        userId,
        threadId: `wake-renewal-${row.leaseId}`,
        title: `Renewal review for ${row.unitCode ?? row.leaseId}`,
        description: `Lease ${row.leaseId} ends ${row.endDate}; open the renewal window.`,
        priority: 'medium',
        steps: [
          {
            seq: 1,
            description: `Review renewal candidacy for lease ${row.leaseId}`,
            toolName: null,
            toolPayload: null,
          },
          {
            seq: 2,
            description: `Send renewal-window email reminder to lease ${row.leaseId}`,
            toolName: 'rent.send-reminder',
            toolPayload: {
              leaseId: row.leaseId,
              channel: 'email',
            },
          },
        ],
      }));
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// vacancy.30d-vacant
// ─────────────────────────────────────────────────────────────────────

export function createVacancy30dDetector(
  deps: RealDetectorDeps,
): WakeTrigger {
  const limit = deps.perTenantLimit ?? DEFAULT_PER_TENANT_LIMIT;
  return {
    id: 'vacancy.30d-vacant',
    description: 'Find units vacant >=30d with no listing goal already open.',
    async detect({
      tenantId,
      clock,
    }: WakeTriggerDetectArgs): Promise<ReadonlyArray<WakeTriggerDetectedGoal>> {
      if (!deps.vacancy) return [];
      const asOf = clock();
      const rows = await deps.vacancy.listLongVacant({
        tenantId,
        minDaysVacant: 30,
        asOf,
        limit,
      });
      if (!rows.length) return [];

      const userId = await resolveAssignee(deps, tenantId);

      return rows.flatMap<WakeTriggerDetectedGoal>((row) => {
        // Without a headline rent / currency we cannot emit the
        // listing.publish step safely. We still emit the review step
        // so the operator surface is aware of the long vacancy.
        const canPublish =
          typeof row.headlineRent === 'number' &&
          row.headlineRent > 0 &&
          typeof row.currency === 'string' &&
          row.currency.length >= 3;

        const reviewStep = {
          seq: 1,
          description: `Review long-vacant unit ${row.unitCode ?? row.unitId}`,
          toolName: null as string | null,
          toolPayload: null as Record<string, unknown> | null,
        };

        const publishStep = canPublish
          ? {
              seq: 2,
              description: `Publish listing for unit ${row.unitCode ?? row.unitId}`,
              toolName: 'listing.publish' as string | null,
              toolPayload: {
                unitId: row.unitId,
                headlineRent: row.headlineRent as number,
                currency: row.currency as string,
              } as Record<string, unknown> | null,
            }
          : null;

        return [
          {
            userId,
            threadId: `wake-vacancy-${row.unitId}`,
            title: `Vacancy listing for ${row.unitCode ?? row.unitId}`,
            description: `Unit ${row.unitId} has been vacant ${row.daysVacant} days.`,
            priority: 'medium',
            steps: publishStep ? [reviewStep, publishStep] : [reviewStep],
          },
        ];
      });
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Bundle helper — composition roots can pass `db`-backed ports here
// once and get the full trio back, ready to feed the wake-loop. When
// any port is missing the corresponding detector still registers but
// emits an empty array (so the wake-loop count stays accurate).
// ─────────────────────────────────────────────────────────────────────

export function createRealWakeTriggers(
  deps: RealDetectorDeps,
): ReadonlyArray<WakeTrigger> {
  return [
    createArrears30dDetector(deps),
    createLeaseExpiring30dDetector(deps),
    createVacancy30dDetector(deps),
  ];
}
