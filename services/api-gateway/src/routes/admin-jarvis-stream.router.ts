/**
 * Admin Jarvis stream router — `POST /api/v1/admin/jarvis/stream`.
 *
 * Replaces the 503 stub at
 * `apps/admin-web/.../intelligence/thread/[id]/message/route.ts`.
 * The Next.js route now proxies here verbatim; this router is the
 * canonical edge for the central-command AG-UI wire.
 *
 * Request:
 *   {
 *     threadId: string,
 *     message: string,
 *     presence?: PresencePacket   // see architecture doc — route, focus,
 *                                  //   selection, lastQuery
 *   }
 *
 * Response:
 *   text/event-stream of AG-UI Protocol events. Pipes the SovereignBrain
 *   `kernel.thinkStream(...)` through the AG-UI emitter so every event
 *   is a strictly-typed AG-UI envelope (RUN_STARTED / TEXT_MESSAGE_* /
 *   TOOL_CALL_* / STATE_DELTA / RUN_FINISHED | RUN_ERROR).
 *
 * Auth: SUPER_ADMIN / ADMIN only (platform-tier — admin-web
 * is BORJIE HQ, not the tenant agency portal). The brand-grade gate
 * is a router-level `requireRole(...)`.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import pino from 'pino';
import {
  createAgUiEmitter,
  pumpKernelToAgUi,
  uuidv7,
  agUiSseHeaders,
  selectPersona,
  personalisePersona,
  type AgUiEvent,
  type AgUiOtelSpanRecorder,
  type ThoughtRequest,
  type ScopeContext,
  type UserProfile,
} from '@borjie/central-intelligence';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { getSovereignBrain } from '../composition/sovereign';
import { trace, type Attributes } from '@opentelemetry/api';
// INPUT CONTAINMENT (CLOSE-G) — the blessed ingress prompt-injection /
// jailbreak guard, applied to the operator's OWN `message` BEFORE it is
// folded into the presence envelope + reaches `kernel.thinkStream`. CRITICAL
// → AG-UI RUN_ERROR (the model never sees it); lower severities → fold +
// run on the detector-redacted text. Fail-OPEN-but-logged inside the guard.
import {
  applyIngressGuard,
  pickIngressGuardLang,
} from '../composition/ingress-guard-apply.js';
// IP-EGRESS (CLOSE-G) — the single STREAMING kernel-event chokepoint. The
// AG-UI pump forwards each `text_delta` as TEXT_MESSAGE_CONTENT verbatim, and
// the kernel yields raw deltas before its own policy redaction. Wrapping the
// kernel stream DROPS model chain-of-thought and runs every prose delta through
// the FAIL-CLOSED egress filter BEFORE it reaches the pump — so the AG-UI wire
// never carries raw model output (the "enforced one layer down" claim was false).
import {
  guardKernelStream,
  buildSelfModelEgressPayload,
} from '../composition/kernel-event-projector.js';

import { withSecurityEvents } from '@borjie/observability';
type AnyCtx = any;

/**
 * Minimal structural view of the emitter we tee the self-model STATE_DELTA
 * through (avoids importing the full AgUiEmitterHandle type for one method).
 */
interface AgUiEmitLike {
  emit(event: { readonly type: string; readonly [k: string]: unknown }): void;
}

/**
 * Honest epistemic-state surface (Win #2 / INV-H) on the AG-UI wire. The
 * `pumpKernelToAgUi` adapter only knows turn_start / text_delta / thought_delta
 * / gate_verdict / confidence / done — it silently ignores the kernel's
 * additive `self_model` frame. This tee sits BETWEEN the egress chokepoint and
 * the pump: when a `self_model` frame passes by it emits an AG-UI `STATE_DELTA`
 * (`/run/selfModel`) — the same mechanism the pump uses for `confidence` — so
 * the AG-UI client can render the posture + sure/unsure/would-need axes. The
 * frame is egress-SAFE by construction (fixed posture enum + constant axis
 * labels, NEVER the audit math), and `buildSelfModelEgressPayload` shape-clamps
 * it. The frame is STILL re-yielded so the pump's own loop is unaffected (it
 * ignores the kind, as before). Pure pass-through for every other frame.
 */
