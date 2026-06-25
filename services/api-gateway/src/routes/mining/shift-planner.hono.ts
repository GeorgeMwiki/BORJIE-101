/**
 * /api/v1/mining/shift-planner — OSHA-TZ-aware 24h shift planner (OW-?).
 *
 * Wraps the REAL pure-compute `@borjie/mining-shift-planner` package
 * (greedy cert/equipment/fatigue solver + OSHA-TZ rule evaluator +
 * fatigue scorer). NO new tables, NO migrations — the planner is a
 * stateless solver; the only persistence it touches is its in-memory
 * assignment sink (dry-run), which we keep here so a `/plan` call never
 * writes a parallel roster.
 *
 * Routes:
 *   POST /plan      solve a shift plan from a supplied request body
 *                   (workers + equipment + tasks) → assignments +
 *                   unassigned + rotation alerts + OSHA compliance report.
 *   POST /fatigue   score one worker's fatigue from a 72h shift log.
 *   GET  /roster    project the tenant's REAL employees / assets / sites
 *                   into planner-ready `workers` / `equipment` / `sites`
 *                   so the FE can pre-fill a /plan request from live data.
 *
 * ROSTER HONESTY (no fabricated fields): `employees` carry no structured
 * certification array and no past-shift log on their own row, and
 * `assets` carry no operator-cert requirement. We therefore:
 *   - read REAL `workforce_certifications` (active, non-expired) and map
 *     each `cert_code` onto the planner's certification enum where it
 *     matches; unmapped codes are dropped (never invented).
 *   - derive each worker's `last72hShifts` from REAL `attendance` rows in
 *     the trailing 72h (work_date + shift_kind + hoursWorked), so fatigue
 *     scoring runs on real history rather than a guess.
 *   - map REAL `assets.kind` onto the planner equipment-kind enum and
 *     FLAG that the operator `requiredCertification` is a DERIVED default
 *     per kind (the assets schema has no such column).
 *
 * RLS: authMiddleware + databaseMiddleware bind app.current_tenant_id;
 * employees / attendance / assets / sites / workforce_certifications are
 * FORCE-RLS. Handlers keep the explicit tenant predicate other mining
 * routes also keep; the package solver itself is pure (no DB access).
 */

import { Hono } from 'hono';
import { and, eq, gte, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  assets,
  attendance,
  employees,
  sites,
  workforceCertifications,
} from '@borjie/database';
import {
  createMiningShiftPlanner,
  scoreFatigue,
  buildComplianceReport,
  DEFAULT_OSHA_THRESHOLDS,
  shiftRequestSchema,
  workShiftRecordSchema,
  ShiftPlannerError,
  type Certification,
  type ComplianceReport,
  type EquipmentKind,
  type ShiftKind,
  type ShiftPlan,
  type ShiftRequest,
  type TaskZone,
  type Worker,
  type WorkShiftRecord,
} from '@borjie/mining-shift-planner';

import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('mining-shift-planner');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// ---------------------------------------------------------------------------
// Real-row → planner-enum mappings (no fabricated values).
// ---------------------------------------------------------------------------

/** Set of valid planner certification codes for membership checks. */
const PLANNER_CERTS: ReadonlySet<string> = new Set<Certification>([
  'haul-truck-license',
  'excavator-license',
  'underground-cert',
  'blaster-permit',
  'first-aid',
  'crusher-operator',
  'electrician-class-b',
  'confined-space',
]);

/**
 * Map a stored `workforce_certifications.cert_code` onto the planner's
 * certification enum. Returns null when the code does not correspond to a
 * planner certification — those are dropped, never coerced.
 */
function mapCertCode(certCode: string): Certification | null {
  const normalized = certCode.trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (PLANNER_CERTS.has(normalized)) return normalized as Certification;
  // A small set of common aliases seen in onboarding imports.
  const aliases: Readonly<Record<string, Certification>> = {
    'haul-truck': 'haul-truck-license',
    'haul-truck-licence': 'haul-truck-license',
    'excavator': 'excavator-license',
    'excavator-licence': 'excavator-license',
    'underground': 'underground-cert',
    'blaster': 'blaster-permit',
    'first-aid-cert': 'first-aid',
    'crusher': 'crusher-operator',
    'electrician': 'electrician-class-b',
    'confined-space-entry': 'confined-space',
  };
  return aliases[normalized] ?? null;
}

