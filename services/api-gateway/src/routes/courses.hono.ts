/**
 * /api/v1/courses (migration 0284).
 *
 * AI course-generation for the owner-cockpit create-course flow. An operator
 * picks a domain, describes a scenario, optionally attaches documents, and the
 * brain (or the deterministic mining concept-catalog sequencer) generates a
 * 5-to-8 lesson course.
 *
 * Routes (all tenant-scoped via JWT + RLS, owner-scoped to the signed-in
 * operator on top of RLS — no IDOR across cockpit users):
 *   POST  /generate        kick off generation; returns a placeholder id (202)
 *   GET   /                list my courses, newest first
 *   GET   /:id             my course + lessons (the poller hits this)
 *
 * GAP 13 — service binding / honest-degrade (CLAUDE.md hard rule): this route
 * builds its own CoursesRepo from the request-scoped DB client (`c.get('db')`);
 * when that client is unset it returns a typed 503 rather than fabricating a
 * row. The LLM seam is built from the brain LLM router adapters (env-keyed);
 * when no key is configured the generator honest-degrades to the deterministic
 * sequencer (provenance 'deterministic'). Content is NEVER silently fabricated.
 *
 * No `@ts-nocheck`: each handler types `c` as `any` (the same pattern as
 * scenarios.hono.ts / org-admin.hono.ts) so Hono v4's status-code literal-union
 * widening on multiple `c.json({...}, status)` branches does not fire.
 *
 * SECURITY
 *   - authMiddleware: the actor is ALWAYS auth.userId; no user-id input.
 *   - assertTierPolicy(COURSE_POLICY, 'courses.generate') before the write.
 *   - per-(tenant,user) in-memory rate limit — LLM generation is expensive.
 *   - zod-validated body.
 *
 * Ported from the BossNyumba courses route and retargeted real-estate ->
 * mining.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { withSecurityEvents } from '@borjie/observability';
// INPUT CONTAINMENT (CLOSE-G) — the blessed ingress prompt-injection / jailbreak
// guard, applied to the operator's free-text `scenarioDescription` BEFORE
// `kickoffGeneration` reaches the LLM. CRITICAL → 403 INPUT_GUARD_REFUSED (the
// model never sees it); lower severities → generate from the detector-redacted
// description. Fail-OPEN-but-logged inside the guard.
import {
  applyIngressGuard,
  pickIngressGuardLang,
} from '../composition/ingress-guard-apply.js';
// IP-EGRESS (CLOSE-G) — the FAIL-CLOSED egress firewall. GET / and GET /:id read
// back the PERSISTED model-authored curriculum (`title` / `summary`) + lessons
// (`lessonTitle` / `content`); those leaves must be stripped of persona / CoT /
// secret content before the JSON leaves the gateway.
import { getEgressFilter } from '../composition/egress-filter-wiring.js';
import pino from 'pino';
import { assertTierPolicy, type RolePolicy } from '@borjie/central-intelligence';
import {
  AnthropicAdapter,
  OpenAIAdapter,
} from '@borjie/brain-llm-router/universal-client';
import type { BrainLLMClient, ContentBlock } from '@borjie/brain-llm-router';
import {
  createCourseService,
  findCourseDomain,
  courseDomainLabel,
  COURSE_LANGUAGES,
  COURSE_DIFFICULTIES,
  type CoursesRepo,
  type LLMPort,
} from '../services/courses/index.js';

// ---------------------------------------------------------------------------
// Tier policy — owner-cockpit self-service training surface.
// ---------------------------------------------------------------------------
// A minimal RolePolicy granting the right to generate + read one's own courses.
// Non-high-risk (no money / sovereign prefix), so a literal allow-list is
// sufficient — these endpoints are reachable by any authenticated tenant member
// (the route still owner-scopes every row). The role is the closest MdRole for
// an operator self-service action.
const COURSE_POLICY: RolePolicy = {
  role: 'ESTATE_MANAGER',
  description: 'Operator self-service course generation + reading.',
  rules: [
    {
      id: 'courses.generate',
      role: 'ESTATE_MANAGER',
      action: 'courses.generate',
      verdict: 'allow',
      reason:
        'Generating a personal training course is a safe self-service learning action with no money or sovereign side effects.',
      principle: 'self-service-learning',
      examples: ['courses.read', 'scenarios.generate'],
    },
    {
      id: 'courses.read',
      role: 'ESTATE_MANAGER',
      action: 'courses.read',
      verdict: 'allow',
      reason:
        'Reading your own generated courses is a safe self-service learning action.',
      principle: 'self-service-learning',
      examples: ['courses.generate', 'scenarios.list'],
    },
  ],
};

// ---------------------------------------------------------------------------
// Rate limiting — LLM generation is expensive. Per-(tenant,user), in-memory.
// (Matches the in-memory limiter convention used elsewhere in the gateway.)
// ---------------------------------------------------------------------------
const GENERATE_WINDOW_MS = 60_000;
const GENERATE_MAX = 5;
const rlStore = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  let entry = rlStore.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + GENERATE_WINDOW_MS };
    rlStore.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > GENERATE_MAX) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

// Periodic cleanup so the map does not grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rlStore) {
    if (now > v.resetAt) rlStore.delete(k);
  }
}, GENERATE_WINDOW_MS).unref?.();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const DocumentSchema = z.object({
  documentId: z.string().min(1).max(200),
  documentName: z.string().max(300).optional().default(''),
  documentType: z.string().max(200).optional().default(''),
  summary: z.string().max(4_000).optional().default(''),
  extractedData: z.record(z.string(), z.unknown()).optional().default({}),
});

const GenerateSchema = z.object({
  domain: z.string().min(1).max(200),
  scenarioDescription: z.string().min(10).max(4_000),
  documents: z.array(DocumentSchema).max(10).optional().default([]),
  language: z.enum(COURSE_LANGUAGES).optional().default('en'),
  difficulty: z.enum(COURSE_DIFFICULTIES).optional().default('beginner'),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowsOf(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === 'object' && 'rows' in raw) {
    const r = (raw as { rows: unknown }).rows;
    if (Array.isArray(r)) return r as Record<string, unknown>[];
  }
  return [];
}

function unavailable(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'CoursesRepo not configured — database client is unset',
      },
    },
    503,
  );
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'courses' });

/** Fail-closed placeholder when the deep guard wrapper itself throws. */
const COURSE_EGRESS_FAIL_CLOSED = '[redacted]';

