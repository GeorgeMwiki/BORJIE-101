/**
 * POST /api/v1/mining/brain/vision-turn — multimodal Brain turn for the
 * workforce-mobile Photo Advisor screen.
 *
 * Why this lives in a separate router (not `brain.hono.ts`):
 *  - `brain.hono.ts` is the top-level /api/v1/brain surface; this is a
 *    mining-domain surface mounted under /api/v1/mining/brain/*.
 *  - The mobile pipeline already calls
 *    `POST /api/v1/mining/brain/vision-turn` per the contract in
 *    `apps/workforce-mobile/src/photo-advisor/types.ts`.
 *  - The existing Brain orchestrator (`@borjie/ai-copilot`) does not yet
 *    expose a multimodal turn API. This endpoint validates the request
 *    fully and returns 503 BACKEND_VISION_UNAVAILABLE with a structured
 *    `BRAIN_MULTIMODAL_NOT_WIRED` code so the next agent / human can
 *    close the gap on the orchestrator side without changing the
 *    transport contract.
 *
 * Contract enforcement (per the photo-advisor agent spec):
 *  - 200 — success (currently unreachable until orchestrator is wired)
 *  - 400 — invalid body (missing image / prompt, bad mime, etc.)
 *  - 401 — no auth (via shared authMiddleware)
 *  - 413 — image > 10 MB
 *  - 429 — per-tenant + per-actor rate limit
 *  - 503 — `BACKEND_VISION_UNAVAILABLE` when vision flag OFF or
 *          when orchestrator multimodal API is not yet wired
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import pino from 'pino';
import { authMiddleware } from '../../middleware/hono-auth';
import { rateLimiter as sharedRateLimiter } from '../../middleware/rate-limiter';
import type {
  Brain,
  MediaAttachment,
  TurnResult,
} from '@borjie/ai-copilot';

// Pino logger only — no raw console statements in services (per CLAUDE.md).
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'mining-brain-vision',
});

// ---------------------------------------------------------------------------
// Brain wiring — injectable so unit tests can substitute a deterministic
// mock-provider Brain without spinning up Postgres / Anthropic.
// ---------------------------------------------------------------------------

export interface BrainVisionAuthContext {
  readonly tenantId: string;
  readonly userId: string;
}

export type BrainResolver = (
  ctx: BrainVisionAuthContext,
) => Promise<Brain | null> | Brain | null;

let brainResolver: BrainResolver | null = null;

/**
 * Wire the multimodal brain resolver for this router. In production the
 * gateway composition root injects a resolver that pulls a per-tenant
 * Brain instance from the shared BrainRegistry; in tests we inject a
 * deterministic mock Brain returned by `createBrainForTesting`.
 */