/**
 * Map a stored `assets.kind` onto the planner's equipment-kind enum.
 * Returns null for kinds the planner has no concept of (compressor,
 * generator, pump, tool, ppe) — those assets are excluded from the
 * equipment pool rather than mis-typed.
 */
function mapAssetKind(kind: string): EquipmentKind | null {
  const map: Readonly<Record<string, EquipmentKind>> = {
    excavator: 'excavator',
    truck: 'haul-truck',
    vehicle: 'haul-truck',
    drill_rig: 'drill',
    drill: 'drill',
    loader: 'loader',
    crusher: 'crusher',
    grader: 'grader',
    lhd: 'lhd',
  };
  return map[kind] ?? null;
}

/**
 * DERIVED operator certification per equipment kind. The assets schema
 * has no `required_certification` column, so this is the planner-domain
 * default for each kind — flagged in the roster response so the caller
 * knows it is derived, not stored.
 */
function defaultEquipmentCert(kind: EquipmentKind): Certification {
  const map: Readonly<Record<EquipmentKind, Certification>> = {
    excavator: 'excavator-license',
    'haul-truck': 'haul-truck-license',
    drill: 'blaster-permit',
    loader: 'excavator-license',
    crusher: 'crusher-operator',
    grader: 'excavator-license',
    lhd: 'underground-cert',
  };
  return map[kind];
}

/** Map a stored `attendance.shift_kind` (day|night) → planner zone-neutral. */
function attendanceZone(): TaskZone {
  // Attendance rows do not record a zone; surface-pit is the planner's
  // most generic outdoor hazard zone and keeps fatigue windows honest
  // without inventing an underground history.
  return 'surface-pit';
}

// ---------------------------------------------------------------------------
// Roster-honesty flags — stable, locale-NEUTRAL codes.
//
// The roster projection defaults several planner-domain fields the assets /
// attendance schemas do not store (operator cert, availability window, shift
// zone) and excludes asset kinds the planner cannot model. Each provenance
// note is emitted as an UPPER_SNAKE code rather than English prose so the
// cockpit can render it in the active locale (the FE owns the {en,sw} copy).
// These conditions hold for every roster projection, so the set is constant.
// ---------------------------------------------------------------------------

const ROSTER_HONESTY_FLAGS = [
  'EQUIPMENT_CERT_IS_PLANNER_DEFAULT',
  'EQUIPMENT_AVAILABILITY_DEFAULT_WINDOW',
  'WORKER_SHIFTS_FROM_ATTENDANCE_ZONE_DEFAULTED',
  'UNMAPPED_ASSET_KINDS_EXCLUDED',
] as const;

// ---------------------------------------------------------------------------
// Language-neutral projection of the planner's English-prose output.
//
// The pure-compute package builds human-readable English sentences for the
// unassigned-task reason, the rotation-alert label, the OSHA rule label /
// detail, and the blocking-failure lines. Returning those raw would force
// the owner cockpit to render English to Swahili users (zero-mix breach),
// because the locale lives on the client and the package has no locale.
//
// Instead we project the SAME facts into stable enum keys + numeric /
// identifier parts. The frontend owns the {en,sw} copy and composes the
// final string in the active locale (whole-template interpolation), so no
// English ever crosses the wire for these surfaces. The original prose is
// dropped from `structured` (the FE never reads it) but kept on the legacy
// `plan` / `compliance` fields for any non-localized consumer.
// ---------------------------------------------------------------------------

