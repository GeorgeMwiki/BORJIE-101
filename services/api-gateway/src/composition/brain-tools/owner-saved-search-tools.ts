/**
 * Owner saved-search brain tools — Roadmap R2.
 *
 * Surfaces the saved-search create flow into the persona-aware brain
 * tool catalog so the owner can say "alert me when fresh gold listings
 * over 22k land in Geita" and the brain materialises the saved search
 * server-side. The CRUD HTTP endpoints
 * (/api/v1/owner/saved-searches) remain the canonical surface — the
 * brain tool just defers to them via the injected HTTP client so the
 * explicit-tab + chat surfaces hit the same backend.
 *
 * Tier discipline: `owner.saved_search.create` is a WRITE but LOW
 * stakes — it only creates an alert subscription, never touches money
 * or production. `requiresPolicyRuleLiteral` stays false because saved
 * searches have no kill-switch / sovereign overrides.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';

const OWNER: ReadonlyArray<'T1_owner_strategist'> = ['T1_owner_strategist'];

const FREQUENCIES = ['hourly', 'daily', 'weekly'] as const;
const SOURCES = ['marketplace', 'opportunities', 'regulatory'] as const;

const SavedSearchCreateInput = z.object({
  label: z.string().min(1).max(120),
  queryJson: z.record(z.unknown()).default({}),
  frequency: z.enum(FREQUENCIES).default('daily'),
  source: z.enum(SOURCES).default('marketplace'),
});

const SavedSearchCreateOutput = z.object({
  id: z.string(),
  label: z.string(),
  frequency: z.enum(FREQUENCIES),
  source: z.enum(SOURCES),
  createdAt: z.string(),
});

export const ownerSavedSearchCreateTool: PersonaToolDescriptor<
  typeof SavedSearchCreateInput,
  typeof SavedSearchCreateOutput
> = {
  id: 'owner.saved_search.create',
  name: 'Owner — create saved search',
  description:
    'Create a saved-search alert rule. The worker re-runs the query on the chosen cadence and pings the owner when new matches land. Use when the owner asks "alert me when X" or "notify me if Y changes".',
  personaSlugs: OWNER,
  inputSchema: SavedSearchCreateInput,
  outputSchema: SavedSearchCreateOutput,
  stakes: 'LOW',
  isWrite: true,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        id: 'unavailable',
        label: input.label,
        frequency: input.frequency,
        source: input.source,
        createdAt: new Date().toISOString(),
      };
    }
    const created = await client.post<{
      data: {
        id: string;
        label: string;
        frequency: (typeof FREQUENCIES)[number];
        source: (typeof SOURCES)[number];
        createdAt: string;
      };
    }>('/owner/saved-searches', {
      label: input.label,
      queryJson: input.queryJson,
      frequency: input.frequency,
      source: input.source,
    });
    return {
      id: created.data.id,
      label: created.data.label,
      frequency: created.data.frequency,
      source: created.data.source,
      createdAt: created.data.createdAt,
    };
  },
};

export const OWNER_SAVED_SEARCH_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([ownerSavedSearchCreateTool]);
