/**
 * /api/v1/scenarios — scenario-simulation + mastery-checkpoint surface
 * (migration 0283).
 *
 * Backs the owner-web cockpit training surfaces:
 *   - /training/scenarios   (scenario-simulation, gap 9)
 *   - /training/checkpoint  (mastery-checkpoint w/ BKT gating, gap 10)
 *
 * Routes (all tenant-scoped via JWT + RLS; the learner id is the verified
 * JWT subject — never client-sent):
 *   GET   /                       list active scenario templates
 *   POST  /generate               (re)generate templates from the catalog
 *   POST  /sessions               start a run (admin-locked role-mode
 *                                 validated SERVER-SIDE)
 *   POST  /sessions/:id/turn      append a transcript turn
 *   POST  /sessions/:id/complete  close a run with score + feedback
 *   GET   /checkpoint             build a checkpoint (inverse-BKT weighted)
 *   POST  /checkpoint/submit      record results; 0.7 pass gates next phase
 *
 * GAP 13 — service binding / honest-degrade (CLAUDE.md hard rule): the
 * training service is null in degraded mode (service-registry leaves the
 * `training` slot null when no live DB), so this route NEVER depends on that
 * slot. It builds its own ScenarioRepository from the request-scoped DB
 * client (`c.get('db')`); when that client is unset it returns a typed 503
 * (SERVICE_UNAVAILABLE) rather than fabricating a row, and when the catalog
 * resolves no concept it returns empty data with `degraded: true`.
 *
 * Admin-locked role-mode deep-link: the scenarios page can deep-link a
 * specific `roleMode`. The server VALIDATES it against (a) the global
 * role-mode allowlist and (b) the role-modes permitted for the scenario's
 * kind, rejecting a mismatch with 403 — a client cannot self-grant a mode.
 *
 * No `@ts-nocheck`: each handler types `c` as `any` (the same pattern as
 * org-admin.hono.ts) so Hono v4's status-code literal-union widening on
 * multiple `c.json({...}, status)` branches does not fire.
 *
 * Ported from the BossNyumba scenarios route and retargeted
 * real-estate -> mining.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';

import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { withSecurityEvents } from '@borjie/observability';
import {
  createScenarioGenerator,
  buildCheckpointQuestions,
  type CheckpointQuestion,
} from '@borjie/ai-copilot/training';
import {
  ScenarioRepository,
  type ProvenanceLike,
  type ScenarioRow,
} from '../composition/scenario-repository';

// ── role-mode allowlist (admin-locked deep-link guard) ─────────────────────
// The junior sub-persona the operator rehearses as. A deep-link may request
// one of these; anything else is rejected. Each scenario kind further
// restricts which modes are valid for it (defense in depth).
const ROLE_MODES = [
  'compliance',
  'finance',
  'safety',
  'commercial',
  'operations',
] as const;
type RoleMode = (typeof ROLE_MODES)[number];

const KIND_ROLE_MODES: Record<string, readonly RoleMode[]> = {
  licence_renewal_negotiation: ['compliance', 'operations'],
  royalty_dispute: ['finance', 'compliance'],
  safety_incident_triage: ['safety', 'operations'],
  offtake_negotiation: ['commercial', 'finance'],
  contractor_damage_claim: ['operations', 'compliance'],
};

/** Default role-mode for a kind (used when the deep-link omits roleMode). */
function defaultRoleModeForKind(kind: string): RoleMode {
  const modes = KIND_ROLE_MODES[kind];
  return modes?.[0] ?? 'operations';
}

const PASS_THRESHOLD = 0.7;
const CHECKPOINT_LIMIT = 8;

// ── zod schemas ────────────────────────────────────────────────────────────

const LanguageSchema = z.enum(['en', 'sw']).optional().default('en');
const DifficultySchema = z
  .enum(['beginner', 'intermediate', 'advanced'])
  .optional()
  .default('beginner');

const GenerateSchema = z.object({
  difficulty: DifficultySchema,
  language: LanguageSchema,
});

const StartSessionSchema = z.object({
  scenarioId: z.string().uuid(),
  roleMode: z.enum(ROLE_MODES).optional(),
});