/** Re-derive the structured cause for an unfilled task (mirrors the solver). */
function deriveUnassignedReason(
  taskId: string,
  request: ShiftRequest,
):
  | { taskId: string; reasonKey: 'no-certified-worker'; certifications: ReadonlyArray<Certification> }
  | { taskId: string; reasonKey: 'no-matching-equipment'; equipmentKinds: ReadonlyArray<EquipmentKind> }
  | { taskId: string; reasonKey: 'all-assigned' } {
  const task = request.tasks.find((t) => t.id === taskId);
  if (!task) return { taskId, reasonKey: 'all-assigned' };

  const anyWorkerHasCerts = request.workers.some((w) =>
    task.requiredCertifications.every((cert) => w.certifications.includes(cert)),
  );
  if (!anyWorkerHasCerts) {
    return {
      taskId,
      reasonKey: 'no-certified-worker',
      certifications: task.requiredCertifications,
    };
  }
  const anyEqMatches = request.equipment.some((e) =>
    task.requiredEquipment.includes(e.kind),
  );
  if (!anyEqMatches) {
    return {
      taskId,
      reasonKey: 'no-matching-equipment',
      equipmentKinds: task.requiredEquipment,
    };
  }
  return { taskId, reasonKey: 'all-assigned' };
}

interface StructuredShiftPlanner {
  readonly unassignedTasks: ReadonlyArray<ReturnType<typeof deriveUnassignedReason>>;
  readonly rotationAlerts: ReadonlyArray<{
    readonly workerId: string;
    readonly atISO: string;
    readonly rotationHours: number;
    readonly zone: TaskZone;
  }>;
  readonly compliance: {
    readonly results: ReadonlyArray<{
      readonly ruleKey: string;
      readonly pass: boolean;
      readonly severity: ComplianceReport['results'][number]['severity'];
      readonly affectedCount: number;
      readonly affectedWorkerIds: ReadonlyArray<string>;
    }>;
    readonly blockingFailures: ReadonlyArray<{
      readonly ruleKey: string;
      readonly severity: ComplianceReport['results'][number]['severity'];
      readonly affectedCount: number;
    }>;
  };
  /** Threshold + ambient inputs the FE needs to compose localized labels. */
  readonly labelContext: {
    readonly ambientTemperatureC: number;
    readonly thresholds: typeof DEFAULT_OSHA_THRESHOLDS;
  };
}

