/**
 * Postgres-backed ScenarioRepository (migration 0283).
 *
 * Encapsulates the scenario-simulation + learning-progress data layer behind
 * the `/api/v1/scenarios/*` route. Ported from the BossNyumba training
 * workspace persistence and retargeted real-estate -> mining.
 *
 * Scenario CONTENT is never stored from client input — the route hands this
 * repository a `GeneratedScenario` built by the ScenarioGenerator from the
 * concept catalog (honest-degrade: no generated scenario => nothing to
 * persist). The repository owns:
 *
 *   - upsertScenario   : idempotent by (tenant, kind, difficulty, language);
 *                        re-running the generator converges to one row.
 *   - listScenarios    : tenant-scoped active templates.
 *   - findScenario     : one template by id within the tenant.
 *   - startSession     : open a learner run (role-mode validated in route).
 *   - appendTurn       : append one transcript turn (never mutates prior).
 *   - completeSession  : close a run with score + feedback + coverage.
 *   - upsertProgress   : per-concept mastery snapshot from checkpoint results
 *                        (0.7 pass gates next phase).
 *   - listProgress     : per-user mastery snapshot for inverse-BKT weighting.
 *
 * Every method is tenant-scoped: each SQL statement carries
 * `WHERE tenant_id = ${tenantId}`. RLS (FORCE-enabled in mig 0283) is the
 * primary guard; the explicit filter is defense in depth, mirroring the other
 * repositories in this directory. tenant_id is TEXT (Borjie convention — see
 * org-team-repository.ts), so NO `::uuid` cast is applied to it.
 *
 * Result discipline (honest-degrade): domain failures return a discriminated
 * `{ ok: false; code; message }` — never throw for a domain miss, never
 * fabricate a row.
 */