const TurnSchema = z.object({
  message: z.string().min(1).max(4000),
  coveredConceptIds: z.array(z.string().min(1)).max(50).optional(),
});

const CompleteSchema = z.object({
  score: z.number().finite().min(0).max(1),
  coveredConceptIds: z.array(z.string().min(1)).max(50).optional(),
  notes: z.string().max(4000).optional(),
});

const CheckpointSubmitSchema = z.object({
  conceptIds: z.array(z.string().min(1)).min(1).max(50),
  results: z
    .array(
      z.object({
        conceptId: z.string().min(1),
        correct: z.boolean(),
      }),
    )
    .min(1)
    .max(50),
});

// ── helpers ──────────────────────────────────────────────────────────────

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'ScenarioRepository not configured — database client is unset',
      },
    },
    503,
  );
}

function provenanceFrom(c: any, via: string): ProvenanceLike {
  const auth = c.get('auth');
  return {
    via,
    actorId: auth?.userId ?? null,
    sessionId: null,
    turnId: null,
    requestedAt: new Date().toISOString(),
  };
}

/** Map a generated scenario row to the API view (locale-shaped at the edge). */
function scenarioView(row: ScenarioRow) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    titleSw: row.title_sw,
    summary: row.summary,
    summarySw: row.summary_sw,
    difficulty: row.difficulty,
    language: row.language,
    conceptIds: row.concept_ids,
    briefing: row.briefing,
    estimatedMinutes: row.estimated_minutes,
    roleModes: KIND_ROLE_MODES[row.kind] ?? [],
  };
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

// ── GET / — list active scenario templates ────────────────────────────────

app.get('/', async (c: any) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return notConfigured(c);
  const language = c.req.query('language') ?? undefined;
  const repo = new ScenarioRepository(db);
  const rows = await repo.listScenarios(auth.tenantId, language);
  return c.json({
    success: true,
    data: rows.map(scenarioView),
    degraded: rows.length === 0,
  });
});

// ── POST /generate — (re)generate templates from the concept catalog ──────
// Honest-degrade: kinds with no catalog match are skipped (never fabricated).

app.post(
  '/generate',
  zValidator('json', GenerateSchema),
  withSecurityEvents(
    { action: 'scenarios.generate', resource: 'scenario', severity: 'info' },
    async (c: any) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const { difficulty, language } = c.req.valid('json');
      const generator = createScenarioGenerator();
      const generated = generator.generateAll(difficulty, language);
      if (generated.length === 0) {
        return c.json({ success: true, data: [], degraded: true });
      }
      const repo = new ScenarioRepository(db);
      const provenance = provenanceFrom(c, 'api');
      const persisted: ScenarioRow[] = [];
      for (const gen of generated) {
        persisted.push(await repo.upsertScenario(auth.tenantId, gen, provenance));
      }
      return c.json({
        success: true,
        data: persisted.map(scenarioView),
        degraded: false,
      });
    },
  ),
);

// ── POST /sessions — start a run (role-mode validated server-side) ─────────

app.post(
  '/sessions',
  zValidator('json', StartSessionSchema),
  withSecurityEvents(
    {
      action: 'scenarios.session.start',
      resource: 'scenario_session',
      severity: 'info',
    },
    async (c: any) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const { scenarioId, roleMode } = c.req.valid('json');
      const repo = new ScenarioRepository(db);

      const scenario = await repo.findScenario(auth.tenantId, scenarioId);
      if (!scenario) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'scenario not found' },
          },
          404,
        );
      }

      // Admin-locked role-mode validation: the requested mode (or the kind's
      // default) MUST be one of the kind's permitted modes. A client cannot
      // self-grant a mode by tampering with the deep-link.
      const allowed = KIND_ROLE_MODES[scenario.kind] ?? [];
      const effective = roleMode ?? defaultRoleModeForKind(scenario.kind);
      if (!allowed.includes(effective)) {
        return c.json(
          {
            success: false,
            error: {
              code: 'FORBIDDEN_ROLE_MODE',
              message: `role-mode "${effective}" is not permitted for ${scenario.kind}`,
            },
          },
          403,
        );
      }

      const result = await repo.startSession(
        auth.tenantId,
        scenarioId,
        auth.userId,
        effective,
      );
      if (!result.ok) {
        const status = result.code === 'NOT_FOUND' ? 404 : 500;
        return c.json(
          { success: false, error: { code: result.code, message: result.message } },
          status,
        );
      }
      return c.json(
        {
          success: true,
          data: {
            sessionId: result.session.id,
            scenario: scenarioView(scenario),
            roleMode: effective,
          },
        },
        201,
      );
    },
  ),
);