function projectStructured(
  request: ShiftRequest,
  plan: ShiftPlan,
  compliance: ComplianceReport,
  thresholds: typeof DEFAULT_OSHA_THRESHOLDS,
): StructuredShiftPlanner {
  // Rotation alerts carry no zone of their own; recover it from the matching
  // assignment (a worker is alerted for the hazard zone they were assigned).
  const zoneByWorker = new Map<string, TaskZone>();
  for (const a of plan.assignments) zoneByWorker.set(a.workerId, a.zone);

  const failingByRule = new Map<string, ComplianceReport['results'][number]>();
  for (const r of compliance.results) {
    if (!r.pass && (r.severity === 'critical' || r.severity === 'high')) {
      failingByRule.set(r.ruleId, r);
    }
  }

  return {
    unassignedTasks: plan.unassignedTasks.map((u) =>
      deriveUnassignedReason(u.taskId, request),
    ),
    rotationAlerts: plan.rotationAlerts.map((r) => ({
      workerId: r.workerId,
      atISO: r.atISO,
      rotationHours: thresholds.hazardRotationHours,
      zone: zoneByWorker.get(r.workerId) ?? 'surface-pit',
    })),
    compliance: {
      results: compliance.results.map((r) => ({
        ruleKey: r.ruleId,
        pass: r.pass,
        severity: r.severity,
        affectedCount: r.affectedWorkerIds.length,
        affectedWorkerIds: r.affectedWorkerIds,
      })),
      blockingFailures: Array.from(failingByRule.values()).map((r) => ({
        ruleKey: r.ruleId,
        severity: r.severity,
        affectedCount: r.affectedWorkerIds.length,
      })),
    },
    labelContext: {
      ambientTemperatureC: request.ambientTemperatureC,
      thresholds,
    },
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const miningShiftPlannerRouter = new Hono();
miningShiftPlannerRouter.use('*', authMiddleware);
miningShiftPlannerRouter.use('*', databaseMiddleware);

// Single shared planner instance — the package solver is pure + stateless
// apart from its in-memory dry-run sink, so one instance is safe to reuse
// across requests. We pass the project Pino logger so the package's
// structured events flow through the gateway logger (no console.log).
const planner = createMiningShiftPlanner({
  logger: {
    info: (msg, meta) => moduleLogger.info(meta ?? {}, msg),
    warn: (msg, meta) => moduleLogger.warn(meta ?? {}, msg),
    error: (msg, meta) => moduleLogger.error(meta ?? {}, msg),
  },
});

// ---------------------------------------------------------------------------
// POST /plan — solve a shift plan + attach OSHA compliance report.
// ---------------------------------------------------------------------------
miningShiftPlannerRouter.post('/plan', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  if (!auth?.tenantId) {
    return c.json(
      { success: false as const, error: { code: 'SHIFT_PLANNER_UNAUTHENTICATED' } },
      401,
    );
  }

  const raw = await c.req.json().catch(() => ({}));
  // Force the body's tenantId to the caller's tenant — never trust a
  // client-supplied tenantId across the RLS boundary.
  const candidate =
    raw && typeof raw === 'object' ? { ...(raw as object), tenantId: auth.tenantId } : raw;
  const parsed = shiftRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BODY', issues: parsed.error.issues },
      },
      400,
    );
  }

  // Every worker in the request must belong to the caller's tenant — the
  // package schema enforces a non-empty tenantId per worker but does not
  // know our tenant; reject cross-tenant smuggling explicitly.
  const foreign = parsed.data.workers.find((w) => w.tenantId !== auth.tenantId);
  if (foreign) {
    return c.json(
      {
        success: false as const,
        error: { code: 'CROSS_TENANT_WORKER', workerId: foreign.id },
      },
      403,
    );
  }
  const foreignEquip = parsed.data.equipment.find(
    (e) => e.tenantId !== auth.tenantId,
  );
  if (foreignEquip) {
    return c.json(
      {
        success: false as const,
        error: { code: 'CROSS_TENANT_EQUIPMENT', equipmentId: foreignEquip.id },
      },
      403,
    );
  }

  try {
    const plan = await planner.planShift(parsed.data);
    // Compliance is REAL evidence for the plan — derive directly from the
    // request + plan against the default OSHA-TZ thresholds.
    const compliance = buildComplianceReport(
      parsed.data,
      plan,
      DEFAULT_OSHA_THRESHOLDS,
    );
    // Language-neutral projection — stable keys + numeric parts so the owner
    // cockpit renders these surfaces in the active locale (no English prose
    // crosses the wire). `plan` / `compliance` keep the legacy prose for any
    // non-localized consumer.
    const structured = projectStructured(
      parsed.data,
      plan,
      compliance,
      DEFAULT_OSHA_THRESHOLDS,
    );
    return c.json(
      {
        success: true as const,
        data: {
          plan,
          compliance,
          structured,
          thresholds: DEFAULT_OSHA_THRESHOLDS,
        },
      },
      200,
    );
  } catch (err) {
    if (err instanceof ShiftPlannerError) {
      // Domain errors (overloaded schedule / fatigue / OSHA) are a 422 —
      // the request was well-formed but unsatisfiable under constraints.
      moduleLogger.warn(
        { tenantId: auth.tenantId, code: err.code, details: err.details },
        'shift_plan_unsatisfiable',
      );
      return c.json(
        {
          success: false as const,
          error: { code: err.code, message: err.message, details: err.details },
        },
        422,
      );
    }
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'shift_plan_failed');
    return c.json(
      { success: false as const, error: { code: 'SHIFT_PLAN_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// POST /fatigue — score one worker's fatigue from a 72h shift log.
// ---------------------------------------------------------------------------
const fatigueBodySchema = z.object({
  workerId: z.string().min(1),
  last72hShifts: z.array(workShiftRecordSchema).default([]),
  /** Optional anchor; defaults to now() inside the scorer. */
  asOfISO: z.string().optional(),
});

miningShiftPlannerRouter.post('/fatigue', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  if (!auth?.tenantId) {
    return c.json(
      { success: false as const, error: { code: 'SHIFT_PLANNER_UNAUTHENTICATED' } },
      401,
    );
  }

  const raw = await c.req.json().catch(() => ({}));
  const parsed = fatigueBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: { code: 'INVALID_BODY', issues: parsed.error.issues },
      },
      400,
    );
  }

  try {
    // Build a transient worker so we can anchor `asOfISO` explicitly (the
    // package `evaluateFatigue` always anchors to now()); scoring is pure.
    const transientWorker: Worker = {
      id: parsed.data.workerId,
      tenantId: auth.tenantId,
      name: parsed.data.workerId,
      certifications: [],
      shiftPreferences: [],
      last72hShifts: parsed.data.last72hShifts.map(
        (s): WorkShiftRecord => ({ ...s }),
      ),
      lastSafetyBriefingISO: null,
    };
    const score = scoreFatigue({
      worker: transientWorker,
      asOfISO: parsed.data.asOfISO ?? new Date().toISOString(),
    });
    return c.json({ success: true as const, data: { fatigue: score } }, 200);
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'fatigue_score_failed');
    return c.json(
      { success: false as const, error: { code: 'FATIGUE_SCORE_FAILED' } },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// GET /roster — project REAL employees / assets / sites for plan pre-fill.
// ---------------------------------------------------------------------------
miningShiftPlannerRouter.get('/roster', async (c) => {
  const auth = c.get('auth') as { tenantId?: string };
  const db = c.get('db');
  if (!db || !auth?.tenantId) {
    return c.json(
      { success: false as const, error: { code: 'SHIFT_PLANNER_DB_UNAVAILABLE' } },
      503,
    );
  }

  // Optional site filter — when supplied, only that site's roster.
  const siteIdParam = c.req.query('siteId');
  const tenantId = auth.tenantId;

  try {
    // 1) Active employees (optionally scoped to a site).
    const employeeRows = await db
      .select({
        id: employees.id,
        userId: employees.userId,
        siteId: employees.siteId,
        fullName: employees.fullName,
        role: employees.role,
        status: employees.status,
      })
      .from(employees)
      .where(
        siteIdParam
          ? and(
              eq(employees.tenantId, tenantId),
              eq(employees.status, 'active'),
              eq(employees.siteId, siteIdParam),
            )
          : and(eq(employees.tenantId, tenantId), eq(employees.status, 'active')),
      )
      .limit(500);

    // 2) Active, non-expired certifications keyed by userId (employees
    //    link to a platform user; certs are stored per user_id).
    const userIds = employeeRows
      .map((e) => e.userId)
      .filter((u): u is string => Boolean(u));
    const certRows =
      userIds.length > 0
        ? await db
            .select({
              userId: workforceCertifications.userId,
              certCode: workforceCertifications.certCode,
            })
            .from(workforceCertifications)
            .where(
              and(
                eq(workforceCertifications.tenantId, tenantId),
                eq(workforceCertifications.status, 'active'),
                gte(workforceCertifications.expiresAt, new Date()),
                inArray(workforceCertifications.userId, userIds),
              ),
            )
        : [];

    const certsByUser = new Map<string, Set<Certification>>();
    for (const row of certRows) {
      const mapped = mapCertCode(String(row.certCode));
      if (!mapped) continue;
      const set = certsByUser.get(String(row.userId)) ?? new Set<Certification>();
      set.add(mapped);
      certsByUser.set(String(row.userId), set);
    }

    // 3) Trailing-72h attendance → last72hShifts per employee, for real
    //    fatigue history. work_date is a DATE; we anchor the shift window
    //    to a 12h day / 12h night block per the attendance shift_kind.
    const since = new Date(Date.now() - 72 * HOUR_MS);
    const sinceDate = since.toISOString().slice(0, 10);
    const employeeIds = employeeRows.map((e) => e.id);
    const attendanceRows =
      employeeIds.length > 0
        ? await db
            .select({
              employeeId: attendance.employeeId,
              workDate: attendance.workDate,
              shiftKind: attendance.shiftKind,
              status: attendance.status,
              hoursWorked: attendance.hoursWorked,
            })
            .from(attendance)
            .where(
              and(
                eq(attendance.tenantId, tenantId),
                gte(attendance.workDate, sinceDate),
                inArray(attendance.employeeId, employeeIds),
              ),
            )
        : [];

    const shiftsByEmployee = new Map<string, WorkShiftRecord[]>();
    for (const row of attendanceRows) {
      if (row.status !== 'present') continue;
      const dateStr = String(row.workDate);
      const isNight = String(row.shiftKind) === 'night';
      // Day shift 06:00–18:00; night shift 18:00–06:00(+1) anchored to the
      // work_date. Duration honours recorded hoursWorked when present.
      const startHour = isNight ? 18 : 6;
      const startMs = new Date(`${dateStr}T00:00:00.000Z`).getTime() + startHour * HOUR_MS;
      const hours =
        row.hoursWorked !== null && row.hoursWorked !== undefined
          ? Math.min(24, Math.max(0, Number(row.hoursWorked)))
          : 12;
      const startISO = new Date(startMs).toISOString();
      const endISO = new Date(startMs + hours * HOUR_MS).toISOString();
      const record = workShiftRecordSchema.parse({
        shiftId: `att-${dateStr}-${row.shiftKind}`,
        startISO,
        endISO,
        zone: attendanceZone(),
      });
      const list = shiftsByEmployee.get(String(row.employeeId)) ?? [];
      list.push(record);
      shiftsByEmployee.set(String(row.employeeId), list);
    }

    const workers: Worker[] = employeeRows.map((e) => {
      const certs = e.userId
        ? Array.from(certsByUser.get(e.userId) ?? [])
        : [];
      const last72hShifts = shiftsByEmployee.get(e.id) ?? [];
      return {
        id: e.id,
        tenantId,
        name: e.fullName,
        certifications: certs,
        shiftPreferences: [] as ShiftKind[],
        last72hShifts,
        lastSafetyBriefingISO: null,
      };
    });

    // 4) Equipment pool — operational assets mapped onto planner kinds.
    const assetRows = await db
      .select({
        id: assets.id,
        kind: assets.kind,
        make: assets.make,
        model: assets.model,
        status: assets.status,
        currentSiteId: assets.currentSiteId,
      })
      .from(assets)
      .where(
        siteIdParam
          ? and(
              eq(assets.tenantId, tenantId),
              eq(assets.status, 'operational'),
              eq(assets.currentSiteId, siteIdParam),
            )
          : and(eq(assets.tenantId, tenantId), eq(assets.status, 'operational')),
      )
      .limit(500);

    // Default availability window — the assets schema has no per-shift
    // window, so the equipment is treated as available across a generous
    // 24h band anchored to now(); flagged in the response.
    const nowMs = Date.now();
    const availFrom = new Date(nowMs - DAY_MS).toISOString();
    const availTo = new Date(nowMs + DAY_MS).toISOString();

    const equipment = assetRows
      .map((a) => {
        const kind = mapAssetKind(String(a.kind));
        if (!kind) return null;
        const label =
          [a.make, a.model].filter(Boolean).join(' ').trim() || String(a.id);
        return {
          id: String(a.id),
          tenantId,
          kind,
          label,
          availableFromISO: availFrom,
          availableToISO: availTo,
          requiredCertification: defaultEquipmentCert(kind),
          siteId: a.currentSiteId ? String(a.currentSiteId) : null,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    // 5) Sites — for the FE site picker.
    const siteRows = await db
      .select({
        id: sites.id,
        name: sites.name,
        mineral: sites.mineral,
        phase: sites.phase,
        status: sites.status,
      })
      .from(sites)
      .where(
        siteIdParam
          ? and(eq(sites.tenantId, tenantId), eq(sites.id, siteIdParam))
          : eq(sites.tenantId, tenantId),
      )
      .limit(200);

    return c.json(
      {
        success: true as const,
        data: {
          workers,
          equipment,
          sites: siteRows.map((s) => ({
            id: String(s.id),
            name: s.name,
            mineral: s.mineral,
            phase: s.phase,
            status: s.status,
          })),
          counts: {
            workers: workers.length,
            equipment: equipment.length,
            sites: siteRows.length,
          },
          // Locale-neutral roster-honesty flags: stable UPPER_SNAKE codes
          // (never English prose) so the owner cockpit renders each note in
          // the ACTIVE locale via its {en,sw} flag-label table. The wire is
          // locale-neutral; only the render is localized.
          flags: ROSTER_HONESTY_FLAGS,
        },
      },
      200,
    );
  } catch (err) {
    moduleLogger.error({ err, tenantId: auth.tenantId }, 'shift_roster_failed');
    return c.json(
      { success: false as const, error: { code: 'SHIFT_ROSTER_FAILED' } },
      500,
    );
  }
});

export default miningShiftPlannerRouter;
