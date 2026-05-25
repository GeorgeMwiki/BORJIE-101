/**
 * Spotlight Engine — global command-palette search + ranking.
 *
 * Combines three signals:
 *  1. Action catalog hits (from ACTION_CATALOG).
 *  2. Entity matches (from an optional entity resolver callback).
 *  3. Persona handoff suggestions (when the query is a natural question).
 *
 * Pure. Framework-agnostic. No React imports here — the React component
 * lives in Spotlight.tsx and consumes these functions.
 */

import { z } from 'zod';
import {
  ACTION_CATALOG,
  CatalogAction,
  findActionById,
} from './action-catalog.js';
import { resolveEntities, EntityMatch } from './entity-resolver.js';

export const SpotlightQuerySchema = z.object({
  query: z.string().max(200),
  userRoles: z.array(z.string()).default([]),
  tenantId: z.string().optional(),
});
export type SpotlightQuery = z.infer<typeof SpotlightQuerySchema>;

export const SpotlightResultKindSchema = z.enum([
  'action',
  'entity',
  'persona_handoff',
  'empty',
]);

export interface SpotlightResult {
  readonly kind: z.infer<typeof SpotlightResultKindSchema>;
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly score: number;
  readonly action?: CatalogAction;
  readonly entity?: EntityMatch;
}

export interface EntityIndex {
  readonly units: ReadonlyArray<{ id: string; label: string; propertyName?: string }>;
  readonly properties: ReadonlyArray<{ id: string; name: string }>;
  readonly tenants: ReadonlyArray<{ id: string; name: string }>;
}

const EMPTY_INDEX: EntityIndex = { units: [], properties: [], tenants: [] };

/**
 * Run a palette search. Returns results ranked by composite score.
 */
export function searchSpotlight(
  input: SpotlightQuery,
  entities: EntityIndex = EMPTY_INDEX
): readonly SpotlightResult[] {
  const parsed = SpotlightQuerySchema.parse(input);
  const q = parsed.query.trim().toLowerCase();

  if (!q) {
    return ACTION_CATALOG.filter((a) => canExecute(a, parsed.userRoles))
      .slice(0, 8)
      .map((a) => toActionResult(a, 0.5));
  }

  const actionResults: SpotlightResult[] = [];
  for (const a of ACTION_CATALOG) {
    if (!canExecute(a, parsed.userRoles)) continue;
    const score = scoreAction(a, q);
    if (score > 0) actionResults.push(toActionResult(a, score));
  }

  const entityResults: SpotlightResult[] = resolveEntities(q, entities).map(
    (m) => ({
      kind: 'entity' as const,
      id: `entity:${m.kind}:${m.id}`,
      title: m.label,
      subtitle: `${m.kind}${m.context ? ` — ${m.context}` : ''}`,
      score: m.score,
      entity: m,
    })
  );

  const combined = [...actionResults, ...entityResults].sort(
    (a, b) => b.score - a.score
  );

  if (combined.length === 0) {
    return [
      {
        kind: 'persona_handoff',
        id: 'persona:any',
        title: `Ask Mr. Mwikila: "${parsed.query}"`,
        subtitle: 'Hand off to the persona registry',
        score: 0.1,
      },
    ];
  }

  return combined.slice(0, 15);
}

/**
 * Execute an action by id. Returns a descriptor the caller routes on.
 * Permission enforcement is DOUBLE-CHECKED here so downstream callers
 * cannot bypass the catalog's `requires` field.
 */
export function executeAction(
  actionId: string,
  userRoles: readonly string[]
): { ok: true; action: CatalogAction } | { ok: false; error: string } {
  const action = findActionById(actionId);
  if (!action) return { ok: false, error: `unknown action: ${actionId}` };
  if (!canExecute(action, userRoles))
    return {
      ok: false,
      error: `role(s) ${userRoles.join(',') || '(none)'} cannot execute ${actionId}`,
    };
  return { ok: true, action };
}

function canExecute(action: CatalogAction, userRoles: readonly string[]): boolean {
  if (action.requires.length === 0) return true;
  return action.requires.some((r) => userRoles.includes(r));
}

function scoreAction(action: CatalogAction, query: string): number {
  const haystack = [
    action.title,
    action.description,
    action.id,
    ...action.keywords,
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;
  const terms = query.split(/\s+/).filter(Boolean);
  for (const term of terms) {
    if (haystack.includes(term)) score += 1;
    if (action.title.toLowerCase().startsWith(term)) score += 0.5;
    if (action.id.toLowerCase().endsWith(term)) score += 0.3;
  }
  if (terms.length > 0) score /= terms.length;
  return Math.min(1, score);
}

function toActionResult(action: CatalogAction, score: number): SpotlightResult {
  return {
    kind: 'action',
    id: `action:${action.id}`,
    title: action.title,
    subtitle: action.description,
    score,
    action,
  };
}
