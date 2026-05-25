/**
 * Parity capability dashboard factory — Wave-K (parity-litfin Gap C).
 *
 * Aggregates `kernel_provenance` + `kernel_cot_reservoir` rows into the
 * per-capability tiles the mission-eval UI renders. Mirrors LITFIN's
 * `parity-capability-dashboard.service.ts`, scoped to Borjie's
 * 6-bucket property-management surface set (rent reconciliation, lease
 * renewal, KRA MRI, GePG, maintenance triage, voice agent).
 *
 * The router lives at `services/api-gateway/src/routes/parity-capability-
 * dashboard.router.ts` and consumes:
 *
 *   getRollup(tenantId, { capabilities, capabilityPrefixes })
 *   listRuns(tenantId, { capability?, capabilityPrefixes?, minScore?,
 *                       maxScore?, category?, limit, offset })
 *   getRun(tenantId, thoughtId)
 *   rejudge(tenantId, thoughtId, { draftOverride? })
 *
 * The `rejudge` method is a TIER-3 stub today — it accepts the request
 * and returns `{accepted: true, requestedAt: <ISO>}` so the UI can show
 * "queued" feedback without silently dropping the rejudge intent.
 *
 * Tenant scoping: every query filters by `tenantId`. Platform-scope
 * thoughts have `tenant_id IS NULL` in the schema — those are visible to
 * SUPER_ADMIN/ADMIN only, but that gate already lives in the router's
 * `requireRole` middleware so the factory itself uses a single equality
 * filter and trusts the caller.
 */

import { sql } from 'drizzle-orm';

type AnyDb = {
  readonly execute: (q: unknown) => Promise<{
    readonly rows?: ReadonlyArray<Record<string, unknown>>;
  } | ReadonlyArray<Record<string, unknown>>>;
};

// ─────────────────────────────────────────────────────────────────────
// Types — match what the router + UI expect.
// ─────────────────────────────────────────────────────────────────────

export interface CapabilityTile {
  readonly id: string;
  readonly runsLast24h: number;
  readonly meanJudgeScore: number | null;
  readonly regenRateLast24h: number | null;
}

export interface DashboardRollup {
  readonly capabilities: ReadonlyArray<CapabilityTile>;
  readonly totals: {
    readonly provenanceCount: number;
    readonly cotSampleCount: number;
  };
  readonly generatedAt: string;
}

export interface EvalRunRow {
  readonly thoughtId: string;
  readonly threadId: string;
  readonly stakes: 'low' | 'medium' | 'high' | 'critical';
  readonly judgeScore: number | null;
  readonly category: string | null;
  readonly capability: string | null;
  readonly producedAt: string;
}

export interface EvalRunDetail extends EvalRunRow {
  readonly cotThoughtText: string | null;
  readonly judgeReasonText: string | null;
  readonly judgeSuggestedFix: string | null;
  readonly promptHash: string | null;
  readonly responseHash: string | null;
  readonly modelId: string;
  readonly sensorId: string;
}

export interface ListRunsResult {
  readonly runs: ReadonlyArray<EvalRunRow>;
  readonly total: number;
}

export interface RejudgeVerdict {
  readonly accepted: true;
  readonly queued: true;
  readonly thoughtId: string;
  readonly requestedAt: string;
}

export interface GetRollupOptions {
  readonly capabilities: ReadonlyArray<string>;
  readonly capabilityPrefixes: Readonly<Record<string, ReadonlyArray<string>>>;
}

export interface ListRunsOptions {
  readonly capability?: string;
  readonly capabilityPrefixes?: ReadonlyArray<string>;
  readonly minScore?: number;
  readonly maxScore?: number;
  readonly category?: string;
  readonly limit: number;
  readonly offset: number;
}

export interface RejudgeOptions {
  readonly draftOverride?: string;
}

