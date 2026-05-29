/**
 * Decision Journal — brain tool catalog.
 *
 * Six read-only tools exposing the decision journal to the brain.
 * Owner can ask "what did I decide about Geita compliance last
 * quarter?" or "why did I file royalty 3 days early last month?" and
 * the brain calls one of these tools to fetch the recorded answer.
 *
 *   1. decisions.recent              — list recent decisions (optional kind + scope filter)
 *   2. decisions.explain             — full rationale + alternatives + outcome
 *   3. decisions.search              — semantic search across rationale + subject
 *   4. decisions.replay              — context that informed a past decision
 *   5. decisions.what_did_i_decide   — natural-language lookup by topic
 *   6. decisions.success_rate        — % of decisions graded 'good'
 *
 * Persona binding: every tool is exposed to BOTH the owner strategist
 * (T1) AND the admin strategist (T2) — admins dogfood the same
 * journal when debugging an owner's chat session.
 *
 * Tier discipline: every tool is `isWrite: false`, `stakes: 'LOW'`,
 * `requiresPolicyRuleLiteral: false`. None of them mutate state — the
 * recorder + retrospective worker are the only writers.
 *
 * Tenant isolation: handlers resolve `tenantId` from the tool-execution
 * context. The api-gateway middleware binds `app.tenant_id` so RLS
 * scopes every SELECT to the calling tenant.
 */

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { DatabaseClient } from '@borjie/database';
import type { PersonaToolDescriptor } from './types';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ToolDeps {
  readonly db: DbLike;
}

let injectedDeps: ToolDeps | null = null;

/**
 * Wire the database client at composition time. Called once from the
 * api-gateway composition root. The brain-teach route reuses this via
 * the brain-tools barrel.
 */
export function configureDecisionJournalTools(deps: ToolDeps): void {
  injectedDeps = Object.freeze({ db: deps.db });
}

function requireDb(): DbLike {
  if (!injectedDeps) {
    throw new Error(
      'decision-journal-tools: configureDecisionJournalTools(deps) was not called at composition time',
    );
  }
  return injectedDeps.db;
}

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function asString(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  return typeof v === 'string' ? v : '';
}