async function* teeSelfModelToAgUi<T extends { readonly kind: string }>(
  source: AsyncIterable<T>,
  emitter: AgUiEmitLike,
): AsyncGenerator<T, void, unknown> {
  for await (const ev of source) {
    if (ev.kind === 'self_model') {
      emitter.emit({
        type: 'STATE_DELTA',
        patch: [
          {
            op: 'replace',
            path: '/run/selfModel',
            value: buildSelfModelEgressPayload(
              ev as unknown as Record<string, unknown>,
            ),
          },
        ],
      });
    }
    yield ev;
  }
}

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  name: 'admin-jarvis-stream',
});

/**
 * IP-EGRESS (CLOSE-G) — the generic, provider-agnostic RUN_ERROR message the
 * client may see. A raw `err.message` from the sovereign composition root or
 * the kernel iterator can leak provider / model / internal-id detail, so we
 * NEVER forward it to the AG-UI wire. The real cause is logged server-side
 * (pino) only; the client renders this fixed banner.
 */
const GENERIC_RUN_ERROR = 'The assistant is temporarily unavailable. Please try again.';

// ─────────────────────────────────────────────────────────────────────
// Presence packet — defined by the AG-UI / Central-Command contract.
// Every field is optional so the wire stays forwards-compatible. The
// kernel does NOT see this as a separate input today; the wrapper
// folds it into the userMessage envelope so even if the kernel layer
// hasn't grown a presence-aware sensor, the audit trail still records
// what the operator was looking at.
// ─────────────────────────────────────────────────────────────────────

const PresenceSchema = z
  .object({
    route: z.string().max(400).optional(),
    focus: z.string().max(400).optional(),
    selection: z.string().max(800).optional(),
    lastQuery: z.string().max(800).optional(),
    /**
     * Free-form bag for forward-compatible signals (e.g. selected row
     * ids, currently-open drawer). Capped so a misbehaving client can't
     * stall the gateway with a megabyte of presence data.
     */
    extra: z.record(z.unknown()).optional(),
  })
  .strict()
  .optional();

const RequestBodySchema = z.object({
  threadId: z.string().min(1).max(120),
  message: z.string().min(1).max(8_000),
  presence: PresenceSchema,
  // Active locale forwarded from the admin client (borjie_locale). Without
  // it the kernel collapses to 'en' and a Swahili operator always gets
  // English replies. Optional for back-compat; the kernel defaults to 'en'.
  language: z.enum(['en', 'sw']).optional(),
});

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function actorProfile(c: AnyCtx): UserProfile {
  const auth = c.get('auth') ?? {};
  return {
    userId: auth.userId ?? auth.sub ?? 'unknown-user',
    displayName: auth.displayName ?? auth.email ?? 'Operator',
    role: (auth.roles && auth.roles[0]) || auth.role || 'admin',
    affiliation: auth.tenantName ?? auth.orgName ?? 'Borjie',
    greetingStyle: 'warm',
  };
}

function platformScope(c: AnyCtx): ScopeContext {
  const auth = c.get('auth') ?? {};
  const userId = auth.userId ?? auth.sub ?? 'unknown-user';
  const roles = Array.isArray(auth.roles)
    ? auth.roles
    : auth.role
      ? [auth.role]
      : [];
  return {
    kind: 'platform',
    actorUserId: userId,
    roles,
    // The industry-observer surface (tier:'industry') must speak in the
    // observer's institutional, cross-tenant-anonymised voice — its taboos
    // (never name a single tenant) belong here, not the sovereign-admin
    // persona this previously mis-selected.
    personaId: 'industry-observer',
  };
}

/**
 * Fold the presence packet into the userMessage envelope. We do NOT
 * inject it into the system prompt directly — the kernel is presence-
 * naive today and would re-wrap whatever we passed. Suffixing the
 * user-message keeps the audit trail honest (the exact text the
 * sensor saw is recorded) without requiring a kernel-side change.
 */
function foldPresence(message: string, presence: unknown): string {
  if (!presence || typeof presence !== 'object') return message;
  const p = presence as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof p.route === 'string') lines.push(`route=${p.route}`);
  if (typeof p.focus === 'string') lines.push(`focus=${p.focus}`);
  if (typeof p.selection === 'string') lines.push(`selection=${p.selection}`);
  if (typeof p.lastQuery === 'string') lines.push(`lastQuery=${p.lastQuery}`);
  if (lines.length === 0) return message;
  return `${message}\n\n[presence]\n${lines.join('\n')}`;
}