import { randomUUID, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

// ── shared result + row types ──────────────────────────────────────────

export interface ScenarioRepoFailure {
  readonly ok: false;
  readonly code: 'NOT_FOUND' | 'INVALID_INPUT' | 'NO_ROWS';
  readonly message: string;
}

export type ScenarioRepoResult<T> =
  | ({ readonly ok: true } & T)
  | ScenarioRepoFailure;

interface DbExec {
  execute(query: unknown): Promise<unknown>;
}

export interface ScenarioRow {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly title_sw: string | null;
  readonly summary: string;
  readonly summary_sw: string | null;
  readonly difficulty: string;
  readonly language: string;
  readonly concept_ids: readonly string[];
  readonly briefing: Record<string, unknown>;
  readonly estimated_minutes: number;
  readonly status: string;
  readonly created_at: string;
}

export interface ScenarioSessionRow {
  readonly id: string;
  readonly scenario_id: string;
  readonly user_id: string;
  readonly role_mode: string;
  readonly status: string;
  readonly turns: readonly unknown[];
  readonly coverage: Record<string, unknown>;
  readonly score: number | null;
  readonly feedback: Record<string, unknown>;
  readonly started_at: string;
  readonly completed_at: string | null;
}

export interface LearningProgressRow {
  readonly concept_id: string;
  readonly p_know: number;
  readonly attempts: number;
  readonly correct: number;
  readonly mastered: string;
}

/** Shape the route hands `upsertScenario` (built by ScenarioGenerator). */
export interface GeneratedScenarioLike {
  readonly kind: string;
  readonly difficulty: string;
  readonly language: string;
  readonly titleEn: string;
  readonly titleSw: string;
  readonly summaryEn: string;
  readonly summarySw: string;
  readonly conceptIds: readonly string[];
  readonly estimatedMinutes: number;
  readonly briefing: unknown;
  readonly generatedBy: string;
}

export interface ProvenanceLike {
  readonly via: string;
  readonly actorId: string | null;
  readonly sessionId: string | null;
  readonly turnId: string | null;
  readonly requestedAt: string;
}

export interface ProgressUpsert {
  readonly conceptId: string;
  readonly pKnow: number;
  readonly attempts: number;
  readonly correct: number;
  readonly mastered: boolean;
}

// ── helpers ─────────────────────────────────────────────────────────────

function extractRows<T>(res: unknown): readonly T[] {
  if (Array.isArray(res)) return res as T[];
  const maybe = (res as { rows?: T[] } | null)?.rows;
  return maybe ?? [];
}

function auditHash(input: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function provenanceJson(p: ProvenanceLike | undefined): string {
  const safe: ProvenanceLike = p ?? {
    via: 'unknown',
    actorId: null,
    sessionId: null,
    turnId: null,
    requestedAt: new Date().toISOString(),
  };
  return JSON.stringify(safe);
}

export class ScenarioRepository {
  constructor(private readonly db: DbExec) {}

  // ── scenarios ──────────────────────────────────────────────────────

  /**
   * Idempotent upsert of a generated scenario template. Conflict target is
   * (tenant_id, kind, difficulty, language) — re-running the generator with
   * the same catalog converges to one row and refreshes the briefing.
   */
  async upsertScenario(
    tenantId: string,
    gen: GeneratedScenarioLike,
    provenance: ProvenanceLike | undefined,
  ): Promise<ScenarioRow> {
    const id = randomUUID();
    const hash = auditHash({
      tenantId,
      kind: gen.kind,
      difficulty: gen.difficulty,
      conceptIds: gen.conceptIds,
    });
    const res = await this.db.execute(sql`
      INSERT INTO scenarios (
        id, tenant_id, kind, title, title_sw, summary, summary_sw,
        difficulty, language, concept_ids, briefing, estimated_minutes,
        status, generated_by, provenance, audit_hash_id
      ) VALUES (
        ${id}::uuid, ${tenantId}, ${gen.kind}, ${gen.titleEn},
        ${gen.titleSw}, ${gen.summaryEn}, ${gen.summarySw}, ${gen.difficulty},
        ${gen.language}, ${JSON.stringify(gen.conceptIds)}::jsonb,
        ${JSON.stringify(gen.briefing)}::jsonb, ${gen.estimatedMinutes},
        'active', ${gen.generatedBy}, ${provenanceJson(provenance)}::jsonb,
        ${hash}
      )
      ON CONFLICT (tenant_id, kind, difficulty, language)
      DO UPDATE SET
        title = EXCLUDED.title,
        title_sw = EXCLUDED.title_sw,
        summary = EXCLUDED.summary,
        summary_sw = EXCLUDED.summary_sw,
        concept_ids = EXCLUDED.concept_ids,
        briefing = EXCLUDED.briefing,
        estimated_minutes = EXCLUDED.estimated_minutes,
        status = 'active',
        updated_at = now()
      RETURNING id, kind, title, title_sw, summary, summary_sw, difficulty,
                language, concept_ids, briefing, estimated_minutes, status,
                created_at
    `);
    return extractRows<ScenarioRow>(res)[0]!;
  }

  /** List active scenario templates for the tenant (optionally one language). */
  async listScenarios(
    tenantId: string,
    language?: string,
  ): Promise<readonly ScenarioRow[]> {
    const res = language
      ? await this.db.execute(sql`
          SELECT id, kind, title, title_sw, summary, summary_sw, difficulty,
                 language, concept_ids, briefing, estimated_minutes, status,
                 created_at
            FROM scenarios
           WHERE tenant_id = ${tenantId}
             AND status = 'active'
             AND language = ${language}
           ORDER BY kind, difficulty
        `)
      : await this.db.execute(sql`
          SELECT id, kind, title, title_sw, summary, summary_sw, difficulty,
                 language, concept_ids, briefing, estimated_minutes, status,
                 created_at
            FROM scenarios
           WHERE tenant_id = ${tenantId}
             AND status = 'active'
           ORDER BY kind, difficulty
        `);
    return extractRows<ScenarioRow>(res);
  }

  /** One scenario template by id within the tenant. */
  async findScenario(
    tenantId: string,
    id: string,
  ): Promise<ScenarioRow | null> {
    const res = await this.db.execute(sql`
      SELECT id, kind, title, title_sw, summary, summary_sw, difficulty,
             language, concept_ids, briefing, estimated_minutes, status,
             created_at
        FROM scenarios
       WHERE tenant_id = ${tenantId} AND id = ${id}::uuid
       LIMIT 1
    `);
    return extractRows<ScenarioRow>(res)[0] ?? null;
  }

  // ── sessions ─────────────────────────────────────────────────────────

  /** Open a learner run. The route validates role-mode before calling. */
  async startSession(
    tenantId: string,
    scenarioId: string,
    userId: string,
    roleMode: string,
  ): Promise<ScenarioRepoResult<{ session: ScenarioSessionRow }>> {
    const scenario = await this.findScenario(tenantId, scenarioId);
    if (!scenario) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: `scenario ${scenarioId} not found in tenant`,
      };
    }
    const id = randomUUID();
    const res = await this.db.execute(sql`
      INSERT INTO scenario_sessions (
        id, tenant_id, scenario_id, user_id, role_mode, status, turns,
        coverage
      ) VALUES (
        ${id}::uuid, ${tenantId}, ${scenarioId}::uuid, ${userId},
        ${roleMode}, 'in_progress', '[]'::jsonb, '{}'::jsonb
      )
      RETURNING id, scenario_id, user_id, role_mode, status, turns, coverage,
                score, feedback, started_at, completed_at
    `);
    const session = extractRows<ScenarioSessionRow>(res)[0];
    if (!session) {
      return { ok: false, code: 'NO_ROWS', message: 'session insert returned no row' };
    }
    return { ok: true, session };
  }

  /** One session by id within the tenant + owned by the user. */
  async findSession(
    tenantId: string,
    sessionId: string,
    userId: string,
  ): Promise<ScenarioSessionRow | null> {
    const res = await this.db.execute(sql`
      SELECT id, scenario_id, user_id, role_mode, status, turns, coverage,
             score, feedback, started_at, completed_at
        FROM scenario_sessions
       WHERE tenant_id = ${tenantId}
         AND id = ${sessionId}::uuid
         AND user_id = ${userId}
       LIMIT 1
    `);
    return extractRows<ScenarioSessionRow>(res)[0] ?? null;
  }

  /**
   * Append one transcript turn + merge coverage. Uses jsonb concat / merge so
   * prior turns are never mutated in place (append-only transcript).
   */
  async appendTurn(
    tenantId: string,
    sessionId: string,
    userId: string,
    turn: unknown,
    coverageDelta: Record<string, unknown>,
  ): Promise<ScenarioRepoResult<{ session: ScenarioSessionRow }>> {
    const res = await this.db.execute(sql`
      UPDATE scenario_sessions
         SET turns = turns || ${JSON.stringify([turn])}::jsonb,
             coverage = coverage || ${JSON.stringify(coverageDelta)}::jsonb
       WHERE tenant_id = ${tenantId}
         AND id = ${sessionId}::uuid
         AND user_id = ${userId}
         AND status = 'in_progress'
      RETURNING id, scenario_id, user_id, role_mode, status, turns, coverage,
                score, feedback, started_at, completed_at
    `);
    const session = extractRows<ScenarioSessionRow>(res)[0];
    if (!session) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'no in-progress session for this user',
      };
    }
    return { ok: true, session };
  }

  /** Close a run with a final score + feedback + coverage snapshot. */
  async completeSession(
    tenantId: string,
    sessionId: string,
    userId: string,
    score: number,
    feedback: unknown,
    coverage: Record<string, unknown>,
  ): Promise<ScenarioRepoResult<{ session: ScenarioSessionRow }>> {
    const res = await this.db.execute(sql`
      UPDATE scenario_sessions
         SET status = 'completed',
             score = ${score},
             feedback = ${JSON.stringify(feedback)}::jsonb,
             coverage = coverage || ${JSON.stringify(coverage)}::jsonb,
             completed_at = now()
       WHERE tenant_id = ${tenantId}
         AND id = ${sessionId}::uuid
         AND user_id = ${userId}
      RETURNING id, scenario_id, user_id, role_mode, status, turns, coverage,
                score, feedback, started_at, completed_at
    `);
    const session = extractRows<ScenarioSessionRow>(res)[0];
    if (!session) {
      return {
        ok: false,
        code: 'NOT_FOUND',
        message: 'session not found for this user',
      };
    }
    return { ok: true, session };
  }

  // ── learning progress ────────────────────────────────────────────────

  /**
   * Upsert a per-concept mastery snapshot. Conflict target is
   * (tenant, user, concept) so checkpoint re-runs accumulate attempts/correct
   * and refresh p_know + mastered.
   */
  async upsertProgress(
    tenantId: string,
    userId: string,
    rows: readonly ProgressUpsert[],
    source: string,
  ): Promise<number> {
    let written = 0;
    for (const r of rows) {
      const id = randomUUID();
      await this.db.execute(sql`
        INSERT INTO learning_progress (
          id, tenant_id, user_id, concept_id, p_know, attempts, correct,
          mastered, source, last_seen_at
        ) VALUES (
          ${id}::uuid, ${tenantId}, ${userId}, ${r.conceptId},
          ${r.pKnow}, ${r.attempts}, ${r.correct},
          ${r.mastered ? 'yes' : 'no'}, ${source}, now()
        )
        ON CONFLICT (tenant_id, user_id, concept_id)
        DO UPDATE SET
          p_know = EXCLUDED.p_know,
          attempts = learning_progress.attempts + EXCLUDED.attempts,
          correct = learning_progress.correct + EXCLUDED.correct,
          mastered = EXCLUDED.mastered,
          source = EXCLUDED.source,
          last_seen_at = now(),
          updated_at = now()
      `);
      written += 1;
    }
    return written;
  }

  /** Per-user mastery snapshot for inverse-BKT checkpoint weighting. */
  async listProgress(
    tenantId: string,
    userId: string,
  ): Promise<readonly LearningProgressRow[]> {
    const res = await this.db.execute(sql`
      SELECT concept_id, p_know, attempts, correct, mastered
        FROM learning_progress
       WHERE tenant_id = ${tenantId} AND user_id = ${userId}
       ORDER BY concept_id
    `);
    return extractRows<LearningProgressRow>(res);
  }
}
