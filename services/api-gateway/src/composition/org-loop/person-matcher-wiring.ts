/**
 * person-matcher-wiring.ts — the DB-backed binding for the PURE
 * `rankCandidates` kernel (@borjie/workforce-orchestrator/person-matcher).
 *
 * THE GAP THIS CLOSES
 * -------------------
 * The org-loop spine ("detect a gap → pick the right person → assign")
 * needs a CONCRETE candidate ranker: given a tenant + a need, who is the
 * best workforce person? The pure kernel scores candidates but reads
 * nothing — this host loads the candidate snapshot from the REAL DB
 * (tenant-scoped) and hands it to the kernel. The matcher LEARNS because
 * one input — `successRateByDomain` — is sourced from the performance
 * history; as completions close the loop, the same candidate's ranking
 * shifts. (That signal's table is not live yet, so it degrades NEUTRAL
 * today and lights up automatically when the history lands — see below.)
 *
 * DATA SOURCES (each enriched defensively; a missing source degrades the
 * signal to neutral, NEVER fabricates one):
 *   - employees           → the candidate set (active, tenant-scoped) +
 *                           role + `attributes.certifications/skills`.
 *   - workforce_certifications → live, non-expired cert slugs (capability).
 *   - tasks               → OPEN-task load keyed on the employee's user_id
 *                           (fewer open ⇒ higher capacity score).
 *   - performance history  → learned in-domain success rate (LEARN signal).
 *
 * HARD RAILS
 * ----------
 *   - READ-ONLY. Every query is a SELECT; this module never writes.
 *   - TENANT-SCOPED. Every SELECT filters on tenant_id; RLS is the second
 *     belt, this app-side filter is the suspenders (CLAUDE.md: never
 *     disable RLS, never rely on it alone for cross-tenant reads here).
 *   - HONEST DEGRADE. `db === null` or any query throwing returns [] (no
 *     candidates) / neutral enrichment — never a fake source, never a
 *     crash. Each enrichment is independently try/caught so one absent
 *     table (e.g. the not-yet-live performance history) cannot blank out
 *     the others.
 *   - PURE CORE. All scoring lives in the kernel; this file only loads +
 *     shapes rows and delegates. Single source of truth preserved.
 */

import { sql } from 'drizzle-orm';
import {
  rankCandidates,
  type MatchCandidate,
  type MatchNeed,
  type ScoredCandidate,
} from '@borjie/workforce-orchestrator';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';

// ─────────────────────────────────────────────────────────────────────────
// Narrow structural db seam (`execute(sql)`) — test-double-able, matching
// loop-economy-wiring's `DbExecLike`.
// ─────────────────────────────────────────────────────────────────────────

export interface DbExecLike {
  execute(query: unknown): Promise<unknown>;
}

export interface PersonMatcher {
  /**
   * Load candidates for `tenantId` and rank them against `need`. Returns
   * the scored list (best-first) or [] on a null/faulting db.
   */
  match(tenantId: string, need: MatchNeed): Promise<ScoredCandidate[]>;
}

export interface CreatePersonMatcherArgs {
  /** Drizzle client (+ raw `execute`). Null → degraded: match() → []. */
  readonly db: DbExecLike | null;
  readonly logger?: PinoLikeLogger;
  /** Hard cap on candidates loaded per match (DB-read bound). */
  readonly maxCandidates?: number;
}

const DEFAULT_MAX_CANDIDATES = 200;

// Open-task statuses that count toward a worker's current load. Mirrors the
// `tasks.status` lifecycle (open by default; done/closed/cancelled are
// terminal). Anything not terminal is "open work in flight".
const OPEN_TASK_STATUSES = ['open', 'in_progress', 'blocked', 'pending'] as const;

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows;
  return Array.isArray(rows) ? rows : [];
}

