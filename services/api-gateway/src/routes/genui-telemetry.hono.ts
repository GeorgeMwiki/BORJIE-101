/**
 * /api/v1/genui-telemetry — the CLIENT-side self-healing beacon.
 *
 * The generative-UI renderer (packages/genui AdaptiveRenderer) degrades to an
 * UnknownKindCard when it meets a kind it has no first-class renderer for, or a
 * payload that fails its schema. That degrade SERVES the customer (open grammar
 * working as designed) — but the occurrence is a real signal the platform must
 * SEE. This endpoint closes that client→server loop: it recognises the blocker
 * via the same MAPE-K loop and reports it to the INTERNAL-ADMIN self-healing
 * console (never the owner) as an auto-healed OBSERVATION — the crystallization-
 * candidate signal ("kind X degraded N times → build a real renderer").
 *
 * It also returns the CUSTOMER-LOOP-CLOSURE contract: the client already
 * rendered the safe fallback, and `canRegenerate` tells it a generative retry
 * (ask Mwikila to produce this another way) is available — so the customer is
 * served in the moment, never with fabricated data.
 *
 * Auth required (any authenticated surface reports). Mounted at
 * `/api/v1/genui-telemetry`.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { attemptHeal, type BlockerSignal } from '@borjie/portal-genui';
import { authMiddleware } from '../middleware/hono-auth';
import { escalateToInternalAdmin } from '../composition/portal-genui/internal-admin-sink';

const app = new Hono();
app.use('*', authMiddleware);

/** Normalise a client-supplied token to a bounded, charset-safe slug. */
function slug(raw: string, max: number): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
}

const beaconSchema = z.object({
  /** The render kind that fell back (free string — open grammar). */
  kind: z.string().min(1).max(200),
  reason: z.enum(['unknown-kind', 'schema-validation-failed']),
  /** Optional human-readable detail from the renderer. */
  message: z.string().max(2000).optional(),
  /** Which surface emitted it (e.g. owner-cockpit, jarvis) — triage only. */
  surface: z.string().max(120).optional(),
});

app.post('/unknown-kind', async (c) => {
  const auth = c.get('auth') as { tenantId?: string } | undefined;
  const raw = await c.req.json().catch(() => ({}));
  const parsed = beaconSchema.safeParse(raw);
  if (!parsed.success) {
    return c.json(
      {
        success: false as const,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid beacon payload',
          issues: parsed.error.issues,
        },
      },
      400,
    );
  }
  const { kind, reason, message, surface } = parsed.data;

  // The kind/surface are CLIENT-supplied and feed the dedupe key, so normalise
  // them to a bounded slug — a malicious client cannot inject arbitrary formats
  // or balloon the queue's distinct-row cardinality with junk strings.
  const safeKind = slug(kind, 64) || 'unknown';
  const safeSurface = surface ? slug(surface, 32) : undefined;

  // 'unknown-kind' → an unseen render kind (open grammar). 'schema-validation-
  // failed' → a known kind whose payload violated its contract (a generation
  // defect). Both are SAFELY auto-degraded by the renderer, so both classify as
  // auto-healed observations — visible to admin, never a flood of approvals.
  const blockerKind =
    reason === 'unknown-kind' ? 'unknown-render-kind' : 'admission-violation';

  const signal: BlockerSignal = {
    kind: blockerKind,
    locus: `genui.kind/${safeKind}${safeSurface ? `@${safeSurface}` : ''}`,
    detail:
      message ?? `client renderer fell back (${reason}) for kind '${safeKind}'`,
    ...(auth?.tenantId ? { tenantId: auth.tenantId } : {}),
  };

  // Recognise → make known → proceed. The report sink logs + persists to the
  // internal-admin console. Total + fire-safe — never throws.
  attemptHeal(signal, { report: escalateToInternalAdmin });

  // Customer-loop closure: the client already served the safe fallback; tell it
  // a generative retry is available so it can offer "get this another way".
  return c.json(
    {
      success: true as const,
      data: {
        recorded: true,
        degraded: true,
        // The customer is never blocked: a generative re-ask is always offered.
        canRegenerate: true,
      },
    },
    200,
  );
});

export const genuiTelemetryRouter = app;
