/**
 * Sentry webhook router (Wave PILOT-TRIAGE).
 *
 * `POST /api/v1/webhooks/sentry` accepts a signed Sentry "issue
 * alert" payload, normalises it into a `SentryEventInput`, and
 * forwards it to the bridge to materialise a GitHub Issue.
 *
 * Why a webhook (in addition to the polling path)?
 *   - Polling has a 5-minute floor; the pilot SLA wants
 *     error-to-Issue under 5 minutes including manual triage time.
 *   - Push reduces the worker's idle Sentry API budget consumption.
 *   - The polling path remains the fallback when Sentry can't reach
 *     the gateway (e.g. NAT egress glitch during a pilot day).
 *
 * Operational contract:
 *   - 200 OK with `{ status: 'created' | 'duplicate' | 'skipped' }`.
 *   - 401 when `Sentry-Hook-Signature` is missing / wrong.
 *   - 400 when the payload is not valid JSON or violates the schema.
 *   - 503 when the bridge is not wired (composition root did not bind
 *     `sentryToGithubBridge`).
 *
 * Signature verification: Sentry signs the body with HMAC-SHA256
 * using the integration's client secret. The header is
 * `Sentry-Hook-Signature: <hex>` and the signing input is the raw
 * request body. We use `timingSafeEqual` to avoid leaking on
 * comparison time.
 *
 * Idempotency: short-circuits on `event.fingerprint` via an
 * in-memory cache (5-minute TTL) so a Sentry retry burst doesn't
 * hammer the bridge. The bridge ALSO has its own DB-backed
 * idempotency (`pilot_issue_links.sentry_fingerprint`), so this
 * cache is the cheap first line.
 */

import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Bridge port — composition root binds the concrete implementation
// ---------------------------------------------------------------------------

export type SentryBridgeStatus = 'created' | 'duplicate' | 'skipped';

export interface SentryStackFramePayload {
  readonly filename?: string | undefined;
  readonly function?: string | undefined;
  readonly lineno?: number | undefined;
}

export interface SentryBridgeInput {
  readonly fingerprint: string;
  readonly issueId: string;
  readonly orgSlug: string;
  readonly projectSlug: string;
  readonly level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  readonly errorType: string;
  readonly errorValue: string;
  readonly tags: Readonly<Record<string, string>>;
  readonly stackFrames: ReadonlyArray<SentryStackFramePayload>;
  readonly userIdHash?: string | undefined;
  readonly screenId?: string | undefined;
  readonly sessionContext?: Readonly<Record<string, unknown>> | undefined;
}

