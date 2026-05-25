/**
 * Classroom wiring — adapts the pure BKT + session-manager functions from
 * `@borjie/ai-copilot/classroom` into a service shape consumed by
 * `routes/classroom.router.ts`.
 *
 * Persistence is backed by the `classroom_sessions`,
 * `classroom_participants`, `classroom_quiz_responses`, and `bkt_mastery`
 * tables introduced in migration 0045. If the DB client is not available
 * the service falls back to an in-memory map; every endpoint still works
 * end-to-end but state is lost on restart.
 *
 * Tenant isolation is enforced on every read/write.
 */

import { sql } from 'drizzle-orm';
import { createDatabaseClient } from '@borjie/database';

/**
 * DatabaseClient derived via `ReturnType<typeof createDatabaseClient>`
 * so we sidestep the package-barrel `TS2709 Cannot use namespace ... as
 * a type` drift (see service-registry.ts for the full explanation).
 */
type DatabaseClient = ReturnType<typeof createDatabaseClient>;
import {
  initBKT,
  updateBKT,
  type BKTState,
} from '@borjie/ai-copilot/classroom';

export interface ClassroomSessionRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly createdBy: string;
  readonly title: string;
  readonly state: 'idle' | 'active' | 'paused' | 'ended';
  readonly language: 'en' | 'sw' | 'mixed';
  readonly targetConceptIds: readonly string[];
  readonly coveredConceptIds: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClassroomService {
  createSession(input: {
    tenantId: string;
    createdBy: string;
    title: string;
    language: 'en' | 'sw' | 'mixed';
    targetConceptIds: readonly string[];
  }): Promise<ClassroomSessionRecord>;

  getSession(
    tenantId: string,
    sessionId: string,
  ): Promise<ClassroomSessionRecord | null>;

  recordQuizResponse(input: {
    tenantId: string;
    sessionId: string;
    userId: string;
    conceptId: string;
    isCorrect: boolean;
    quizId?: string;
    answerIndex?: number;
    answerText?: string;
    latencyMs?: number;
  }): Promise<{
    readonly mastery: BKTState;
    readonly sessionId: string;
    readonly conceptId: string;
  }>;

  getMastery(
    tenantId: string,
    userId: string,
  ): Promise<readonly (BKTState & { conceptId: string })[]>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Postgres-backed implementation
// ---------------------------------------------------------------------------

function asList(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function createPgClassroom(db: DatabaseClient): ClassroomService {
  const exec = (db as unknown as { execute(q: unknown): Promise<unknown> }).execute.bind(
    db as unknown as { execute(q: unknown): Promise<unknown> },
  );

  return {
    async createSession(input) {
      const id = genId('cls');
      const now = nowIso();
      await exec(sql`
        INSERT INTO classroom_sessions
          (id, tenant_id, title, created_by, state, language,
           target_concept_ids, covered_concept_ids, metadata,
           created_at, updated_at)
        VALUES
          (${id}, ${input.tenantId}, ${input.title}, ${input.createdBy},
           'idle', ${input.language},
           ${JSON.stringify(input.targetConceptIds)}::jsonb,
           '[]'::jsonb, '{}'::jsonb,
           ${now}, ${now})
      `);
      return {
        id,
        tenantId: input.tenantId,
        createdBy: input.createdBy,
        title: input.title,
        state: 'idle',
        language: input.language,
        targetConceptIds: [...input.targetConceptIds],
        coveredConceptIds: [],
        createdAt: now,
        updatedAt: now,
      };
    },

    async getSession(tenantId, sessionId) {
      const rows = asList(
        await exec(sql`
          SELECT id, tenant_id, title, created_by, state, language,
                 target_concept_ids, covered_concept_ids,
                 created_at, updated_at
          FROM classroom_sessions
          WHERE tenant_id = ${tenantId} AND id = ${sessionId}
          LIMIT 1
        `),
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: String(row.id),
        tenantId: String(row.tenant_id),
        createdBy: String(row.created_by),
        title: String(row.title),
        state: row.state as ClassroomSessionRecord['state'],
        language: row.language as ClassroomSessionRecord['language'],
        targetConceptIds: Array.isArray(row.target_concept_ids)
          ? (row.target_concept_ids as string[])
          : [],
        coveredConceptIds: Array.isArray(row.covered_concept_ids)
          ? (row.covered_concept_ids as string[])
          : [],
        createdAt:
          row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
        updatedAt:
          row.updated_at instanceof Date
            ? row.updated_at.toISOString()
            : String(row.updated_at),
      };
    },

    async recordQuizResponse(input) {
      // Load prior mastery.
      const rows = asList(
        await exec(sql`
          SELECT p_know, p_learn, p_slip, p_guess, observations
          FROM bkt_mastery
          WHERE tenant_id = ${input.tenantId}
            AND user_id = ${input.userId}
            AND concept_id = ${input.conceptId}
          LIMIT 1
        `),
      );
      const prior: BKTState = rows[0]
        ? {
            pKnow: Number(rows[0].p_know ?? 0.1),
            pLearn: Number(rows[0].p_learn ?? 0.2),
            pSlip: Number(rows[0].p_slip ?? 0.1),
            pGuess: Number(rows[0].p_guess ?? 0.2),
            observations: Number(rows[0].observations ?? 0),
          }
        : initBKT();

      const next = updateBKT(prior, input.isCorrect);
      const now = nowIso();

      // Upsert mastery.
      const masteryId = `bkt_${input.tenantId}_${input.userId}_${input.conceptId}`;
      await exec(sql`
        INSERT INTO bkt_mastery
          (id, tenant_id, user_id, concept_id,
           p_know, p_learn, p_slip, p_guess, observations, updated_at)
        VALUES
          (${masteryId}, ${input.tenantId}, ${input.userId}, ${input.conceptId},
           ${next.pKnow}, ${next.pLearn}, ${next.pSlip}, ${next.pGuess},
           ${next.observations}, ${now})
        ON CONFLICT (tenant_id, user_id, concept_id)
        DO UPDATE SET
          p_know = EXCLUDED.p_know,
          p_learn = EXCLUDED.p_learn,
          p_slip = EXCLUDED.p_slip,
          p_guess = EXCLUDED.p_guess,
          observations = EXCLUDED.observations,
          updated_at = EXCLUDED.updated_at
      `);

      return {
        mastery: next,
        sessionId: input.sessionId,
        conceptId: input.conceptId,
      };
    },

    async getMastery(tenantId, userId) {
      const rows = asList(
        await exec(sql`
          SELECT concept_id, p_know, p_learn, p_slip, p_guess, observations
          FROM bkt_mastery
          WHERE tenant_id = ${tenantId} AND user_id = ${userId}
          ORDER BY concept_id
        `),
      );
      return rows.map((r) => ({
        conceptId: String(r.concept_id),
        pKnow: Number(r.p_know ?? 0),
        pLearn: Number(r.p_learn ?? 0),
        pSlip: Number(r.p_slip ?? 0),
        pGuess: Number(r.p_guess ?? 0),
        observations: Number(r.observations ?? 0),
      }));
    },
  };
}

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

function createInMemoryClassroom(): ClassroomService {
  const sessions = new Map<string, ClassroomSessionRecord>();
  const mastery = new Map<string, Record<string, BKTState>>(); // key = tenantId:userId

  function masteryKey(tenantId: string, userId: string): string {
    return `${tenantId}::${userId}`;
  }

  return {
    async createSession(input) {
      const id = genId('cls');
      const now = nowIso();
      const rec: ClassroomSessionRecord = {
        id,
        tenantId: input.tenantId,
        createdBy: input.createdBy,
        title: input.title,
        state: 'idle',
        language: input.language,
        targetConceptIds: [...input.targetConceptIds],
        coveredConceptIds: [],
        createdAt: now,
        updatedAt: now,
      };
      sessions.set(id, rec);
      return rec;
    },
    async getSession(tenantId, sessionId) {
      const s = sessions.get(sessionId);
      if (!s || s.tenantId !== tenantId) return null;
      return s;
    },
    async recordQuizResponse(input) {
      const key = masteryKey(input.tenantId, input.userId);
      const userMastery = mastery.get(key) ?? {};
      const prior = userMastery[input.conceptId] ?? initBKT();
      const next = updateBKT(prior, input.isCorrect);
      const updated = { ...userMastery, [input.conceptId]: next };
      mastery.set(key, updated);
      return { mastery: next, sessionId: input.sessionId, conceptId: input.conceptId };
    },
    async getMastery(tenantId, userId) {
      const key = masteryKey(tenantId, userId);
      const m = mastery.get(key) ?? {};
      return Object.entries(m).map(([conceptId, st]) => ({ conceptId, ...st }));
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createClassroomService(
  db: DatabaseClient | null,
): ClassroomService {
  return db ? createPgClassroom(db) : createInMemoryClassroom();
}