function asString(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function asCount(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? Math.max(0, n) : 0;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────
// Row shapers — turn DB rows into the kernel's MatchCandidate snapshot.
// ─────────────────────────────────────────────────────────────────────────

interface EmployeeRow {
  readonly employeeId: string;
  readonly userId: string | null;
  readonly role: string | null;
  readonly siteId: string | null;
  readonly certifications: ReadonlyArray<string>;
  readonly skillDomains: ReadonlyArray<string>;
}

function shapeEmployeeRow(row: Record<string, unknown>): EmployeeRow | null {
  const employeeId = asString(row.id);
  if (!employeeId) return null;
  const attrs =
    row.attributes !== null && typeof row.attributes === 'object'
      ? (row.attributes as Record<string, unknown>)
      : {};
  return {
    employeeId,
    userId: asString(row.user_id),
    role: asString(row.role),
    siteId: asString(row.site_id),
    certifications: asStringArray(attrs.certifications),
    // Skills may live under attributes.skills (slugs) — defensive read.
    skillDomains: asStringArray(attrs.skills),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Factory.
// ─────────────────────────────────────────────────────────────────────────

export function createPersonMatcher(
  args: CreatePersonMatcherArgs,
): PersonMatcher {
  const logger = args.logger ?? createPinoLikeLogger('person-matcher');
  const db = args.db;
  const maxCandidates = Math.max(1, args.maxCandidates ?? DEFAULT_MAX_CANDIDATES);

  if (db === null) {
    logger.warn(
      {},
      'person-matcher: composed in DEGRADED mode (db is null) — match() returns [] honestly',
    );
  } else {
    logger.info(
      { wiring: 'person-matcher', maxCandidates },
      'person-matcher: DB-backed candidate ranker composed over the pure rankCandidates kernel (read-only, tenant-scoped)',
    );
  }

  async function loadEmployees(
    tenantId: string,
    need: MatchNeed,
  ): Promise<EmployeeRow[]> {
    if (db === null) return [];
    try {
      // Constrain to the need's site when given (mirrors the route), else
      // tenant-wide. Active employees only.
      const siteId = need.siteId ?? null;
      const result = await db.execute(
        siteId
          ? sql`SELECT id, user_id, role, site_id, attributes
                FROM employees
                WHERE tenant_id = ${tenantId}
                  AND status = 'active'
                  AND site_id = ${siteId}
                LIMIT ${maxCandidates}`
          : sql`SELECT id, user_id, role, site_id, attributes
                FROM employees
                WHERE tenant_id = ${tenantId}
                  AND status = 'active'
                LIMIT ${maxCandidates}`,
      );
      return rowsOf(result)
        .map(shapeEmployeeRow)
        .filter((r): r is EmployeeRow => r !== null);
    } catch (err) {
      logger.warn(
        { tenantId, err: errMsg(err) },
        'person-matcher: employee load failed — no candidates this call (honest degrade)',
      );
      return [];
    }
  }

  /** Live, non-expired cert slugs per employee user_id. Best-effort. */
  async function loadLiveCerts(
    tenantId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (db === null || userIds.length === 0) return out;
    try {
      const result = await db.execute(
        sql`SELECT user_id, cert_code
            FROM workforce_certifications
            WHERE tenant_id = ${tenantId}
              AND status = 'active'
              AND expires_at > now()
              AND user_id IN (${sql.join(
                userIds.map((id) => sql`${id}`),
                sql`, `,
              )})`,
      );
      for (const row of rowsOf(result)) {
        const uid = asString(row.user_id);
        const code = asString(row.cert_code);
        if (!uid || !code) continue;
        const list = out.get(uid) ?? [];
        list.push(code);
        out.set(uid, list);
      }
    } catch (err) {
      logger.warn(
        { tenantId, err: errMsg(err) },
        'person-matcher: live-cert enrichment skipped (table absent or query failed) — falling back to attributes.certifications only',
      );
    }
    return out;
  }

  /** Open-task load per employee user_id. Fewer ⇒ higher capacity. */
  async function loadOpenTaskCounts(
    tenantId: string,
    userIds: ReadonlyArray<string>,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (db === null || userIds.length === 0) return out;
    try {
      const result = await db.execute(
        sql`SELECT owner_user_id, COUNT(*)::int AS open_count
            FROM tasks
            WHERE tenant_id = ${tenantId}
              AND owner_user_id IN (${sql.join(
                userIds.map((id) => sql`${id}`),
                sql`, `,
              )})
              AND status IN (${sql.join(
                OPEN_TASK_STATUSES.map((s) => sql`${s}`),
                sql`, `,
              )})
            GROUP BY owner_user_id`,
      );
      for (const row of rowsOf(result)) {
        const uid = asString(row.owner_user_id);
        if (!uid) continue;
        out.set(uid, asCount(row.open_count));
      }
    } catch (err) {
      logger.warn(
        { tenantId, err: errMsg(err) },
        'person-matcher: open-task load enrichment skipped — load signal stays neutral (honest degrade)',
      );
    }
    return out;
  }

  /**
   * Learned in-domain success rate per employee_id. This is the LEARN
   * signal that makes the matcher improve as completions close the loop.
   * The performance history table is not live in the current schema, so
   * this query degrades to an empty map (every candidate NEUTRAL) and
   * lights up automatically once the history is persisted.
   */
  async function loadSuccessRates(
    tenantId: string,
    employeeIds: ReadonlyArray<string>,
    competenceDomain: string | null,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (db === null || competenceDomain === null || employeeIds.length === 0) {
      return out;
    }
    try {
      // success_rate_by_domain: completed signals that passed spot-checks
      // over total completed signals in this domain. Derived from the
      // performance_signals history (on_time_completion / exceptional_work
      // = pass; missed_deadline / repeated_blocker = fail), domain read from
      // the signal context. Honest-degrades when the table is absent.
      const result = await db.execute(
        sql`SELECT employee_id,
                   AVG(
                     CASE
                       WHEN signal_kind IN ('on_time_completion', 'exceptional_work') THEN 1.0
                       WHEN signal_kind IN ('missed_deadline', 'repeated_blocker') THEN 0.0
                       ELSE NULL
                     END
                   ) AS success_rate
            FROM performance_signals
            WHERE tenant_id = ${tenantId}
              AND employee_id IN (${sql.join(
                employeeIds.map((id) => sql`${id}`),
                sql`, `,
              )})
              AND context_jsonb ->> 'competenceDomain' = ${competenceDomain}
            GROUP BY employee_id`,
      );
      for (const row of rowsOf(result)) {
        const eid = asString(row.employee_id);
        const rate = row.success_rate;
        if (!eid || rate === null || rate === undefined) continue;
        const num = typeof rate === 'number' ? rate : Number.parseFloat(String(rate));
        if (Number.isFinite(num)) out.set(eid, num);
      }
    } catch {
      // Table not live yet (archived migration) — neutral, no noisy log on
      // every match; the absence is structural, not an error condition.
    }
    return out;
  }

  async function match(
    tenantId: string,
    need: MatchNeed,
  ): Promise<ScoredCandidate[]> {
    if (db === null || typeof tenantId !== 'string' || tenantId.length === 0) {
      return [];
    }
    try {
      const employees = await loadEmployees(tenantId, need);
      if (employees.length === 0) return [];

      const userIds = employees
        .map((e) => e.userId)
        .filter((u): u is string => u !== null);
      const employeeIds = employees.map((e) => e.employeeId);
      const competenceDomain = need.competenceDomain ?? null;

      const [liveCerts, openLoad, successRates] = await Promise.all([
        loadLiveCerts(tenantId, userIds),
        loadOpenTaskCounts(tenantId, userIds),
        loadSuccessRates(tenantId, employeeIds, competenceDomain),
      ]);

      const candidates: MatchCandidate[] = employees.map((emp) => {
        const fromAttrs = emp.certifications;
        const fromLive = emp.userId ? liveCerts.get(emp.userId) ?? [] : [];
        const certifications = dedupe([...fromAttrs, ...fromLive]);
        const openAssignmentCount = emp.userId
          ? openLoad.get(emp.userId) ?? 0
          : 0;
        const successRateByDomain = successRates.has(emp.employeeId)
          ? successRates.get(emp.employeeId)!
          : null;
        return {
          employeeId: emp.userId ?? emp.employeeId,
          certifications,
          skillDomains: emp.skillDomains,
          role: emp.role,
          lastSiteId: emp.siteId,
          openAssignmentCount,
          successRateByDomain,
        };
      });

      return rankCandidates(candidates, need);
    } catch (err) {
      logger.warn(
        { tenantId, err: errMsg(err) },
        'person-matcher: match failed — returning [] (honest degrade, never throws to caller)',
      );
      return [];
    }
  }

  return { match };
}

function dedupe(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values));
}