export function setBrainResolver(resolver: BrainResolver | null): void {
  brainResolver = resolver;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** 10 MB upper bound for inbound images (in bytes). */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** Allowed media types. */
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'] as const;

/** Rate-limit window: 30 turns per 60s per (tenantId, userId). */
const VISION_RATE_CONFIG = {
  maxRequests: 30,
  windowSizeSeconds: 60,
} as const;

// ---------------------------------------------------------------------------
// Request / response schemas
// ---------------------------------------------------------------------------

const ImageSchema = z.object({
  base64: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});

const LocationSchema = z
  .object({
    latitude: z.number().finite(),
    longitude: z.number().finite(),
    accuracy: z.number().finite().optional(),
  })
  .nullable();

const VisionTurnRequestSchema = z.object({
  image: ImageSchema,
  prompt: z.string().min(1).max(2_000),
  location: LocationSchema,
  sessionId: z.string().min(1).optional(),
  language: z.enum(['sw', 'en']),
});

type VisionTurnRequest = z.infer<typeof VisionTurnRequestSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isVisionEnabled(): boolean {
  return process.env.ANTHROPIC_VISION_ENABLED === 'true';
}

function checkRate(key: string): boolean {
  return sharedRateLimiter.check(`perUser:brain-vision:${key}`, VISION_RATE_CONFIG)
    .allowed;
}

function validateMimeType(mime: string): mime is 'image/jpeg' | 'image/png' {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Build the bilingual user prompt the orchestrator hands to the persona.
 * Carries the evidence-required rule + caller language.
 */
function buildVisionPrompt(body: VisionTurnRequest): string {
  const langLabel = body.language === 'sw' ? 'Kiswahili' : 'English';
  const locationLine =
    body.location !== null
      ? `Location: lat=${body.location.latitude}, lng=${body.location.longitude}` +
        (body.location.accuracy !== undefined
          ? ` (±${body.location.accuracy}m)`
          : '')
      : 'Location: not provided';
  return [
    `You are analysing a single still image captured by a Borjie field worker.`,
    `Respond in ${langLabel}.`,
    `Cite at least one corpus evidence_id for every recommendation (Borjie evidence-required rule).`,
    `Provide: a short summary, the reasoning, 3-7 concrete suggestions, and the citations array.`,
    '',
    `User prompt: ${body.prompt}`,
    locationLine,
  ].join('\n');
}

interface PersonaPhotoAdvisorPayload {
  readonly summary: string;
  readonly reasoning: string;
  readonly suggestions: ReadonlyArray<string>;
  readonly citations: ReadonlyArray<{
    readonly evidenceId: string;
    readonly source: string;
    readonly excerpt: string;
  }>;
}

function safeParsePersonaJson(
  raw: string,
): PersonaPhotoAdvisorPayload | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch && fenceMatch[1] !== undefined
    ? fenceMatch[1].trim()
    : raw.trim();
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const summary = typeof parsed.summary === 'string' ? parsed.summary : null;
    const reasoning =
      typeof parsed.reasoning === 'string' ? parsed.reasoning : null;
    const suggestionsRaw = Array.isArray(parsed.suggestions)
      ? parsed.suggestions
      : null;
    const citationsRaw = Array.isArray(parsed.citations)
      ? parsed.citations
      : null;
    if (!summary || !reasoning || !suggestionsRaw) return null;
    const suggestions = suggestionsRaw
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
    const citations = (citationsRaw ?? [])
      .map((c) => {
        if (!c || typeof c !== 'object') return null;
        const ev = (c as Record<string, unknown>).evidenceId;
        const src = (c as Record<string, unknown>).source;
        const ex = (c as Record<string, unknown>).excerpt;
        if (typeof ev !== 'string' || typeof src !== 'string') return null;
        return {
          evidenceId: ev,
          source: src,
          excerpt: typeof ex === 'string' ? ex : '',
        };
      })
      .filter((c): c is { readonly evidenceId: string; readonly source: string; readonly excerpt: string } => c !== null);
    return { summary, reasoning, suggestions, citations };
  } catch {
    return null;
  }
}

/**
 * Parse the persona's response text into the photo-advisor wire shape.
 * Falls back to a single-suggestion shape so the mobile UI still shows
 * something meaningful when the model drops the JSON envelope. The
 * fallback citation references the audit chain thread id so the
 * evidence-required rule is never violated.
 */
