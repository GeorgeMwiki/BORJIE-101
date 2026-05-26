/**
 * Head Briefing router — Wave 28.
 *
 * Cohesive "first-login head screen" surface. Assembles overnight
 * autonomous activity, pending approvals, escalations, KPI deltas,
 * recommendations, and anomalies into a single curated document.
 *
 * Endpoints (tenant-admin+):
 *   GET /api/v1/head/briefing                  → BriefingDocument JSON
 *   GET /api/v1/head/briefing/markdown         → text/markdown (plain)
 *   GET /api/v1/head/briefing/voice-narration  → text (for downstream TTS)
 *
 * The composer itself lives in `@borjie/ai-copilot/head-briefing`
 * and is wired by the composition root with real source adapters.
 */

import { Hono } from 'hono';
import {
  renderMarkdown,
  narrateForVoice,
  type BriefingComposer,
} from '@borjie/ai-copilot/head-briefing';
import { authMiddleware, requireRole } from '../middleware/hono-auth';
import { UserRole } from '../types/user-role';
import { routeCatch } from '../utils/safe-error';

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.TENANT_ADMIN),
);

function getComposer(c: any): BriefingComposer | null {
  const services = c.get('services') ?? {};
  return services.headBriefing?.composer ?? null;
}

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'HEAD_BRIEFING_UNAVAILABLE',
        message: 'Head briefing composer is not wired on this gateway',
      },
    },
    503,
  );
}

// ---------------------------------------------------------------------------
// GET /   — JSON briefing document
// ---------------------------------------------------------------------------
app.get('/', async (c: any) => {
  const composer = getComposer(c);
  if (!composer) return notConfigured(c);
  const auth = c.get('auth');
  try {
    const doc = await composer.compose(auth.tenantId);
    return c.json({ success: true, data: doc });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'HEAD_BRIEFING_COMPOSE_FAILED',
      status: 500,
      fallback: 'Failed to compose morning briefing',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /markdown  — text/markdown rendering
// ---------------------------------------------------------------------------
app.get('/markdown', async (c: any) => {
  const composer = getComposer(c);
  if (!composer) return notConfigured(c);
  const auth = c.get('auth');
  try {
    const doc = await composer.compose(auth.tenantId);
    const md = renderMarkdown(doc);
    return c.body(md, 200, {
      'Content-Type': 'text/markdown; charset=utf-8',
    });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'HEAD_BRIEFING_MARKDOWN_FAILED',
      status: 500,
      fallback: 'Failed to render briefing markdown',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /voice-narration  — plain-text TTS script
// ---------------------------------------------------------------------------
app.get('/voice-narration', async (c: any) => {
  const composer = getComposer(c);
  if (!composer) return notConfigured(c);
  const auth = c.get('auth');
  try {
    const doc = await composer.compose(auth.tenantId);
    const script = narrateForVoice(doc);
    return c.body(script, 200, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  } catch (err: any) {
    return routeCatch(c, err, {
      code: 'HEAD_BRIEFING_VOICE_FAILED',
      status: 500,
      fallback: 'Failed to render voice narration',
    });
  }
});

export default app;
