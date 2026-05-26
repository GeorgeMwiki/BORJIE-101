/**
 * Public Sandbox API — UNAUTHENTICATED routes for Mr. Mwikila's sandbox demo.
 *
 * Mounted under /api/v1/public/sandbox/*:
 *   POST   /estate           create/refresh sandbox estate
 *   GET    /estate/:id       fetch sandbox estate
 *   GET    /estate/:id/arrears     list arrears cases
 *   GET    /estate/:id/maintenance list maintenance tickets
 *   GET    /estate/:id/renewals    list renewals
 *   GET    /estate/:id/compliance  list compliance notices
 *   GET    /scenarios        list scenario catalog
 *   POST   /scenarios/run    run a named scenario
 *   DELETE /estate/:id       drop sandbox
 *
 * Isolation: the router reads exclusively from the in-memory
 * SandboxStore keyed by ephemeral `mk_*` session ids. There is no code
 * path from this router to the authenticated tenant DB.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import {
  Sandbox,
} from '@borjie/marketing-brain';

import { withSecurityEvents } from '@borjie/observability';
const ScenarioRunSchema = z.object({
  sessionId: z.string().min(1).max(120),
  scenarioId: z.enum([
    'arrears_triage_u7',
    'owner_report_draft',
    'route_leaking_roof',
    'renewal_proposal_u12',
    'mpesa_reconcile',
  ]),
});

const GenerateSchema = z.object({
  sessionId: z.string().min(1).max(120),
  // UNIV-4: hardcoded launch-beachhead default + EA country whitelist — defer to jurisdiction-profile registry; tracked gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
  country: z.enum(['KE', 'TZ', 'UG']).default('TZ'),
});

// Singleton ephemeral store (process-local). Opportunistic GC on mutation.
const store = Sandbox.createSandboxStore();

const app = new Hono();

app.post('/estate', zValidator('json', GenerateSchema), withSecurityEvents({ action: 'public-sandbox.create', resource: 'public-sandbox', severity: 'info' }, (c) => {
  const body = c.req.valid('json');
  const estate = Sandbox.generateSandboxEstate({
    sessionId: body.sessionId,
    country: body.country,
  });
  Sandbox.putSandbox(store, estate);
  Sandbox.gcSandboxes(store);
  return c.json({ success: true, data: estate });
}));

app.get('/estate/:id', (c) => {
  const estate = Sandbox.getSandbox(store, c.req.param('id'));
  if (!estate) return c.json(notFoundBody(), 404);
  return c.json({ success: true, data: estate });
});

app.get('/estate/:id/arrears', (c) => {
  const estate = Sandbox.getSandbox(store, c.req.param('id'));
  if (!estate) return c.json(notFoundBody(), 404);
  return c.json({ success: true, data: estate.arrears });
});

app.get('/estate/:id/maintenance', (c) => {
  const estate = Sandbox.getSandbox(store, c.req.param('id'));
  if (!estate) return c.json(notFoundBody(), 404);
  return c.json({ success: true, data: estate.maintenance });
});

app.get('/estate/:id/renewals', (c) => {
  const estate = Sandbox.getSandbox(store, c.req.param('id'));
  if (!estate) return c.json(notFoundBody(), 404);
  return c.json({ success: true, data: estate.renewals });
});

app.get('/estate/:id/compliance', (c) => {
  const estate = Sandbox.getSandbox(store, c.req.param('id'));
  if (!estate) return c.json(notFoundBody(), 404);
  return c.json({ success: true, data: estate.compliance });
});

app.get('/scenarios', (c) => {
  return c.json({ success: true, data: Sandbox.SCENARIO_CATALOG });
});

app.post('/scenarios/run', zValidator('json', ScenarioRunSchema), withSecurityEvents({ action: 'public-sandbox.create', resource: 'public-sandbox', severity: 'info' }, (c) => {
  const body = c.req.valid('json');
  const estate = Sandbox.getSandbox(store, body.sessionId);
  if (!estate) return c.json(notFoundBody(), 404);
  const run = Sandbox.runScenario(body.scenarioId, estate);
  return c.json({ success: true, data: run });
}));

app.delete('/estate/:id', withSecurityEvents({ action: 'public-sandbox.delete', resource: 'public-sandbox', severity: 'notice' }, (c) => {
  const ok = Sandbox.deleteSandbox(store, c.req.param('id'));
  return c.json({ success: ok });
}));

function notFoundBody() {
  return {
    success: false,
    error: {
      code: 'SANDBOX_NOT_FOUND',
      message: 'Sandbox session not found or expired. Create a new one.',
    },
  };
}

export default app;
