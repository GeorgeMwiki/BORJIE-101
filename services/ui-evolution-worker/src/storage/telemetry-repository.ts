/**
 * Telemetry repository — read-only on `ui_telemetry_events`.
 *
 * The aggregator pulls events in a range query per (tab_recipe_id,
 * tab_recipe_version). The aggregator is window-aware: it asks for a
 * 14-day slice and a 60-day slice.
 *
 * The repository does NOT scrub `payload` — that's already done at
 * write time by the genui bus (see ANTICIPATORY_UX_SPEC.md §7-7). It
 * also does NOT filter by tenant: tenant scope is enforced by the
 * Postgres RLS policy `tenant_isolation` on the table (the worker's
 * service role bypasses RLS but is expected to set
 * `app.tenant_id` when reading on behalf of a tenant — see migration
 * 0017 §5). Cross-tenant aggregation is unsupported by design.
 */

import type { EventKind, TelemetryEvent } from '../types.js';
import type { RecipeDb } from './recipe-repository.js';

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export interface TelemetryRepository {
  readEventsForRecipe(args: {
    readonly tabRecipeId: string;
    readonly tabRecipeVersion: number;
    readonly sinceIso: string;
    readonly untilIso: string;
  }): Promise<ReadonlyArray<TelemetryEvent>>;
}

const VALID_EVENT_KINDS: ReadonlySet<EventKind> = new Set<EventKind>([
  'focus',
  'blur',
  'change',
  'error',
  'tooltip_hit',
  'abandon',
  'submit',
  'render',
  'dismiss',
]);

export function createTelemetryRepository(db: RecipeDb): TelemetryRepository {
  return {
    async readEventsForRecipe({
      tabRecipeId,
      tabRecipeVersion,
      sinceIso,
      untilIso,
    }) {
      const rows = await db.query<Record<string, unknown>>(
        `SELECT id, tenant_id, tab_recipe_id, tab_recipe_version,
                session_id, field_id, event_kind, recorded_at
           FROM ui_telemetry_events
          WHERE tab_recipe_id = $1
            AND tab_recipe_version = $2
            AND recorded_at >= $3::timestamptz
            AND recorded_at < $4::timestamptz`,
        [tabRecipeId, tabRecipeVersion, sinceIso, untilIso],
      );
      const out: TelemetryEvent[] = [];
      for (const row of rows) {
        const event = parseRow(row);
        if (event) out.push(event);
      }
      return out;
    },
  };
}

function parseRow(row: Record<string, unknown>): TelemetryEvent | null {
  const id = row['id'];
  const tenantId = row['tenant_id'];
  const tabRecipeId = row['tab_recipe_id'];
  const tabRecipeVersion = row['tab_recipe_version'];
  const eventKind = row['event_kind'];
  const recordedAt = row['recorded_at'];

  if (typeof id !== 'string') return null;
  if (typeof tenantId !== 'string') return null;
  if (typeof tabRecipeId !== 'string') return null;
  const version = toInt(tabRecipeVersion);
  if (version === null) return null;
  if (typeof eventKind !== 'string' || !VALID_EVENT_KINDS.has(eventKind as EventKind)) {
    return null;
  }
  const recorded = toIso(recordedAt);
  if (!recorded) return null;

  const sessionId = optStr(row['session_id']);
  const fieldId = optStr(row['field_id']);

  return {
    id,
    tenantId,
    tabRecipeId,
    tabRecipeVersion: version,
    sessionId,
    fieldId,
    eventKind: eventKind as EventKind,
    recordedAt: recorded,
  };
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string') {
    const n = Number.parseInt(v, 10);
    if (Number.isInteger(n)) return n;
  }
  return null;
}

function toIso(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

function optStr(v: unknown): string | null {
  if (typeof v === 'string' && v.length > 0) return v;
  return null;
}
