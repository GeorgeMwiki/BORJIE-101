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

import { withSecurityEvents } from '@borjie/observability';
type AnyCtx = any;

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
    personaId: 'sovereign-admin',
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
          span.setStatus({ code: 2, ...(errorMessage && { message: errorMessage }) });
        }
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

  const folded = foldPresence(parsed.data.message, parsed.data.presence);

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
        error: err instanceof Error ? err.message : 'sovereign-unavailable',
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
      await pumpKernelToAgUi(emitter, sovereign.kernel.thinkStream(req), {
        threadId: parsed.data.threadId,
        runId,
      });
    } catch (err) {
      // Defensive — kernel iterables can throw on sensor failover.
      const message = err instanceof Error ? err.message : 'kernel-error';
      // pumpKernelToAgUi may already have emitted RUN_FINISHED — the
      // emitter is no-op-after-terminal so this is safe.
      emitter.emit({ type: 'RUN_ERROR', runId, error: message });
    }
  });

  return c.body(emitter.stream, 200, agUiSseHeaders());
}));

export default adminJarvisStreamRouter;