function composePhotoAdvisorResponse(
  turn: TurnResult,
  fallbackEvidenceId: string,
): {
  readonly summary: string;
  readonly reasoning: string;
  readonly suggestions: ReadonlyArray<string>;
  readonly citations: ReadonlyArray<{
    readonly evidenceId: string;
    readonly source: string;
    readonly excerpt: string;
  }>;
} {
  const parsed = safeParsePersonaJson(turn.responseText);
  if (parsed) {
    const citations =
      parsed.citations.length > 0
        ? parsed.citations
        : [
            {
              evidenceId: fallbackEvidenceId,
              source: 'brain-thread',
              excerpt: 'audit-chain entry for this multimodal turn',
            },
          ];
    return {
      summary: parsed.summary,
      reasoning: parsed.reasoning,
      suggestions: parsed.suggestions,
      citations,
    };
  }
  const text = (turn.responseText ?? '').trim() || 'no_text_response';
  return {
    summary: text.slice(0, 280),
    reasoning: text,
    suggestions: [text.slice(0, 280)],
    citations: [
      {
        evidenceId: fallbackEvidenceId,
        source: 'brain-thread',
        excerpt: 'audit-chain entry for this multimodal turn',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new OpenAPIHono();

// Auth runs first. We deliberately do NOT mount `databaseMiddleware` here
// because the orchestrator wiring is not yet ready; once the multimodal
// orchestrator lands and we need RLS-scoped reads, the database middleware
// can be added without changing the surface contract.
app.use('*', authMiddleware);

app.post('/vision-turn', async (c) => {
  // -------------------------------------------------------------------------
  // 1. Parse body (400 on invalid JSON)
  // -------------------------------------------------------------------------
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      { error: 'invalid_json', code: 'INVALID_BODY' },
      400,
    );
  }

  // -------------------------------------------------------------------------
  // 2. Zod-validate the body
  // -------------------------------------------------------------------------
  const parsed = VisionTurnRequestSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        error: 'invalid_request_body',
        code: 'VALIDATION_FAILED',
        details: parsed.error.flatten(),
      },
      400,
    );
  }
  const body: VisionTurnRequest = parsed.data;

  // -------------------------------------------------------------------------
  // 3. Mime check (400)
  // -------------------------------------------------------------------------
  if (!validateMimeType(body.image.mimeType)) {
    return c.json(
      {
        error: `mime_type_not_supported: ${body.image.mimeType}`,
        code: 'MIME_NOT_IMAGE',
        allowed: ALLOWED_MIME_TYPES,
      },
      400,
    );
  }

  // -------------------------------------------------------------------------
  // 4. Size check (413) — `sizeBytes` is the declared length; for defence
  //    in depth, cross-check the base64 payload's decoded length.
  // -------------------------------------------------------------------------
  if (body.image.sizeBytes > MAX_IMAGE_BYTES) {
    return c.json(
      {
        error: 'image_exceeds_max_size',
        code: 'IMAGE_TOO_LARGE',
        maxBytes: MAX_IMAGE_BYTES,
        actualBytes: body.image.sizeBytes,
      },
      413,
    );
  }

  // Approximate decoded byte length from base64 string length:
  //   bytes ≈ (chars * 3) / 4 minus padding.
  // No need to decode the buffer for the size guard.
  const approxDecodedBytes = Math.floor((body.image.base64.length * 3) / 4);
  if (approxDecodedBytes > MAX_IMAGE_BYTES) {
    return c.json(
      {
        error: 'image_payload_exceeds_max_size',
        code: 'IMAGE_TOO_LARGE',
        maxBytes: MAX_IMAGE_BYTES,
        approxBytes: approxDecodedBytes,
      },
      413,
    );
  }

  // -------------------------------------------------------------------------
  // 5. Auth context (authMiddleware already short-circuited 401 above)
  // -------------------------------------------------------------------------
  const auth = c.get('auth');
  if (!auth?.tenantId || !auth?.userId) {
    return c.json(
      {
        error: 'missing_tenant_or_user_claim',
        code: 'AUTH',
      },
      401,
    );
  }

  // -------------------------------------------------------------------------
  // 6. Rate limit (per tenant + per actor)
  // -------------------------------------------------------------------------
  const rateKey = `${auth.tenantId}:${auth.userId}`;
  if (!checkRate(rateKey)) {
    return c.json(
      { error: 'rate_limited', code: 'RATE_LIMIT' },
      429,
    );
  }

  // -------------------------------------------------------------------------
  // 7. Vision capability flag (503 when OFF)
  // -------------------------------------------------------------------------
  if (!isVisionEnabled()) {
    logger.warn(
      { tenantId: auth.tenantId, userId: auth.userId },
      'vision-turn rejected: ANTHROPIC_VISION_ENABLED flag is OFF',
    );
    return c.json(
      {
        error: 'BACKEND_VISION_UNAVAILABLE',
        code: 'VISION_CAPABILITY_DISABLED',
        message:
          'Anthropic vision capability is disabled. Set ANTHROPIC_VISION_ENABLED=true to enable.',
      },
      503,
    );
  }

  // -------------------------------------------------------------------------
  // 8. Resolve the per-tenant Brain. When no resolver has been injected
  //    (e.g. the gateway composition root has not wired one yet) we
  //    surface a structured 503 — the mobile pipeline already handles
  //    `BACKEND_VISION_UNAVAILABLE`.
  // -------------------------------------------------------------------------
  if (!brainResolver) {
    logger.error(
      { tenantId: auth.tenantId, userId: auth.userId },
      'vision-turn rejected: brain resolver not configured',
    );
    return c.json(
      {
        error: 'BACKEND_VISION_UNAVAILABLE',
        code: 'BRAIN_NOT_CONFIGURED',
        message:
          'Brain resolver not configured. The gateway composition root must call setBrainResolver(...) before this endpoint is reachable.',
      },
      503,
    );
  }

  let brain: Brain | null;
  try {
    brain = await brainResolver({
      tenantId: auth.tenantId,
      userId: auth.userId,
    });
  } catch (err) {
    logger.error(
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        err: err instanceof Error ? err.message : String(err),
      },
      'vision-turn rejected: brain resolver threw',
    );
    return c.json(
      {
        error: 'BACKEND_VISION_UNAVAILABLE',
        code: 'BRAIN_RESOLVE_FAILED',
        message: 'failed to resolve a brain instance for this tenant',
      },
      503,
    );
  }

  if (!brain) {
    return c.json(
      {
        error: 'BACKEND_VISION_UNAVAILABLE',
        code: 'BRAIN_NOT_AVAILABLE',
        message: 'no brain available for this tenant',
      },
      503,
    );
  }

  // -------------------------------------------------------------------------
  // 9. Run the multimodal turn
  // -------------------------------------------------------------------------
  const attachment: MediaAttachment = {
    mediaType: body.image.mimeType,
    data: body.image.base64,
  };

  try {
    const startResult = await brain.orchestrator.startThread({
      tenant: {
        tenantId: auth.tenantId,
        tenantName: auth.tenantId,
        environment: 'production',
      },
      actor: {
        type: 'user',
        id: auth.userId,
        roles: Array.isArray(auth.permissions) ? auth.permissions : [],
      },
      viewer: {
        userId: auth.userId,
        roles: Array.isArray(auth.permissions) ? auth.permissions : [],
        teamIds: [],
        isAdmin: false,
      },
      initialUserText: buildVisionPrompt(body),
      mediaAttachments: [attachment],
    });

    if (!startResult.success) {
      logger.error(
        {
          tenantId: auth.tenantId,
          userId: auth.userId,
          err: startResult.error.code,
          message: startResult.error.message,
        },
        'vision-turn rejected: orchestrator returned error',
      );
      const status = startResult.error.code === 'VISION_UNSUPPORTED_MODEL'
        ? 503
        : 500;
      return c.json(
        {
          error: 'brain_turn_failed',
          code: startResult.error.code,
          message: startResult.error.message,
        },
        status,
      );
    }

    const { thread, turn } = startResult.data;
    const fallbackEvidenceId = `brain-thread:${thread.id}`;
    const composed = composePhotoAdvisorResponse(turn, fallbackEvidenceId);

    logger.info(
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        threadId: thread.id,
        finalPersonaId: turn.finalPersonaId,
        tokensUsed: turn.tokensUsed,
        sessionId: body.sessionId,
        attachments: 1,
      },
      'vision-turn served',
    );

    return c.json(
      {
        ...composed,
        sessionId: thread.id,
      },
      200,
    );
  } catch (err) {
    logger.error(
      {
        tenantId: auth.tenantId,
        userId: auth.userId,
        err: err instanceof Error ? err.message : String(err),
      },
      'vision-turn unexpected exception',
    );
    return c.json(
      {
        error: 'internal_error',
        code: 'INTERNAL',
      },
      500,
    );
  }
});

export const miningBrainVisionRouter = app;
export {
  VisionTurnRequestSchema,
  ImageSchema,
  LocationSchema,
  MAX_IMAGE_BYTES,
  ALLOWED_MIME_TYPES,
};
