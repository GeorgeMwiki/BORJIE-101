/**
 * Public Marketing API — UNAUTHENTICATED routes for Mr. Mwikila's marketing chat.
 *
 *   POST /public/chat            — anonymous conversation turn
 *   POST /public/pricing-advice  — tier recommendation
 *   POST /public/demo-estate     — generate sandbox data for a session
 *   GET  /public/demo-estate/:id — fetch sandbox data by session id
 *   POST /public/waitlist        — forward signup to the waitlist domain
 *
 * These endpoints MUST NEVER read or write to authenticated tenant data.
 * All demo data is stored in a process-local ephemeral Map keyed by
 * session id. Anything that looks like it needs a tenant context is
 * rejected with 400.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  buildMarketingSystemPrompt,
  qualifyLead,
  generateDemoEstate,
  createDemoStore,
  putDemoEstate,
  getDemoEstate,
  adviseTier,
  buildWaitlistSignup,
  DemoEstate,
} from '@borjie/marketing-brain';
import type { StreamTurnEvent } from '@borjie/ai-copilot';

// Singleton ephemeral store — scoped to the process. In production each
// gateway instance keeps its own; a shared Redis cache is a follow-up.
const demoStore = createDemoStore();

const ChatTurnSchema = z.object({
  sessionId: z.string().min(1).max(120),
  message: z.string().min(1).max(4000),
  transcript: z
    .array(
      z.object({
        role: z.enum(['visitor', 'assistant']),
        content: z.string().max(4000),
      })
    )
    .max(40)
    .optional(),
  visitorCountry: z.enum(['KE', 'TZ', 'UG', 'other']).optional(),
});

const DemoEstateSchema = z.object({
  sessionId: z.string().min(1).max(120),
  tenantLabel: z.string().min(1).max(60),
  country: z.enum(['KE', 'TZ', 'UG']),
  portfolioSize: z.enum(['micro', 'small', 'mid', 'large']),
});

const WaitlistSchema = z.object({
  sessionId: z.string().min(1),
  contactName: z.string().min(1).max(200),
  contactMethod: z.enum(['email', 'phone', 'whatsapp']),
  contactValue: z.string().min(3).max(200),
  country: z.enum(['KE', 'TZ', 'UG', 'other']).optional(),
  role: z.enum(['owner', 'tenant', 'manager', 'station_master', 'unknown']).optional(),
  portfolioSize: z.enum(['micro', 'small', 'mid', 'large']).optional(),
  notes: z.string().max(2000).optional(),
});

const PricingSchema = z.object({
  unitCount: z.number().int().nonnegative().optional(),
  portfolioSize: z.enum(['micro', 'small', 'mid', 'large']).optional(),
  role: z.enum(['owner', 'tenant', 'manager', 'station_master', 'unknown']).optional(),
  country: z.enum(['KE', 'TZ', 'UG', 'other']).optional(),
});

const app = new Hono();

app.post('/chat', zValidator('json', ChatTurnSchema), async (c) => {
  const body = c.req.valid('json');
  const visitorText = [
    body.message,
    ...(body.transcript?.filter((t) => t.role === 'visitor').map((t) => t.content) ?? []),
  ].join('\n');
  const lead = qualifyLead(visitorText);
  const countryForPrompt =
    body.visitorCountry && body.visitorCountry !== 'other'
      ? (body.visitorCountry as 'KE' | 'TZ' | 'UG')
      : undefined;
  const systemPrompt = buildMarketingSystemPrompt({
    ...(countryForPrompt ? { visitorCountry: countryForPrompt } : {}),
    visitorRole: lead.role,
  });

  const stubReply = buildStubReply(lead.role, body.message);

  // Content negotiation — if the client asks for text/event-stream we
  // re-frame the stub reply as an SSE stream so the landing page's
  // `useChatStream` hook can render it with the same typing-indicator +
  // AdaptiveRenderer pipeline as the authenticated chat surfaces.
  // JSON clients (curl, API consumers, legacy pages) get the old shape.
  const accept = c.req.header('accept') ?? '';
  if (accept.includes('text/event-stream')) {
    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());

      for await (const evt of marketingChatStream(stubReply, {
        sessionId: body.sessionId,
        personaId: 'public-guide',
        suggestedRoute: lead.route,
        signal: abort.signal,
      })) {
        await stream.writeSSE({ event: evt.type, data: JSON.stringify(evt) });
      }
    });
  }

  return c.json({
    success: true,
    data: {
      sessionId: body.sessionId,
      lead,
      systemPrompt,
      reply: stubReply,
      suggestedRoute: lead.route,
    },
  });
});

/**
 * Stream a public/marketing chat turn as StreamTurnEvent. Mirrors the
 * authenticated streamTurn contract so the chat-ui `useChatStream` hook
 * can consume both surfaces with the same SSE parser.
 */