function asNullableString(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const v = row[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNumberOrNull(
  row: Record<string, unknown>,
  key: string,
): number | null {
  const v = row[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asJson<T>(row: Record<string, unknown>, key: string, fallback: T): T {
  const v = row[key];
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'object') return v as T;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

const DecidedByKindEnum = z.enum([
  'owner',
  'brain',
  'agent_apply',
  'four_eye',
  'automated_policy',
]);

// ─────────────────────────────────────────────────────────────────────
// 1. decisions.recent
// ─────────────────────────────────────────────────────────────────────

const RecentInput = z
  .object({
    since: z.string().datetime().optional(),
    kindFilter: DecidedByKindEnum.optional(),
    scopeIds: z.array(z.string().min(1).max(80)).max(20).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const RecentDecisionShape = z.object({
  id: z.string(),
  decidedByKind: z.string(),
  decidedByActorId: z.string(),
  decisionSubject: z.string(),
  decisionSubjectEntityKind: z.string().nullable(),
  decisionSubjectEntityId: z.string().nullable(),
  rationale: z.string(),
  confidence: z.number().nullable(),
  decidedAt: z.string(),
  scopeIds: z.array(z.string()),
  status: z.string(),
});

const RecentOutput = z.object({
  decisions: z.array(RecentDecisionShape),
});

export const decisionsRecentTool: PersonaToolDescriptor<
  typeof RecentInput,
  typeof RecentOutput
> = {
  id: 'decisions.recent',
  name: 'Decisions — recent',
  description:
    'List recent decisions for the tenant. Optional filters: since (ISO timestamp), ' +
    'kindFilter (owner / brain / agent_apply / four_eye / automated_policy), scopeIds. ' +
    'Use when the owner asks "what have I decided lately?" or you need a quick scan ' +
    'before answering a strategic question.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: RecentInput,
  outputSchema: RecentOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const db = requireDb();
    const limit = input.limit ?? 20;
    const since = input.since ?? null;
    const kind = input.kindFilter ?? null;
    const scopeIds = input.scopeIds ?? null;
    const rows = asRows(
      await db.execute(sql`
        SELECT id, decided_by_kind, decided_by_actor_id, decision_subject,
               decision_subject_entity_kind, decision_subject_entity_id,
               rationale, confidence, decided_at, scope_ids, status
          FROM decisions
         WHERE tenant_id = ${ctx.tenantId}
           AND (${since}::timestamptz IS NULL OR decided_at >= ${since}::timestamptz)
           AND (${kind}::text IS NULL OR decided_by_kind = ${kind}::text)
           AND (
             ${scopeIds === null}::boolean
             OR scope_ids && ${scopeIds as unknown as string[]}::text[]
           )
         ORDER BY decided_at DESC
         LIMIT ${limit}
      `),
    );
    return {
      decisions: rows.map((row) => ({
        id: asString(row, 'id'),
        decidedByKind: asString(row, 'decided_by_kind'),
        decidedByActorId: asString(row, 'decided_by_actor_id'),
        decisionSubject: asString(row, 'decision_subject'),
        decisionSubjectEntityKind: asNullableString(
          row,
          'decision_subject_entity_kind',
        ),
        decisionSubjectEntityId: asNullableString(
          row,
          'decision_subject_entity_id',
        ),
        rationale: asString(row, 'rationale'),
        confidence: asNumberOrNull(row, 'confidence'),
        decidedAt: asString(row, 'decided_at'),
        scopeIds: asJson<string[]>(row, 'scope_ids', []),
        status: asString(row, 'status'),
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2. decisions.explain
// ─────────────────────────────────────────────────────────────────────

const ExplainInput = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

const ExplainOutput = z.object({
  id: z.string(),
  decisionSubject: z.string(),
  decidedByKind: z.string(),
  decidedByActorId: z.string(),
  decidedValue: z.record(z.string(), z.unknown()),
  alternativesConsidered: z.array(
    z.object({
      option: z.union([z.string(), z.record(z.string(), z.unknown())]),
      whyNot: z.string(),
    }),
  ),
  rationale: z.string(),
  confidence: z.number().nullable(),
  decidedAt: z.string(),
  status: z.string(),
  outcome: z
    .object({
      grade: z.string(),
      summary: z.string(),
      observedValueTzs: z.number().nullable(),
      learnings: z.string().nullable(),
      recordedBy: z.string(),
      observedAt: z.string(),
    })
    .nullable(),
});

export const decisionsExplainTool: PersonaToolDescriptor<
  typeof ExplainInput,
  typeof ExplainOutput
> = {
  id: 'decisions.explain',
  name: 'Decisions — explain',
  description:
    'Return the full rationale, alternatives considered, and outcome (if graded) ' +
    'for a single decision by id. Use when the owner asks "why did I do X?".',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ExplainInput,
  outputSchema: ExplainOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const db = requireDb();
    const rows = asRows(
      await db.execute(sql`
        SELECT d.id, d.decision_subject, d.decided_by_kind, d.decided_by_actor_id,
               d.decided_value, d.alternatives_considered, d.rationale,
               d.confidence, d.decided_at, d.status,
               o.retrospective_grade AS o_grade,
               o.outcome_summary     AS o_summary,
               o.observed_value_tzs  AS o_value,
               o.learnings           AS o_learnings,
               o.recorded_by         AS o_recorded_by,
               o.observed_at         AS o_observed_at
          FROM decisions d
          LEFT JOIN decision_outcomes o ON o.decision_id = d.id AND o.tenant_id = d.tenant_id
         WHERE d.tenant_id = ${ctx.tenantId}
           AND d.id = ${input.id}
         ORDER BY o.observed_at DESC NULLS LAST
         LIMIT 1
      `),
    );
    if (rows.length === 0) {
      throw new Error(`decision ${input.id} not found`);
    }
    const row = rows[0] as Record<string, unknown>;
    const grade = asNullableString(row, 'o_grade');
    return {
      id: asString(row, 'id'),
      decisionSubject: asString(row, 'decision_subject'),
      decidedByKind: asString(row, 'decided_by_kind'),
      decidedByActorId: asString(row, 'decided_by_actor_id'),
      decidedValue: asJson<Record<string, unknown>>(row, 'decided_value', {}),
      alternativesConsidered: asJson<
        { option: string | Record<string, unknown>; whyNot: string }[]
      >(row, 'alternatives_considered', []),
      rationale: asString(row, 'rationale'),
      confidence: asNumberOrNull(row, 'confidence'),
      decidedAt: asString(row, 'decided_at'),
      status: asString(row, 'status'),
      outcome:
        grade === null
          ? null
          : {
              grade,
              summary: asString(row, 'o_summary'),
              observedValueTzs: asNumberOrNull(row, 'o_value'),
              learnings: asNullableString(row, 'o_learnings'),
              recordedBy: asString(row, 'o_recorded_by'),
              observedAt: asString(row, 'o_observed_at'),
            },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 3. decisions.search
// ─────────────────────────────────────────────────────────────────────

const SearchInput = z
  .object({
    query: z.string().min(2).max(200),
    since: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

const SearchOutput = z.object({
  matches: z.array(RecentDecisionShape),
});

export const decisionsSearchTool: PersonaToolDescriptor<
  typeof SearchInput,
  typeof SearchOutput
> = {
  id: 'decisions.search',
  name: 'Decisions — search',
  description:
    'Full-text search across decision subject + rationale. Use when the owner ' +
    'asks "have I ever decided anything about X?" without naming a specific id.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: SearchInput,
  outputSchema: SearchOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const db = requireDb();
    const limit = input.limit ?? 10;
    const since = input.since ?? null;
    const rows = asRows(
      await db.execute(sql`
        SELECT id, decided_by_kind, decided_by_actor_id, decision_subject,
               decision_subject_entity_kind, decision_subject_entity_id,
               rationale, confidence, decided_at, scope_ids, status
          FROM decisions
         WHERE tenant_id = ${ctx.tenantId}
           AND (${since}::timestamptz IS NULL OR decided_at >= ${since}::timestamptz)
           AND to_tsvector('english', decision_subject || ' ' || rationale)
               @@ plainto_tsquery('english', ${input.query})
         ORDER BY decided_at DESC
         LIMIT ${limit}
      `),
    );
    return {
      matches: rows.map((row) => ({
        id: asString(row, 'id'),
        decidedByKind: asString(row, 'decided_by_kind'),
        decidedByActorId: asString(row, 'decided_by_actor_id'),
        decisionSubject: asString(row, 'decision_subject'),
        decisionSubjectEntityKind: asNullableString(
          row,
          'decision_subject_entity_kind',
        ),
        decisionSubjectEntityId: asNullableString(
          row,
          'decision_subject_entity_id',
        ),
        rationale: asString(row, 'rationale'),
        confidence: asNumberOrNull(row, 'confidence'),
        decidedAt: asString(row, 'decided_at'),
        scopeIds: asJson<string[]>(row, 'scope_ids', []),
        status: asString(row, 'status'),
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 4. decisions.replay
// ─────────────────────────────────────────────────────────────────────

const ReplayInput = z
  .object({
    id: z.string().uuid(),
  })
  .strict();

const ReplayOutput = z.object({
  decision: z.object({
    id: z.string(),
    decisionSubject: z.string(),
    rationale: z.string(),
    decidedAt: z.string(),
  }),
  linkedDecisions: z.array(
    z.object({
      id: z.string(),
      relationship: z.string(),
      decisionSubject: z.string(),
      decidedAt: z.string(),
    }),
  ),
  predictionId: z.string().nullable(),
  provenance: z.record(z.string(), z.unknown()),
});

export const decisionsReplayTool: PersonaToolDescriptor<
  typeof ReplayInput,
  typeof ReplayOutput
> = {
  id: 'decisions.replay',
  name: 'Decisions — replay',
  description:
    'Return the full context that informed a past decision: linked decisions ' +
    '(supersedes / depends_on / informed_by / reversed_by), the related ' +
    'prediction id (if any), and the provenance envelope captured at decide-time. ' +
    'Use when the owner asks "what was I thinking when I decided X?".',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ReplayInput,
  outputSchema: ReplayOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const db = requireDb();
    const baseRows = asRows(
      await db.execute(sql`
        SELECT id, decision_subject, rationale, decided_at,
               related_prediction_id, provenance
          FROM decisions
         WHERE tenant_id = ${ctx.tenantId}
           AND id = ${input.id}
         LIMIT 1
      `),
    );
    if (baseRows.length === 0) {
      throw new Error(`decision ${input.id} not found`);
    }
    const base = baseRows[0] as Record<string, unknown>;

    const linkRows = asRows(
      await db.execute(sql`
        SELECT l.relationship, d.id, d.decision_subject, d.decided_at
          FROM decision_links l
          JOIN decisions d
            ON d.id = l.target_decision_id
           AND d.tenant_id = l.tenant_id
         WHERE l.tenant_id = ${ctx.tenantId}
           AND l.source_decision_id = ${input.id}
         ORDER BY d.decided_at DESC
         LIMIT 25
      `),
    );

    return {
      decision: {
        id: asString(base, 'id'),
        decisionSubject: asString(base, 'decision_subject'),
        rationale: asString(base, 'rationale'),
        decidedAt: asString(base, 'decided_at'),
      },
      linkedDecisions: linkRows.map((row) => ({
        id: asString(row, 'id'),
        relationship: asString(row, 'relationship'),
        decisionSubject: asString(row, 'decision_subject'),
        decidedAt: asString(row, 'decided_at'),
      })),
      predictionId: asNullableString(base, 'related_prediction_id'),
      provenance: asJson<Record<string, unknown>>(base, 'provenance', {}),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 5. decisions.what_did_i_decide
// ─────────────────────────────────────────────────────────────────────

const WhatDidIDecideInput = z
  .object({
    about: z.string().min(2).max(200),
    since: z.string().datetime().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  })
  .strict();

const WhatDidIDecideOutput = z.object({
  about: z.string(),
  decisions: z.array(
    z.object({
      id: z.string(),
      decisionSubject: z.string(),
      rationale: z.string(),
      decidedAt: z.string(),
      grade: z.string().nullable(),
      summary: z.string().nullable(),
    }),
  ),
});

export const decisionsWhatDidIDecideTool: PersonaToolDescriptor<
  typeof WhatDidIDecideInput,
  typeof WhatDidIDecideOutput
> = {
  id: 'decisions.what_did_i_decide',
  name: 'Decisions — what did I decide',
  description:
    'Natural-language lookup: "what did I decide about Geita compliance last ' +
    'quarter?". Returns matching decisions with their rationale + (if available) ' +
    'retrospective grade and outcome summary.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: WhatDidIDecideInput,
  outputSchema: WhatDidIDecideOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const db = requireDb();
    const limit = input.limit ?? 5;
    const since = input.since ?? null;
    const rows = asRows(
      await db.execute(sql`
        SELECT d.id, d.decision_subject, d.rationale, d.decided_at,
               o.retrospective_grade AS grade,
               o.outcome_summary     AS summary
          FROM decisions d
          LEFT JOIN decision_outcomes o ON o.decision_id = d.id AND o.tenant_id = d.tenant_id
         WHERE d.tenant_id = ${ctx.tenantId}
           AND (${since}::timestamptz IS NULL OR d.decided_at >= ${since}::timestamptz)
           AND to_tsvector('english', d.decision_subject || ' ' || d.rationale)
               @@ plainto_tsquery('english', ${input.about})
         ORDER BY d.decided_at DESC
         LIMIT ${limit}
      `),
    );
    return {
      about: input.about,
      decisions: rows.map((row) => ({
        id: asString(row, 'id'),
        decisionSubject: asString(row, 'decision_subject'),
        rationale: asString(row, 'rationale'),
        decidedAt: asString(row, 'decided_at'),
        grade: asNullableString(row, 'grade'),
        summary: asNullableString(row, 'summary'),
      })),
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 6. decisions.success_rate
// ─────────────────────────────────────────────────────────────────────

const SuccessRateInput = z
  .object({
    since: z.string().datetime().optional(),
    kindFilter: DecidedByKindEnum.optional(),
  })
  .strict();

const SuccessRateOutput = z.object({
  windowStart: z.string().nullable(),
  totalGraded: z.number().int(),
  good: z.number().int(),
  neutral: z.number().int(),
  bad: z.number().int(),
  undetermined: z.number().int(),
  successRate: z.number(),
});

export const decisionsSuccessRateTool: PersonaToolDescriptor<
  typeof SuccessRateInput,
  typeof SuccessRateOutput
> = {
  id: 'decisions.success_rate',
  name: 'Decisions — success rate',
  description:
    'Aggregate the % of graded decisions that landed as "good" in the time ' +
    'window. Use when the owner asks "how am I doing?" or you need to ' +
    'calibrate your own confidence before recommending a new decision.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: SuccessRateInput,
  outputSchema: SuccessRateOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const db = requireDb();
    const since = input.since ?? null;
    const kind = input.kindFilter ?? null;
    const rows = asRows(
      await db.execute(sql`
        SELECT o.retrospective_grade AS grade, COUNT(*) AS n
          FROM decision_outcomes o
          JOIN decisions d
            ON d.id = o.decision_id
           AND d.tenant_id = o.tenant_id
         WHERE o.tenant_id = ${ctx.tenantId}
           AND (${since}::timestamptz IS NULL OR o.observed_at >= ${since}::timestamptz)
           AND (${kind}::text IS NULL OR d.decided_by_kind = ${kind}::text)
         GROUP BY o.retrospective_grade
      `),
    );

    let good = 0;
    let neutral = 0;
    let bad = 0;
    let undetermined = 0;
    for (const row of rows) {
      const grade = asString(row, 'grade');
      const n = Number(row.n ?? 0);
      if (grade === 'good') good = n;
      else if (grade === 'neutral') neutral = n;
      else if (grade === 'bad') bad = n;
      else if (grade === 'undetermined') undetermined = n;
    }
    const total = good + neutral + bad + undetermined;
    const successRate = total === 0 ? 0 : Number((good / total).toFixed(3));

    return {
      windowStart: since,
      totalGraded: total,
      good,
      neutral,
      bad,
      undetermined,
      successRate,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Catalog export
// ─────────────────────────────────────────────────────────────────────

export const DECISION_JOURNAL_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  decisionsRecentTool,
  decisionsExplainTool,
  decisionsSearchTool,
  decisionsReplayTool,
  decisionsWhatDidIDecideTool,
  decisionsSuccessRateTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);

// DatabaseClient re-export at top-level lets composition wire avoid a
// second package-level import path. Re-export rather than re-derive so
// configureDecisionJournalTools and the brain-tools barrel agree on
// the same type definition.
export type { DatabaseClient };
