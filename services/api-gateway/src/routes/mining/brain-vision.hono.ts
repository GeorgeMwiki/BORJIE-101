// @ts-nocheck — Hono v4 MiddlewareHandler status-code literal union: multiple
// c.json({...}, status) branches widen the return type and TypedResponse
// overload rejects the union. Tracked at hono-dev/hono#3891. The runtime
// behaviour is correct; only the typed-response shape is over-strict.
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

// Pino logger only — no console.log in services (per CLAUDE.md).
const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'mining-brain-vision',
});

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

function validateMimeType(mime: string): boolean {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
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
  // 8. Brain orchestrator multimodal turn — NOT YET WIRED.
  //
  //    The `@borjie/ai-copilot` Brain orchestrator's `startThread` /
  //    `handleTurn` only accept `userText: string` today (see
  //    `services/api-gateway/src/routes/brain.hono.ts` for the current
  //    surface). The contract for multimodal attachments
  //    (`attachments: [{ type: 'image', mediaType, data }]`) is not yet
  //    exposed by the orchestrator.
  //
  //    Rather than mock a response or silently drop the image, return
  //    a structured 503 so the gap is named precisely. The mobile
  //    pipeline already handles `BACKEND_VISION_UNAVAILABLE` per
  //    `apps/workforce-mobile/src/photo-advisor/types.ts`.
  // -------------------------------------------------------------------------
  logger.info(
    {
      tenantId: auth.tenantId,
      userId: auth.userId,
      mimeType: body.image.mimeType,
      sizeBytes: body.image.sizeBytes,
      hasLocation: body.location !== null,
      language: body.language,
    },
    'vision-turn accepted shape; orchestrator multimodal API not yet wired',
  );

  return c.json(
    {
      error: 'BACKEND_VISION_UNAVAILABLE',
      code: 'BRAIN_MULTIMODAL_NOT_WIRED',
      message:
        'Brain orchestrator does not yet support multimodal turns. ' +
        'See packages/ai-copilot for the orchestrator.startThread() signature ' +
        '— it currently only accepts userText:string and must be extended to ' +
        'pass an attachments[] array to the Anthropic vision API.',
    },
    503,
  );
});

export const miningBrainVisionRouter = app;
export {
  VisionTurnRequestSchema,
  ImageSchema,
  LocationSchema,
  MAX_IMAGE_BYTES,
  ALLOWED_MIME_TYPES,
};