/**
 * Guard one model-authored text span through the FAIL-CLOSED egress firewall
 * (persists block rows). The filter returns a redacted placeholder on any
 * internal fault; this wrapper additionally try/catches so a construction fault
 * fails closed to `[redacted]` rather than leaking raw curriculum text.
 */
function guardCourseText(text: string, tenantId: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    return getEgressFilter().guardFinal(text, tenantId).text;
  } catch (err) {
    logger.error(
      {
        wiring: 'egress-filter',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'courses: egress guard threw — failing closed (redacting span)',
    );
    return COURSE_EGRESS_FAIL_CLOSED;
  }
}

/**
 * Recursively egress-guard EVERY string leaf of an arbitrary JSON value
 * (the model-authored lesson `content` blob), rebuilt immutably with guarded
 * leaves and untouched keys. Pure: returns a NEW value, never mutates.
 */
function deepGuardCourse<T>(value: T, tenantId: string): T {
  if (typeof value === 'string') {
    return guardCourseText(value, tenantId) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => deepGuardCourse(v, tenantId)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = deepGuardCourse(v, tenantId);
    }
    return out as T;
  }
  return value;
}

function toSummary(row: Record<string, unknown>, tenantId: string) {
  const curriculum = (row.ai_generated_curriculum ?? {}) as Record<string, unknown>;
  const generationError =
    typeof row.generation_error === 'string' && row.generation_error.length > 0
      ? (row.generation_error as string)
      : undefined;
  const summary: Record<string, unknown> = {
    id: asString(row.id),
    domain: asString(row.domain),
    // scenario_description is the operator's OWN ingress-redacted input (stored
    // post-guard at generation), echoed back to the same operator — not model-
    // authored, so it is not an egress concern.
    scenarioDescription: asString(row.scenario_description),
    status: asString(row.status, 'draft'),
    difficulty: asString(row.difficulty, 'beginner'),
    language: asString(row.language, 'en'),
    // IP-EGRESS (CLOSE-G) — title + summary are model-authored curriculum prose.
    title: guardCourseText(asString(curriculum.title), tenantId),
    summary: guardCourseText(asString(curriculum.summary), tenantId),
    lessonCount: typeof row.lesson_count === 'number' ? row.lesson_count : 0,
    generatedVia: asString(row.generated_via, 'deterministic'),
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : asString(row.created_at),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : asString(row.updated_at),
  };
  // The failure message can echo a raw provider/model error — egress-filter it.
  if (generationError) {
    summary.generationError = guardCourseText(generationError, tenantId);
  }
  return summary;
}