// ── POST /sessions/:id/turn — append a transcript turn ────────────────────
// The counterparty reply is grounded in the scenario briefing (no free-hand
// fabrication): we surface the next un-covered objective from the briefing.

app.post(
  '/sessions/:id/turn',
  zValidator('json', TurnSchema),
  async (c: any) => {
    const auth = c.get('auth');
    const db = c.get('db');
    if (!db) return notConfigured(c);
    const sessionId = c.req.param('id');
    const { message, coveredConceptIds } = c.req.valid('json');
    const repo = new ScenarioRepository(db);

    const session = await repo.findSession(auth.tenantId, sessionId, auth.userId);
    if (!session) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'session not found' } },
        404,
      );
    }
    const scenario = await repo.findScenario(auth.tenantId, session.scenario_id);
    if (!scenario) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'scenario not found' } },
        404,
      );
    }

    const briefing = (scenario.briefing ?? {}) as {
      objectives?: ReadonlyArray<{ conceptId: string; en: string; sw: string }>;
    };
    const objectives = briefing.objectives ?? [];
    const coverage = (session.coverage ?? {}) as Record<string, boolean>;
    const newlyCovered = coveredConceptIds ?? [];
    const coverageDelta: Record<string, boolean> = {};
    for (const id of newlyCovered) coverageDelta[id] = true;

    // Ground the reply in the next un-covered objective (catalog-derived).
    const merged = { ...coverage, ...coverageDelta };
    const nextObjective = objectives.find((o) => !merged[o.conceptId]) ?? null;
    const reply = nextObjective
      ? { en: nextObjective.en, sw: nextObjective.sw, conceptId: nextObjective.conceptId }
      : null;

    const turn = {
      learner: message,
      reply,
      at: new Date().toISOString(),
    };
    const result = await repo.appendTurn(
      auth.tenantId,
      sessionId,
      auth.userId,
      turn,
      coverageDelta,
    );
    if (!result.ok) {
      return c.json(
        { success: false, error: { code: result.code, message: result.message } },
        result.code === 'NOT_FOUND' ? 404 : 500,
      );
    }
    const coveredCount = Object.values(merged).filter(Boolean).length;
    return c.json({
      success: true,
      data: {
        reply,
        coveredConceptIds: Object.keys(merged).filter((k) => merged[k]),
        objectivesTotal: objectives.length,
        objectivesCovered: coveredCount,
        complete: objectives.length > 0 && coveredCount >= objectives.length,
      },
    });
  },
);

// ── POST /sessions/:id/complete — close a run with score + feedback ───────

app.post(
  '/sessions/:id/complete',
  zValidator('json', CompleteSchema),
  withSecurityEvents(
    {
      action: 'scenarios.session.complete',
      resource: 'scenario_session',
      severity: 'info',
    },
    async (c: any) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const sessionId = c.req.param('id');
      const { score, coveredConceptIds, notes } = c.req.valid('json');
      const repo = new ScenarioRepository(db);

      const coverage: Record<string, boolean> = {};
      for (const id of coveredConceptIds ?? []) coverage[id] = true;
      const feedback = {
        passed: score >= PASS_THRESHOLD,
        notes: notes ?? null,
      };
      const result = await repo.completeSession(
        auth.tenantId,
        sessionId,
        auth.userId,
        score,
        feedback,
        coverage,
      );
      if (!result.ok) {
        return c.json(
          { success: false, error: { code: result.code, message: result.message } },
          result.code === 'NOT_FOUND' ? 404 : 500,
        );
      }
      return c.json({
        success: true,
        data: {
          sessionId: result.session.id,
          score,
          passed: score >= PASS_THRESHOLD,
        },
      });
    },
  ),
);