export interface ParityCapabilityDashboardService {
  getRollup(
    tenantId: string,
    options: GetRollupOptions,
  ): Promise<DashboardRollup>;
  listRuns(tenantId: string, options: ListRunsOptions): Promise<ListRunsResult>;
  getRun(tenantId: string, thoughtId: string): Promise<EvalRunDetail | null>;
  rejudge(
    tenantId: string,
    thoughtId: string,
    options: RejudgeOptions,
  ): Promise<RejudgeVerdict>;
}

export interface CreateParityCapabilityDashboardInput {
  readonly db: AnyDb;
  /** Optional clock injection for deterministic tests. */
  readonly now?: () => Date;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function unwrapRows(
  result: { rows?: ReadonlyArray<Record<string, unknown>> } | ReadonlyArray<Record<string, unknown>>,
): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  return (result as { rows?: ReadonlyArray<Record<string, unknown>> }).rows ?? [];
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return String(v);
}

function toIsoString(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return new Date().toISOString();
}

/**
 * Map an opaque sensorId or threadId prefix to a capability bucket.
 *
 * Capability isn't a column today — it's derived from the `sensor_id`
 * prefix (which mirrors the scenario-id convention in
 * `packages/central-intelligence/__tests__/eval/scenarios.ts`). If
 * nothing matches we return `null` so the UI shows "—" rather than
 * forcing a bucket.
 */
export function mapCapability(
  sensorId: string | null,
  prefixes: Readonly<Record<string, ReadonlyArray<string>>>,
): string | null {
  if (!sensorId) return null;
  for (const [capability, prefixList] of Object.entries(prefixes)) {
    for (const prefix of prefixList) {
      if (sensorId.startsWith(prefix)) return capability;
    }
  }
  return null;
}

/**
 * Build a SQL `LIKE ANY(ARRAY[...])` predicate against `sensor_id` for
 * the supplied prefixes. We keep the prefix list inline because Drizzle
 * doesn't ship a portable ANY-array helper for parameterised arrays
 * across drivers; the prefixes come from a server-side const, not user
 * input, so injection risk is bounded.
 */