function toLessonRow(row: Record<string, unknown>, tenantId: string) {
  return {
    id: asString(row.id),
    lessonNumber: typeof row.lesson_number === 'number' ? row.lesson_number : 0,
    // IP-EGRESS (CLOSE-G) — lessonTitle + the full lesson content blob are
    // model-authored; deep-guard every prose leaf through the fail-closed filter.
    lessonTitle: guardCourseText(asString(row.lesson_title), tenantId),
    status: asString(row.status, 'not_started'),
    quizScore: typeof row.quiz_score === 'number' ? row.quiz_score : null,
    content: deepGuardCourse(
      (row.lesson_content ?? {}) as Record<string, unknown>,
      tenantId,
    ),
  };
}

// ---------------------------------------------------------------------------
// SQL-backed repo over the shared drizzle client. Every query is scoped to
// (tenant_id, created_by_user_id) — defence in depth on top of RLS.
// ---------------------------------------------------------------------------

function makeRepo(db: any, tenantId: string): CoursesRepo {
  return {
    async createPlaceholder(args) {
      const id = randomUUID();
      const now = new Date().toISOString();
      const documentIds = JSON.stringify(args.documents.map((d) => d.documentId));
      await db.execute(sql`
        INSERT INTO courses (
          id, tenant_id, created_by_user_id, domain, scenario_description,
          status, difficulty, language, ai_generated_curriculum, lesson_count,
          document_ids, created_at, updated_at
        ) VALUES (
          ${id}, ${tenantId}, ${args.userId}, ${args.domain}, ${args.scenarioDescription},
          'draft', ${args.difficulty}, ${args.language}, '{}'::jsonb, 0,
          ${documentIds}::jsonb, ${now}, ${now}
        )
      `);
      // Document grounding rows — non-fatal if they fail (course still usable).
      for (const d of args.documents) {
        try {
          await db.execute(sql`
            INSERT INTO course_documents (
              id, tenant_id, course_id, created_by_user_id, document_id,
              document_name, document_type, extracted_data, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, ${tenantId}, ${id}, ${args.userId}, ${d.documentId},
              ${d.documentName}, ${d.documentType}, ${JSON.stringify(d.extractedData)}::jsonb,
              ${now}, ${now}
            )
          `);
        } catch {
          // best-effort document attach.
        }
      }
      return id;
    },

    async finalize(args) {
      const now = new Date().toISOString();
      // RESILIENCE (mfr-4) — the N lesson INSERTs and the course UPDATE
      // (draft → in_progress) MUST land atomically: a crash or transient DB
      // error part-way through the loop would otherwise leave orphan lesson
      // rows while the course stays 'draft', a state the re-generate path
      // (which mints a brand-new course id) never resumes. Wrapping the whole
      // finalise in one transaction makes the lessons + the status flip a
      // single all-or-nothing commit. The unique (course_id, lesson_number)
      // constraint keeps a double background run idempotent inside the tx.
      await db.transaction(async (tx: any) => {
        for (let index = 0; index < args.course.lessons.length; index++) {
          const lesson = args.course.lessons[index];
          if (!lesson) continue;
          await tx.execute(sql`
            INSERT INTO course_lessons (
              id, tenant_id, course_id, created_by_user_id, lesson_number,
              lesson_title, lesson_content, status, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, ${tenantId}, ${args.courseId}, ${args.userId}, ${index + 1},
              ${lesson.title}, ${JSON.stringify(lesson)}::jsonb, 'not_started', ${now}, ${now}
            )
            ON CONFLICT (course_id, lesson_number) DO NOTHING
          `);
        }
        await tx.execute(sql`
          UPDATE courses
             SET status = 'in_progress',
                 ai_generated_curriculum = ${JSON.stringify(args.course)}::jsonb,
                 lesson_count = ${args.course.lessons.length},
                 generated_via = ${args.generatedVia},
                 generation_error = NULL,
                 updated_at = ${now}
           WHERE id = ${args.courseId}
             AND tenant_id = ${tenantId}
             AND created_by_user_id = ${args.userId}
        `);
      });
    },

    async markFailed(t, userId, courseId, message) {
      const now = new Date().toISOString();
      const safe = (message || 'Course generation failed').slice(0, 500);
      await db.execute(sql`
        UPDATE courses
           SET status = 'draft',
               lesson_count = 0,
               generation_error = ${safe},
               updated_at = ${now}
         WHERE id = ${courseId}
           AND tenant_id = ${t}
           AND created_by_user_id = ${userId}
      `);
    },

    async list(t, userId) {
      const raw = await db.execute(sql`
        SELECT id, domain, scenario_description, status, difficulty, language,
               ai_generated_curriculum, lesson_count, generated_via,
               generation_error, created_at, updated_at
          FROM courses
         WHERE tenant_id = ${t} AND created_by_user_id = ${userId}
         ORDER BY created_at DESC
      `);
      return rowsOf(raw).map((r) => toSummary(r, tenantId)) as any;
    },

    async get(t, userId, courseId) {
      const courseRaw = await db.execute(sql`
        SELECT id, domain, scenario_description, status, difficulty, language,
               ai_generated_curriculum, lesson_count, generated_via,
               generation_error, created_at, updated_at
          FROM courses
         WHERE id = ${courseId} AND tenant_id = ${t} AND created_by_user_id = ${userId}
         LIMIT 1
      `);
      const courseRows = rowsOf(courseRaw);
      const first = courseRows[0];
      if (!first) return null;
      const lessonsRaw = await db.execute(sql`
        SELECT id, lesson_number, lesson_title, lesson_content, status, quiz_score
          FROM course_lessons
         WHERE course_id = ${courseId} AND tenant_id = ${t} AND created_by_user_id = ${userId}
         ORDER BY lesson_number ASC
      `);
      const lessons = rowsOf(lessonsRaw).map((r) => toLessonRow(r, tenantId));
      return { ...toSummary(first, tenantId), lessons } as any;
    },
  };
}