export interface SentryBridgePort {
  /** Invoked once per validated webhook payload. Adapter wraps the
   *  worker's `bridgeSentryIssueToGitHub`. */
  handle(input: SentryBridgeInput): Promise<{
    readonly status: SentryBridgeStatus;
    readonly githubIssueUrl?: string;
    readonly reason?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Payload validation
// ---------------------------------------------------------------------------

/**
 * Subset of the Sentry "issue alert" payload we care about. Sentry's
 * envelope is large; we only extract what's needed to file a clean
 * GitHub issue. Anything missing → 400 with a precise error code.
 */
const sentryStackFrameSchema = z.object({
  filename: z.string().optional(),
  function: z.string().optional(),
  lineno: z.number().int().optional(),
});

const sentryEventSchema = z.object({
  event: z.object({
    event_id: z.string().min(1),
    level: z.enum(['fatal', 'error', 'warning', 'info', 'debug']),
    type: z.string().min(1),
    value: z.string().default(''),
    tags: z.array(z.tuple([z.string(), z.string()])).default([]),
    exception: z
      .object({
        values: z
          .array(
            z.object({
              type: z.string().optional(),
              value: z.string().optional(),
              stacktrace: z
                .object({
                  frames: z.array(sentryStackFrameSchema).default([]),
                })
                .optional(),
            }),
          )
          .default([]),
      })
      .optional(),
    contexts: z.record(z.string(), z.unknown()).optional(),
    user: z
      .object({
        id_hash: z.string().optional(),
      })
      .optional(),
  }),
  issue: z.object({
    id: z.union([z.string(), z.number()]).transform((v) => String(v)),
    fingerprint: z
      .union([z.array(z.string()).nonempty(), z.string().min(1)])
      .transform((v) => (Array.isArray(v) ? v.join(':') : v)),
  }),
  organization: z.object({ slug: z.string().min(1) }),
  project: z.object({ slug: z.string().min(1) }).optional(),
});

export type SentryWebhookPayload = z.infer<typeof sentryEventSchema>;

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

export function verifySentrySignature(
  rawBody: string,
  signatureHeader: string | undefined,
): { readonly ok: boolean; readonly reason?: string } {
  const secret = process.env.SENTRY_WEBHOOK_SECRET?.trim();
  if (secret === undefined || secret.length === 0) {
    return { ok: false, reason: 'missing-signing-secret' };
  }
  if (signatureHeader === undefined || signatureHeader.length === 0) {
    return { ok: false, reason: 'missing-signature' };
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  if (expected.length !== signatureHeader.length) {
    return { ok: false, reason: 'bad-signature' };
  }
  try {
    const eq = timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(signatureHeader, 'hex'),
    );
    return eq ? { ok: true } : { ok: false, reason: 'bad-signature' };
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }
}

// ---------------------------------------------------------------------------
// In-memory short-window idempotency cache
// ---------------------------------------------------------------------------

const IDEMPOTENCY_TTL_MS = 5 * 60_000;
const seenFingerprints = new Map<string, number>();

function isRecentDuplicate(
  fingerprint: string,
  now: number = Date.now(),
): boolean {
  for (const [k, ts] of seenFingerprints.entries()) {
    if (ts < now - IDEMPOTENCY_TTL_MS) seenFingerprints.delete(k);
  }
  if (seenFingerprints.has(fingerprint)) return true;
  seenFingerprints.set(fingerprint, now);
  return false;
}

// ---------------------------------------------------------------------------
// Pure normaliser — webhook payload → bridge input
// ---------------------------------------------------------------------------

export function normaliseSentryPayload(
  payload: SentryWebhookPayload,
): SentryBridgeInput {
  const tagsObj = Object.freeze(
    Object.fromEntries(payload.event.tags) as Record<string, string>,
  );

  const firstException = payload.event.exception?.values?.[0];
  const errorType = firstException?.type ?? payload.event.type;
  const errorValue = firstException?.value ?? payload.event.value;
  const stackFrames = firstException?.stacktrace?.frames ?? [];

  const screenId = tagsObj.screen_id;
  const userIdHash = payload.event.user?.id_hash;

  return Object.freeze({
    fingerprint: payload.issue.fingerprint,
    issueId: payload.issue.id,
    orgSlug: payload.organization.slug,
    projectSlug: payload.project?.slug ?? 'unknown',
    level: payload.event.level,
    errorType,
    errorValue,
    tags: tagsObj,
    stackFrames,
    ...(userIdHash !== undefined ? { userIdHash } : {}),
    ...(screenId !== undefined ? { screenId } : {}),
    ...(payload.event.contexts !== undefined
      ? { sessionContext: Object.freeze(payload.event.contexts) }
      : {}),
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const app = new Hono();

app.post('/', async (c) => {
  const rawBody = await c.req.raw.text();
  const sigHeader =
    c.req.header('sentry-hook-signature') ?? c.req.header('Sentry-Hook-Signature');
  const verdict = verifySentrySignature(rawBody, sigHeader);
  if (!verdict.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SENTRY_SIGNATURE_INVALID',
          message: verdict.reason ?? 'signature verification failed',
        },
      },
      401,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return c.json(
      {
        success: false,
        error: { code: 'SENTRY_BODY_INVALID', message: 'body is not valid JSON' },
      },
      400,
    );
  }

  const validated = sentryEventSchema.safeParse(parsed);
  if (!validated.success) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SENTRY_BODY_INVALID',
          message: 'payload does not match Sentry issue alert schema',
          issues: validated.error.issues.slice(0, 5),
        },
      },
      400,
    );
  }

  const normalised = normaliseSentryPayload(validated.data);

  if (isRecentDuplicate(normalised.fingerprint)) {
    return c.json(
      {
        success: true,
        data: { status: 'duplicate', fingerprint: normalised.fingerprint },
      },
      200,
    );
  }

  const services = (c.get('services') ?? {}) as Record<string, unknown>;
  const bridge = services.sentryToGithubBridge as SentryBridgePort | undefined;
  if (bridge === undefined) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SENTRY_BRIDGE_UNAVAILABLE',
          message:
            'sentry-to-github bridge not wired — composition root did not bind sentryToGithubBridge',
        },
      },
      503,
    );
  }

  try {
    const result = await bridge.handle(normalised);
    return c.json({ success: true, data: result }, 200);
  } catch (err) {
    return c.json(
      {
        success: false,
        error: {
          code: 'SENTRY_BRIDGE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      500,
    );
  }
});

export const __internal = Object.freeze({
  verifySentrySignature,
  isRecentDuplicate,
  normaliseSentryPayload,
  _resetIdempotency: () => seenFingerprints.clear(),
});

export const sentryWebhookRouter = app;
export default app;