/**
 * SSE RESILIENCE (mfr-1) — wrap a kernel-event iterable so it stops yielding
 * once the client disconnects. The AG-UI emitter already no-ops every `emit()`
 * after its abort listener fires (`finalize('client-abort')`), but without this
 * gate `pumpKernelToAgUi` would keep PULLING kernel events (extra kernel work)
 * for a connection no one reads. Checking `signal.aborted` at the top of the
 * loop returns early so the upstream async generator's cleanup runs promptly.
 * (Cancelling upstream provider token generation needs a signal threaded into
 * the sensor's `client.messages.stream(...)` call — a larger enhancement; see
 * needsAttention.)
 */
async function* stopOnAbort<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal | null,
): AsyncGenerator<T, void, unknown> {
  for await (const ev of source) {
    if (signal?.aborted) return;
    yield ev;
  }
}

/**
 * Bridge OTel — the central-intelligence emitter port is duck-typed
 * `recordSpan({ name, attributes, durationMs, status })`. Wrap the
 * gateway's OTel tracer behind that shape so the kernel package stays
 * dep-free.
 */
function buildOtelRecorder(): AgUiOtelSpanRecorder | null {
  try {
    const tracer = trace.getTracer('borjie.api-gateway.ag-ui');
    if (!tracer) return null;
    return {
      recordSpan({ name, attributes, durationMs, status, errorMessage }) {
        const span = tracer.startSpan(name, { attributes: attributes as Attributes });
        // Synthetic duration via the OTel API requires startTime — we
        // don't have it, so the span gets a near-zero duration but the
        // attributes + status are preserved for downstream filtering.
        if (status === 'error') {
          const statusBody: { code: 2; message?: string } = { code: 2 };
          if (errorMessage) statusBody.message = errorMessage;
          span.setStatus(statusBody);        }
        span.setAttribute('ag_ui.duration_ms', durationMs);
        span.end();
      },
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Router
// ─────────────────────────────────────────────────────────────────────

export const adminJarvisStreamRouter = new Hono();
adminJarvisStreamRouter.use('*', authMiddleware);
adminJarvisStreamRouter.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));

adminJarvisStreamRouter.post('/', withSecurityEvents({ action: 'admin.create', resource: 'admin', severity: 'warn' }, async (c: AnyCtx) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        success: false,
        error: { code: 'BAD_REQUEST', message: 'JSON body required' },
      },
      400,
    );
  }
  const parsed = RequestBodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.error.message },
      },
      400,
    );
  }

  const otel = buildOtelRecorder();
  const emitter = createAgUiEmitter({ otel });
  const runId = uuidv7();

  const profile = actorProfile(c);
  const scope = platformScope(c);
  const auth = c.get('auth') ?? {};

  // Attach the upstream abort signal so the heartbeat + iterator stop
  // when the operator closes the tab.
  const abort = (c.req.raw && c.req.raw.signal) || null;
  if (abort) emitter.attachAbortSignal(abort);

  // INPUT CONTAINMENT (CLOSE-G) — guard the FULLY-FOLDED string as ONE unit so
  // the presence fields (route / focus / selection / lastQuery) cannot smuggle
  // a prompt-injection / jailbreak past the guard by hiding outside `message`.
  // We fold FIRST, then run the blessed guard over the whole envelope. CRITICAL
  // → an AG-UI RUN_ERROR (the model never sees it); lower severities → hand the
  // detector-redacted folded text to `kernel.thinkStream`. Fail-OPEN.
  const foldedRaw = foldPresence(parsed.data.message, parsed.data.presence);
  const ingress = await applyIngressGuard({
    userText: foldedRaw,
    tenantId: '',
    userId: auth.userId ?? auth.sub ?? null,
    lang: pickIngressGuardLang(c.req.header('accept-language') ?? null),
  });
  if (ingress.refused) {
    queueMicrotask(() => {
      emitter.emit({
        type: 'RUN_STARTED',
        threadId: parsed.data.threadId,
        runId,
        timestamp: Date.now(),
      });
      emitter.emit({
        type: 'RUN_ERROR',
        runId,
        error: ingress.refusalMessage,
      });
    });
    return c.body(emitter.stream, 200, agUiSseHeaders());
  }

  const folded = ingress.text;

  // The kernel may be unwired (no Anthropic key) — surface a clean
  // RUN_ERROR rather than a generic 503 so the client renders the
  // offline banner against the AG-UI contract.
  let sovereign;
  try {
    sovereign = await getSovereignBrain({
      tenantId: null,
      userId: auth.userId ?? auth.sub ?? null,
      role: 'sovereign',
    });
  } catch (err) {
    // IP-EGRESS (CLOSE-G) — log the raw cause server-side (pino) only; the
    // client RUN_ERROR carries the GENERIC banner so a provider / model /
    // internal-id detail never reaches the AG-UI wire.
    logger.error(
      {
        wiring: 'admin-jarvis-stream',
        threadId: parsed.data.threadId,
        err: err instanceof Error ? err.message : String(err),
      },
      'admin-jarvis-stream: sovereign brain unavailable',
    );
    // Without a brain we still respect AG-UI framing — open the run,
    // emit a RUN_ERROR, and let the client downgrade.
    queueMicrotask(() => {
      emitter.emit({
        type: 'RUN_STARTED',
        threadId: parsed.data.threadId,
        runId,
        timestamp: Date.now(),
      });
      emitter.emit({
        type: 'RUN_ERROR',
        runId,
        error: GENERIC_RUN_ERROR,
      });
    });
    return c.body(emitter.stream, 200, agUiSseHeaders());
  }

  const req: ThoughtRequest = {
    threadId: parsed.data.threadId,
    userMessage: folded,
    scope,
    tier: 'industry',
    stakes: 'medium',
    surface: 'platform-hq',
    // Pin the reply to the operator's active locale (no English-only default).
    ...(parsed.data.language ? { language: parsed.data.language } : {}),
  };

  // Personalise persona so the run's first TEXT_MESSAGE_CONTENT can
  // optionally lead with the operator's name; today this only flows
  // into the kernel for grounding, not the AG-UI wire envelope.
  const basePersona = selectPersona(req);
  personalisePersona(basePersona, profile);

  // Spawn the kernel turn asynchronously — we want to return the
  // ReadableStream immediately so Next.js / Hono pipe the headers and
  // the SSE handshake comment before the model warms up.
  queueMicrotask(async () => {
    try {
      // IP-EGRESS (CLOSE-G) — pipe the kernel stream through the egress
      // chokepoint BEFORE the AG-UI pump: CoT (thought_delta) is dropped and
      // every prose `text_delta` is fail-closed egress-filtered. Platform scope
      // has no tenant id (''), so the cross-tenant strip is inert while the
      // prose / CoT / persona / secret / JWT strips still apply.
      await pumpKernelToAgUi(
        emitter,
        // SSE RESILIENCE (mfr-1) — stop pulling kernel events once the operator
        // closes the tab (the same `abort` signal already attached to the
        // emitter), so the kernel iterator unwinds instead of running on for a
        // dead connection.
        stopOnAbort(
          // Honest epistemic-state surface (Win #2 / INV-H): tee the kernel's
          // additive `self_model` frame out as an AG-UI STATE_DELTA before the
          // pump (which doesn't know that kind) drops it. Egress-SAFE — posture
          // + constant axis labels only, never the audit math.
          teeSelfModelToAgUi(
            // mfr-1 — thread the disconnect signal into the kernel so upstream
            // provider token generation can cancel, not just stop being pulled
            // by `stopOnAbort`. The `stopOnAbort` gate (and the emitter's own
            // abort listener) remain the guaranteed gateway-side floor; this is
            // the upstream-cancellation enhancement. See needsAttention for the
            // kernel signature that must accept + forward it to the provider
            // stream call.
            guardKernelStream(
              sovereign.kernel.thinkStream(req, { signal: abort ?? undefined }),
              '',
            ),
            emitter,
          ),
          abort,
        ),
        {
          threadId: parsed.data.threadId,
          runId,
        },
      );
    } catch (err) {
      // Defensive — kernel iterables can throw on sensor failover. IP-EGRESS
      // (CLOSE-G): log the raw cause server-side (pino) only; the client
      // RUN_ERROR carries the GENERIC banner (a kernel/sensor error string can
      // leak provider / model / internal-id detail).
      logger.error(
        {
          wiring: 'admin-jarvis-stream',
          threadId: parsed.data.threadId,
          runId,
          err: err instanceof Error ? err.message : String(err),
        },
        'admin-jarvis-stream: kernel stream threw',
      );
      // pumpKernelToAgUi may already have emitted RUN_FINISHED — the
      // emitter is no-op-after-terminal so this is safe.
      emitter.emit({ type: 'RUN_ERROR', runId, error: GENERIC_RUN_ERROR });
    }
  });

  return c.body(emitter.stream, 200, agUiSseHeaders());
}));

export default adminJarvisStreamRouter;