// ---------------------------------------------------------------------------
// LLM adapter — build an LLMPort from a brain LLM router adapter, or null.
// The provider is chosen by which API key is configured (Anthropic preferred,
// OpenAI fallback). On ANY failure the adapter returns '' so the generator
// honest-degrades to the deterministic sequencer rather than throwing.
// ---------------------------------------------------------------------------

function resolveBrainClient(): { client: BrainLLMClient; model: string } | null {
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    const model =
      process.env.BORJIE_COURSE_ANTHROPIC_MODEL?.trim() ||
      process.env.CLAUDE_MODEL_DEFAULT?.trim() ||
      'claude-sonnet-4-6';
    return { client: new AnthropicAdapter({ apiKey: anthropicKey }), model };
  }
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    const model =
      process.env.BORJIE_COURSE_OPENAI_MODEL?.trim() ||
      process.env.OPENAI_MODEL_DEFAULT?.trim() ||
      'gpt-4o';
    return { client: new OpenAIAdapter({ apiKey: openaiKey }), model };
  }
  return null;
}

/** Concatenate the text blocks of a brain response into a single string. */
function textOf(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function makeLlmPort(): LLMPort | null {
  const resolved = resolveBrainClient();
  if (!resolved) return null;
  const { client, model } = resolved;
  return {
    async complete(prompt: string): Promise<string> {
      try {
        const res = await client.invoke({
          model,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
          maxTokens: 16_000,
          temperature: 0.4,
        });
        return textOf(res.content);
      } catch {
        return '';
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.post(
  '/generate',
  zValidator('json', GenerateSchema),
  withSecurityEvents(
    { action: 'courses.generate', resource: 'course', severity: 'info' },
    async (c: any) => {
      const auth = c.get('auth');
      const db = c.get('db');
      if (!db) return unavailable(c);

      // Tier gate — self-service mutation.
      const policy = assertTierPolicy(COURSE_POLICY, 'courses.generate');
      if (!policy.ok) {
        return c.json(
          { success: false, error: { code: 'TIER_POLICY_DENIED', message: policy.reason } },
          403,
        );
      }

      // Rate gate — LLM generation is expensive.
      const rl = checkRateLimit(`${auth.tenantId}:${auth.userId}`);
      if (!rl.allowed) {
        return c.json(
          {
            success: false,
            error: {
              code: 'RATE_LIMIT',
              message: 'Too many course generations. Try again shortly.',
            },
          },
          429,
          { 'Retry-After': String(rl.retryAfter) },
        );
      }

      const body = c.req.valid('json');
      if (!findCourseDomain(body.domain)) {
        return c.json(
          {
            success: false,
            error: { code: 'UNKNOWN_DOMAIN', message: `unknown domain '${body.domain}'` },
          },
          422,
        );
      }

      // INPUT CONTAINMENT (CLOSE-G) — guard the operator's free-text
      // `scenarioDescription` BEFORE `kickoffGeneration` reaches the LLM.
      // CRITICAL prompt-injection / jailbreak → 403 INPUT_GUARD_REFUSED (the
      // model never sees it). Lower severities → generate from the detector-
      // redacted description (offending spans stripped). Fail-OPEN-but-logged.
      const ingress = await applyIngressGuard({
        userText: body.scenarioDescription,
        tenantId: auth.tenantId,
        userId: auth.userId ?? null,
        lang: pickIngressGuardLang(
          c.req.header('accept-language') ?? (body.language === 'sw' ? 'sw' : 'en'),
        ),
      });
      if (ingress.refused) {
        return c.json(
          {
            success: false,
            error: { code: 'INPUT_GUARD_REFUSED', message: ingress.refusalMessage },
          },
          403,
        );
      }
      const guardedScenario = ingress.text;

      try {
        const repo = makeRepo(db, auth.tenantId);
        const service = createCourseService({
          repo,
          llm: makeLlmPort(),
        });
        const documents = body.documents.map((d: any) => ({
          documentId: d.documentId,
          documentName: d.documentName,
          documentType: d.documentType,
          summary: d.summary,
          extractedData: d.extractedData,
        }));
        const result = await service.kickoffGeneration({
          tenantId: auth.tenantId,
          userId: auth.userId,
          domain: body.domain,
          scenarioDescription: guardedScenario,
          difficulty: body.difficulty,
          language: body.language,
          documents,
        });
        return c.json(
          {
            success: true,
            data: {
              id: result.courseId,
              courseId: result.courseId,
              status: result.status,
              domainLabel: courseDomainLabel(body.domain, body.language),
            },
          },
          202,
        );
      } catch (error) {
        // RESILIENCE (mfr-10) — log the raw cause server-side only; a raw
        // `error.message` in a 500 body can leak DB/driver/provider internals
        // (hard rule: no raw error.message to clients). The client gets a fixed
        // generic banner.
        logger.error(
          {
            tenantId: auth?.tenantId,
            err: error instanceof Error ? error.message : String(error),
          },
          'courses: generate failed',
        );
        return c.json(
          {
            success: false,
            error: {
              code: 'GENERATE_FAILED',
              message: 'Failed to start course generation. Please try again.',
            },
          },
          500,
        );
      }
    },
  ),
);

app.get('/', async (c: any) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return unavailable(c);
  const policy = assertTierPolicy(COURSE_POLICY, 'courses.read');
  if (!policy.ok) {
    return c.json(
      { success: false, error: { code: 'TIER_POLICY_DENIED', message: policy.reason } },
      403,
    );
  }
  try {
    const repo = makeRepo(db, auth.tenantId);
    const data = await repo.list(auth.tenantId, auth.userId);
    return c.json({ success: true, data });
  } catch (error) {
    // RESILIENCE (mfr-10) — log raw cause server-side; never leak error.message.
    logger.error(
      {
        tenantId: auth?.tenantId,
        err: error instanceof Error ? error.message : String(error),
      },
      'courses: list failed',
    );
    return c.json(
      {
        success: false,
        error: {
          code: 'LIST_FAILED',
          message: 'Failed to load courses. Please try again.',
        },
      },
      500,
    );
  }
});

app.get('/:id', async (c: any) => {
  const auth = c.get('auth');
  const db = c.get('db');
  if (!db) return unavailable(c);
  const policy = assertTierPolicy(COURSE_POLICY, 'courses.read');
  if (!policy.ok) {
    return c.json(
      { success: false, error: { code: 'TIER_POLICY_DENIED', message: policy.reason } },
      403,
    );
  }
  try {
    const repo = makeRepo(db, auth.tenantId);
    const course = await repo.get(auth.tenantId, auth.userId, c.req.param('id'));
    if (!course) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Course not found' } },
        404,
      );
    }
    return c.json({ success: true, data: course });
  } catch (error) {
    // RESILIENCE (mfr-10) — log raw cause server-side; never leak error.message.
    logger.error(
      {
        tenantId: auth?.tenantId,
        err: error instanceof Error ? error.message : String(error),
      },
      'courses: get failed',
    );
    return c.json(
      {
        success: false,
        error: {
          code: 'GET_FAILED',
          message: 'Failed to load course. Please try again.',
        },
      },
      500,
    );
  }
});

export const coursesRouter = app;
export default app;
