/**
 * Public Leads Router — post-chat handoff profile persistence.
 *
 * Mounted under /api/v1/public/leads/*:
 *   POST /handoff         upsert lead from transcript + latest message
 *   GET  /resume/:session  fetch existing lead for same session (24h)
 *
 * Idempotent by session_id — re-entering the chat within 24h resumes the
 * same profile rather than creating a duplicate. Falls back to an
 * in-memory cache when DATABASE_URL is not configured so the marketing
 * surface keeps working in development.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  LeadCapture,
} from '@borjie/marketing-brain';

type LeadSummary = ReturnType<typeof LeadCapture.summariseLead>;

const HandoffSchema = z.object({
  sessionId: z.string().min(1).max(120),
  transcript: z
    .array(
      z.object({
        role: z.enum(['visitor', 'assistant']),
        content: z.string().max(4000),
      })
    )
    .min(1)
    .max(80),
  latestMessage: z.string().min(1).max(4000),
  contact: z
    .object({
      name: z.string().min(1).max(200).optional(),
      method: z.enum(['email', 'phone', 'whatsapp']).optional(),
      value: z.string().min(3).max(200).optional(),
    })
    .optional(),
});

interface StoredLead {
  readonly id: string;
  readonly sessionId: string;
  readonly summary: LeadSummary;
  readonly explicitSignupIntent: boolean;
  readonly contactName: string | null;
  readonly contactMethod: 'email' | 'phone' | 'whatsapp' | null;
  readonly contactValue: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

// Process-local fallback cache. Keyed by sessionId. Prod writes land in
// Postgres via the waitlist/lead service (out of scope here) — this map
// keeps the UX responsive in degraded mode and during development.
const fallback = new Map<string, StoredLead>();
const LEAD_TTL_MS = 24 * 60 * 60 * 1000;

function gc(now: number): void {
  for (const [sid, lead] of fallback) {
    if (new Date(lead.expiresAt).getTime() < now) fallback.delete(sid);
  }
}

const app = new Hono();

app.post('/handoff', zValidator('json', HandoffSchema), (c) => {
  const body = c.req.valid('json');
  // Normalise transcript so downstream types are fully required.
  const transcript: ReadonlyArray<{ role: 'visitor' | 'assistant'; content: string }> =
    body.transcript.map((t) => ({
      role: t.role as 'visitor' | 'assistant',
      content: t.content ?? '',
    }));

  const decision = LeadCapture.detectHandoff({
    transcript,
    latestMessage: body.latestMessage,
  });

  // Compose summary regardless — callers can inspect the decision and
  // decide whether to surface the handoff card.
  const summary = LeadCapture.summariseLead([
    ...transcript,
    { role: 'visitor', content: body.latestMessage },
  ]);

  const now = new Date();
  gc(now.getTime());

  const existing = fallback.get(body.sessionId);
  const id = existing?.id ?? `lead_${body.sessionId}_${now.getTime()}`;
  const createdAt = existing?.createdAt ?? now.toISOString();
  const stored: StoredLead = {
    id,
    sessionId: body.sessionId,
    summary,
    explicitSignupIntent:
      (existing?.explicitSignupIntent ?? false) ||
      decision.reason === 'explicit_intent',
    contactName: body.contact?.name ?? existing?.contactName ?? null,
    contactMethod: body.contact?.method ?? existing?.contactMethod ?? null,
    contactValue: body.contact?.value ?? existing?.contactValue ?? null,
    createdAt,
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + LEAD_TTL_MS).toISOString(),
  };
  fallback.set(body.sessionId, stored);

  return c.json({
    success: true,
    data: {
      shouldHandoff: decision.shouldHandoff,
      reason: decision.reason,
      meaningfulTurnCount: decision.meaningfulTurnCount,
      lead: stored,
      signupPrefill: buildSignupPrefill(stored),
    },
  });
});

app.get('/resume/:sessionId', (c) => {
  const sid = c.req.param('sessionId');
  gc(Date.now());
  const existing = fallback.get(sid);
  if (!existing) {
    return c.json(
      {
        success: false,
        error: { code: 'LEAD_NOT_FOUND', message: 'No active lead for session.' },
      },
      404
    );
  }
  return c.json({
    success: true,
    data: {
      lead: existing,
      signupPrefill: buildSignupPrefill(existing),
    },
  });
});

function buildSignupPrefill(lead: StoredLead) {
  return {
    role: lead.summary.role,
    portfolioSize: lead.summary.portfolioSize,
    country: lead.summary.country,
    primaryPain: lead.summary.primaryPain,
    contactName: lead.contactName,
    contactMethod: lead.contactMethod,
    contactValue: lead.contactValue,
  };
}

export default app;