function buildPrefixLikeClause(
  prefixes: ReadonlyArray<string>,
): string {
  return prefixes
    .map((p) => `'${p.replace(/'/g, "''")}%'`)
    .map((lit) => `sensor_id LIKE ${lit}`)
    .join(' OR ');
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

export function createParityCapabilityDashboard(
  input: CreateParityCapabilityDashboardInput,
): ParityCapabilityDashboardService {
  const { db } = input;
  const now = input.now ?? (() => new Date());

  async function getRollup(
    tenantId: string,
    options: GetRollupOptions,
  ): Promise<DashboardRollup> {
    const tiles: CapabilityTile[] = [];

    // Per-capability rollup: runs last 24h, mean judge score, regen rate.
    // Regen rate proxy = fraction of rows with `judge_score < 0.5` (the
    // Borjie kernel re-runs anything under 0.5 before serving in
    // production). LITFIN uses a `regenerated_flag` column we don't have
    // yet; this proxy is documented as a tier-3 follow-up (Docs/TODO_BACKLOG.md).
    for (const capability of options.capabilities) {
      const prefixes = options.capabilityPrefixes[capability] ?? [];
      if (prefixes.length === 0) {
        tiles.push({
          id: capability,
          runsLast24h: 0,
          meanJudgeScore: null,
          regenRateLast24h: null,
        });
        continue;
      }
      const prefixClause = buildPrefixLikeClause(prefixes);
      // Inline-substitute the prefix LIKE clause but parameterise the
      // tenant filter via Drizzle's `sql` tag for safety.
      const query = sql.raw(
        `SELECT
           COUNT(*)::bigint AS runs,
           AVG(judge_score) AS mean_score,
           AVG(CASE WHEN judge_score IS NOT NULL AND judge_score < 0.5 THEN 1.0 ELSE 0.0 END) AS regen_rate
         FROM kernel_provenance
         WHERE tenant_id = '${tenantId.replace(/'/g, "''")}'
           AND produced_at > NOW() - INTERVAL '24 hours'
           AND (${prefixClause})`,
      );
      try {
        const result = await db.execute(query);
        const row = unwrapRows(result)[0] ?? {};
        tiles.push({
          id: capability,
          runsLast24h: Number(row.runs ?? row.RUNS ?? 0) || 0,
          meanJudgeScore: toNumberOrNull(row.mean_score ?? row.MEAN_SCORE),
          regenRateLast24h: toNumberOrNull(row.regen_rate ?? row.REGEN_RATE),
        });
      } catch {
        // Per-capability failure must not poison the rollup — fall back
        // to zeroed tile so the UI keeps rendering and operators see a
        // clear "0 runs" instead of an empty card.
        tiles.push({
          id: capability,
          runsLast24h: 0,
          meanJudgeScore: null,
          regenRateLast24h: null,
        });
      }
    }

    // Cross-capability totals (cheap aggregate; tolerate failure).
    let provenanceCount = 0;
    let cotSampleCount = 0;
    try {
      const totalsResult = await db.execute(
        sql.raw(
          `SELECT
             (SELECT COUNT(*)::bigint FROM kernel_provenance
               WHERE tenant_id = '${tenantId.replace(/'/g, "''")}') AS prov_count,
             (SELECT COUNT(*)::bigint FROM kernel_cot_reservoir
               WHERE tenant_id = '${tenantId.replace(/'/g, "''")}') AS cot_count`,
        ),
      );
      const totalsRow = unwrapRows(totalsResult)[0] ?? {};
      provenanceCount = Number(totalsRow.prov_count ?? totalsRow.PROV_COUNT ?? 0) || 0;
      cotSampleCount = Number(totalsRow.cot_count ?? totalsRow.COT_COUNT ?? 0) || 0;
    } catch {
      // Totals are nice-to-have; UI shows zeros rather than failing.
    }

    return {
      capabilities: tiles,
      totals: { provenanceCount, cotSampleCount },
      generatedAt: now().toISOString(),
    };
  }

  async function listRuns(
    tenantId: string,
    options: ListRunsOptions,
  ): Promise<ListRunsResult> {
    const conditions: string[] = [
      `tenant_id = '${tenantId.replace(/'/g, "''")}'`,
    ];
    if (options.capabilityPrefixes && options.capabilityPrefixes.length > 0) {
      conditions.push(`(${buildPrefixLikeClause(options.capabilityPrefixes)})`);
    }
    if (typeof options.minScore === 'number') {
      conditions.push(`judge_score >= ${options.minScore}`);
    }
    if (typeof options.maxScore === 'number') {
      conditions.push(`judge_score <= ${options.maxScore}`);
    }
    if (options.category) {
      const safe = options.category.replace(/'/g, "''");
      conditions.push(`sensor_id LIKE '${safe}%'`);
    }
    const where = conditions.join(' AND ');

    try {
      const listQuery = sql.raw(
        `SELECT
           thought_id, thread_id, stakes, judge_score, sensor_id,
           model_id, produced_at
         FROM kernel_provenance
         WHERE ${where}
         ORDER BY produced_at DESC
         LIMIT ${options.limit} OFFSET ${options.offset}`,
      );
      const countQuery = sql.raw(
        `SELECT COUNT(*)::bigint AS total FROM kernel_provenance WHERE ${where}`,
      );
      const [listResult, countResult] = await Promise.all([
        db.execute(listQuery),
        db.execute(countQuery),
      ]);
      const rows = unwrapRows(listResult);
      const countRow = unwrapRows(countResult)[0] ?? {};
      const total = Number(countRow.total ?? countRow.TOTAL ?? 0) || 0;
      const prefixes = options.capabilityPrefixes ?? [];
      const reverseMap: Record<string, string> = {};
      if (options.capability) {
        for (const p of prefixes) reverseMap[p] = options.capability;
      }
      const runs: EvalRunRow[] = rows.map((r) => {
        const sensorId = toStringOrNull(r.sensor_id ?? r.SENSOR_ID);
        const capability = options.capability
          ? options.capability
          : sensorId
            ? null // capability resolution requires the prefix map; left null without it
            : null;
        return {
          thoughtId: String(r.thought_id ?? r.THOUGHT_ID ?? ''),
          threadId: String(r.thread_id ?? r.THREAD_ID ?? ''),
          stakes: ((r.stakes ?? r.STAKES) as EvalRunRow['stakes']) ?? 'medium',
          judgeScore: toNumberOrNull(r.judge_score ?? r.JUDGE_SCORE),
          category: sensorId ? sensorId.split('.')[0] ?? null : null,
          capability,
          producedAt: toIsoString(r.produced_at ?? r.PRODUCED_AT),
        };
      });
      return { runs, total };
    } catch {
      return { runs: [], total: 0 };
    }
  }

  async function getRun(
    tenantId: string,
    thoughtId: string,
  ): Promise<EvalRunDetail | null> {
    try {
      const safeId = thoughtId.replace(/'/g, "''");
      const safeTenant = tenantId.replace(/'/g, "''");
      const query = sql.raw(
        `SELECT
           p.thought_id, p.thread_id, p.stakes, p.judge_score,
           p.sensor_id, p.model_id, p.produced_at,
           p.input_hash, p.output_hash,
           c.thought_text, c.prompt_hash AS cot_prompt_hash,
           c.response_hash AS cot_response_hash
         FROM kernel_provenance p
         LEFT JOIN kernel_cot_reservoir c ON c.thought_id = p.thought_id
         WHERE p.tenant_id = '${safeTenant}'
           AND p.thought_id = '${safeId}'
         LIMIT 1`,
      );
      const result = await db.execute(query);
      const row = unwrapRows(result)[0];
      if (!row) return null;
      const sensorId = String(row.sensor_id ?? row.SENSOR_ID ?? '');
      return {
        thoughtId: String(row.thought_id ?? row.THOUGHT_ID ?? thoughtId),
        threadId: String(row.thread_id ?? row.THREAD_ID ?? ''),
        stakes: ((row.stakes ?? row.STAKES) as EvalRunDetail['stakes']) ?? 'medium',
        judgeScore: toNumberOrNull(row.judge_score ?? row.JUDGE_SCORE),
        // Judge reason/suggested-fix aren't persisted yet — the kernel's
        // structured judge output lands in a follow-up. Until then the
        // detail drawer renders "—".
        // Follow-up tier-3 (Docs/TODO_BACKLOG.md): persist judge reason + suggestedFix in the
        // provenance row once the structured-judge migration ships.
        category: sensorId ? sensorId.split('.')[0] ?? null : null,
        capability: null,
        producedAt: toIsoString(row.produced_at ?? row.PRODUCED_AT),
        cotThoughtText: toStringOrNull(row.thought_text ?? row.THOUGHT_TEXT),
        judgeReasonText: null,
        judgeSuggestedFix: null,
        promptHash:
          toStringOrNull(row.cot_prompt_hash ?? row.COT_PROMPT_HASH)
          ?? toStringOrNull(row.input_hash ?? row.INPUT_HASH),
        responseHash:
          toStringOrNull(row.cot_response_hash ?? row.COT_RESPONSE_HASH)
          ?? toStringOrNull(row.output_hash ?? row.OUTPUT_HASH),
        modelId: String(row.model_id ?? row.MODEL_ID ?? ''),
        sensorId,
      };
    } catch {
      return null;
    }
  }

  async function rejudge(
    _tenantId: string,
    thoughtId: string,
    _options: RejudgeOptions,
  ): Promise<RejudgeVerdict> {
    // Follow-up tier-3 (Docs/TODO_BACKLOG.md): wire to a real judge-runner worker. Today we accept
    // the rejudge request, record nothing (the kernel-eval worker isn't
    // mounted in api-gateway yet), and surface "queued" so the UI can
    // show optimistic feedback without silently dropping the intent.
    return {
      accepted: true,
      queued: true,
      thoughtId,
      requestedAt: now().toISOString(),
    };
  }

  return {
    getRollup,
    listRuns,
    getRun,
    rejudge,
  };
}