async function* marketingChatStream(
  reply: string,
  opts: {
    readonly sessionId: string;
    readonly personaId: string;
    readonly suggestedRoute: string;
    readonly signal?: AbortSignal;
  }
): AsyncGenerator<StreamTurnEvent> {
  const { signal } = opts;
  const start = Date.now();
  yield {
    type: 'turn_start',
    threadId: opts.sessionId,
    personaId: opts.personaId,
    createdAt: new Date().toISOString(),
  };
  const size = 24;
  for (let i = 0; i < reply.length; i += size) {
    if (signal?.aborted) break;
    yield { type: 'delta', content: reply.slice(i, i + size) };
    await new Promise<void>((r) => setTimeout(r, 12));
  }
  // Emit the suggested-route as a lightweight handoff event so the UI can
  // render the appropriate CTA card without a separate REST call.
  yield {
    type: 'handoff',
    from: opts.personaId,
    to: opts.suggestedRoute,
    objective: 'suggested next step',
  };
  yield {
    type: 'turn_end',
    threadId: opts.sessionId,
    finalPersonaId: opts.personaId,
    totalTokens: 0,
    totalCost: 0,
    timeMs: Date.now() - start,
    advisorConsulted: false,
  };
}

app.post('/pricing-advice', zValidator('json', PricingSchema), async (c) => {
  const body = c.req.valid('json');
  const advice = adviseTier(body);
  return c.json({ success: true, data: advice });
});

app.post('/demo-estate', zValidator('json', DemoEstateSchema), async (c) => {
  const body = c.req.valid('json');
  const estate: DemoEstate = generateDemoEstate(body);
  putDemoEstate(demoStore, estate);
  return c.json({ success: true, data: estate });
});

app.get('/demo-estate/:id', (c) => {
  const id = c.req.param('id');
  const estate = getDemoEstate(demoStore, id);
  if (!estate) {
    return c.json(
      {
        success: false,
        error: { code: 'DEMO_EXPIRED', message: 'Demo session not found or expired' },
      },
      404
    );
  }
  return c.json({ success: true, data: estate });
});

app.post('/waitlist', zValidator('json', WaitlistSchema), async (c) => {
  const body = c.req.valid('json');
  try {
    const payload = buildWaitlistSignup(body);
    // The actual persistence lives in the authenticated waitlist router.
    // Here we just echo the built payload so the chat UI can show a
    // confirmation and a follow-up POST can commit it once the prospect
    // provides the minimal shopper-user identity they need.
    return c.json({ success: true, data: payload });
  } catch (err) {
    return c.json(
      {
        success: false,
        error: {
          code: 'INVALID_CONTACT',
          message: err instanceof Error ? err.message : 'invalid contact',
        },
      },
      400
    );
  }
});

function buildStubReply(
  role: ReturnType<typeof qualifyLead>['role'],
  message: string
): string {
  const trimmed = message.slice(0, 200);
  if (role === 'unknown') {
    return `Before I dive in: are you an owner, a tenant, a property manager, or a station master? That'll let me point you at the right capability. You said: "${trimmed}".`;
  }
  const greetings: Record<string, string> = {
    owner: `Got it — an owner. Most owners start with rent reminders on autopilot. How many units are you running today?`,
    tenant: `Got it — a tenant. BORJIE gives you one place for rent receipts, maintenance requests, and notices. What is your biggest pain right now?`,
    manager: `Got it — a property manager. Owner reports are the #1 time sink; let me show you how BORJIE drafts them for you.`,
    station_master: `Got it — a station master. You can log incidents by voice in Swahili. Want a 60-second walkthrough?`,
  };
  return greetings[role] ?? `Let me help.`;
}

export default app;