// ── GET /checkpoint — build a checkpoint (inverse-BKT weighted) ────────────
// Questions are built deterministically from the concept catalog; concept ids
// are weighted weakest-first by the learner's learning_progress p_know
// (inverse-BKT). Honest-degrade: empty data when nothing resolves.

app.get('/checkpoint', async (c: any) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return notConfigured(c);
  const language = (c.req.query('language') === 'sw' ? 'sw' : 'en') as 'en' | 'sw';
  const phaseKind = c.req.query('kind') ?? undefined;
  const repo = new ScenarioRepository(db);

  // Concept pool: the union of concept ids across the tenant's scenarios for
  // the (optional) kind — these are the concepts the operator has been
  // rehearsing. Falls back to every scenario's concepts.
  const scenarios = await repo.listScenarios(auth.tenantId, language);
  const relevant = phaseKind
    ? scenarios.filter((s) => s.kind === phaseKind)
    : scenarios;
  const conceptIdSet = new Set<string>();
  for (const s of relevant) {
    for (const id of s.concept_ids) conceptIdSet.add(id);
  }
  const conceptIds = [...conceptIdSet];
  if (conceptIds.length === 0) {
    return c.json({ success: true, data: { questions: [], degraded: true } });
  }

  const questions = buildCheckpointQuestions(conceptIds, language);
  if (questions.length === 0) {
    return c.json({ success: true, data: { questions: [], degraded: true } });
  }

  // Inverse-BKT weighting: order weakest concept first by p_know.
  const progress = await repo.listProgress(auth.tenantId, auth.userId);
  const pKnow: Record<string, number> = {};
  for (const p of progress) pKnow[p.concept_id] = p.p_know;
  const weighted = orderByInverseBkt(questions, pKnow).slice(0, CHECKPOINT_LIMIT);

  return c.json({
    success: true,
    data: {
      questions: weighted,
      passThreshold: PASS_THRESHOLD,
      kind: phaseKind ?? null,
      degraded: false,
    },
  });
});

/** Order checkpoint questions weakest-concept-first by inverse BKT confidence. */
function orderByInverseBkt(
  questions: readonly CheckpointQuestion[],
  pKnow: Readonly<Record<string, number>>,
): readonly CheckpointQuestion[] {
  return [...questions].sort((a, b) => {
    const wa = 1 - (pKnow[a.conceptId] ?? 0);
    const wb = 1 - (pKnow[b.conceptId] ?? 0);
    return wb - wa;
  });
}

// ── POST /checkpoint/submit — record results; 0.7 pass gates next phase ────

app.post(
  '/checkpoint/submit',
  zValidator('json', CheckpointSubmitSchema),
  withSecurityEvents(
    { action: 'scenarios.checkpoint.submit', resource: 'learning_progress', severity: 'info' },
    async (c: any) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return notConfigured(c);
      const { results } = c.req.valid('json');
      const repo = new ScenarioRepository(db);

      const total = results.length;
      const correctCount = results.filter((r: { correct: boolean }) => r.correct).length;
      const score = total > 0 ? correctCount / total : 0;
      const passed = score >= PASS_THRESHOLD;

      // Per-concept progress: a correct answer nudges p_know high, an incorrect
      // one low. mastered := p_know >= PASS_THRESHOLD. Append-or-upsert.
      const rows = results.map((r: { conceptId: string; correct: boolean }) => {
        const pKnow = r.correct ? 0.85 : 0.3;
        return {
          conceptId: r.conceptId,
          pKnow,
          attempts: 1,
          correct: r.correct ? 1 : 0,
          mastered: pKnow >= PASS_THRESHOLD,
        };
      });
      const written = await repo.upsertProgress(
        auth.tenantId,
        auth.userId,
        rows,
        'checkpoint',
      );

      const weakConceptIds = results
        .filter((r: { correct: boolean }) => !r.correct)
        .map((r: { conceptId: string }) => r.conceptId);

      return c.json({
        success: true,
        data: {
          score,
          correct: correctCount,
          total,
          passed,
          passThreshold: PASS_THRESHOLD,
          weakConceptIds,
          progressWritten: written,
        },
      });
    },
  ),
);

export const scenariosRouter = app;
export default app;
