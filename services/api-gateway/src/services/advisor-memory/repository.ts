/**
 * Advisor memory — Postgres-backed repository.
 *
 * Read + write primitives over `advisor_preferences` and
 * `advisor_observed_patterns`. Tenant scoping is enforced at the RLS
 * layer via the `app.tenant_id` GUC bound by the api-gateway
 * middleware — we never double-filter from app code.
 *
 * Every function returns immutable values. Failure paths log and
 * return null / empty arrays so the brain never aborts a turn on a
 * memory-layer hiccup.
 */

import { sql } from 'drizzle-orm';

import type {
  AdvisorPreferences,
  ObservedPattern,
  PatternKind,
} from './types.js';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

interface ExecRow {
  readonly [key: string]: unknown;
}

function rowsOf(result: unknown): ReadonlyArray<ExecRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<ExecRow>;
  const wrapped = result as { rows?: ReadonlyArray<ExecRow> };
  return wrapped?.rows ?? [];
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

function asJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function rowToPreferences(row: ExecRow): AdvisorPreferences {
  return Object.freeze({
    tenantId: asString(row.tenant_id),
    language: (asString(row.language, 'sw') === 'en' ? 'en' : 'sw') as 'sw' | 'en',
    timeZone: asString(row.time_zone, 'Africa/Dar_es_Salaam'),
    defaultBriefCadence: asString(row.default_brief_cadence, 'daily') as
      | 'hourly'
      | 'daily'
      | 'weekly'
      | 'monthly'
      | 'off',
    communicationStyle: asString(row.communication_style, 'concise') as
      | 'concise'
      | 'detailed'
      | 'technical',
    preferredChannels: Object.freeze(
      asJson<ReadonlyArray<string>>(row.preferred_channels, []),
    ),
    doNotDisturb: Object.freeze(
      asJson<ReadonlyArray<Record<string, unknown>>>(row.do_not_disturb, []),
    ),
    lastTaughtAt:
      row.last_taught_at instanceof Date
        ? row.last_taught_at.toISOString()
        : typeof row.last_taught_at === 'string'
          ? row.last_taught_at
          : null,
    masteryLevels: Object.freeze(
      asJson<Record<string, string>>(row.mastery_levels, {}),
    ),
    frictionSignals: Object.freeze(
      asJson<Record<string, number>>(row.friction_signals, {}),
    ),
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : asString(row.updated_at, new Date().toISOString()),
  });
}

function rowToPattern(row: ExecRow): ObservedPattern {
  return Object.freeze({
    id: asString(row.id),
    tenantId: asString(row.tenant_id),
    patternKind: asString(row.pattern_kind, 'routine') as PatternKind,
    patternPayload: Object.freeze(
      asJson<Record<string, unknown>>(row.pattern_payload, {}),
    ),
    confidence: asNumber(row.confidence, 0.5),
    firstSeenAt:
      row.first_seen_at instanceof Date
        ? row.first_seen_at.toISOString()
        : asString(row.first_seen_at),
    lastSeenAt:
      row.last_seen_at instanceof Date
        ? row.last_seen_at.toISOString()
        : asString(row.last_seen_at),
    occurrences: asNumber(row.occurrences, 1),
  });
}

export async function readPreferences(
  db: DbLike,
  tenantId: string,
): Promise<AdvisorPreferences | null> {
  try {
    const result = await db.execute(sql`
      SELECT tenant_id, language, time_zone, default_brief_cadence,
             communication_style, preferred_channels, do_not_disturb,
             last_taught_at, mastery_levels, friction_signals, updated_at
        FROM advisor_preferences
       WHERE tenant_id = ${tenantId}
       LIMIT 1
    `);
    const rows = rowsOf(result);
    if (rows.length === 0 || !rows[0]) return null;
    return rowToPreferences(rows[0]);
  } catch {
    return null;
  }
}

export async function upsertPreferences(
  db: DbLike,
  tenantId: string,
  patch: Partial<Omit<AdvisorPreferences, 'tenantId' | 'updatedAt'>>,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO advisor_preferences (
        tenant_id,
        language,
        time_zone,
        default_brief_cadence,
        communication_style,
        preferred_channels,
        do_not_disturb,
        last_taught_at,
        mastery_levels,
        friction_signals,
        updated_at
      )
      VALUES (
        ${tenantId},
        ${patch.language ?? 'sw'},
        ${patch.timeZone ?? 'Africa/Dar_es_Salaam'},
        ${patch.defaultBriefCadence ?? 'daily'},
        ${patch.communicationStyle ?? 'concise'},
        ${JSON.stringify(patch.preferredChannels ?? ['email'])}::jsonb,
        ${JSON.stringify(patch.doNotDisturb ?? [])}::jsonb,
        ${patch.lastTaughtAt ?? null},
        ${JSON.stringify(patch.masteryLevels ?? {})}::jsonb,
        ${JSON.stringify(patch.frictionSignals ?? {})}::jsonb,
        NOW()
      )
      ON CONFLICT (tenant_id) DO UPDATE SET
        language              = COALESCE(EXCLUDED.language, advisor_preferences.language),
        time_zone             = COALESCE(EXCLUDED.time_zone, advisor_preferences.time_zone),
        default_brief_cadence = COALESCE(EXCLUDED.default_brief_cadence, advisor_preferences.default_brief_cadence),
        communication_style   = COALESCE(EXCLUDED.communication_style, advisor_preferences.communication_style),
        preferred_channels    = EXCLUDED.preferred_channels,
        do_not_disturb        = EXCLUDED.do_not_disturb,
        last_taught_at        = COALESCE(EXCLUDED.last_taught_at, advisor_preferences.last_taught_at),
        mastery_levels        = EXCLUDED.mastery_levels,
        friction_signals      = EXCLUDED.friction_signals,
        updated_at            = NOW()
    `);
  } catch {
    // Swallow — memory writes must not break the chat turn.
  }
}

/**
 * Salience ordering: confidence-weighted occurrences (decays toward
 * older patterns naturally because `last_seen_at` tracks recency).
 * Returns up to `limit` patterns per kind in descending salience.
 */
export async function readTopPatterns(
  db: DbLike,
  tenantId: string,
  limit: number,
): Promise<ReadonlyArray<ObservedPattern>> {
  try {
    const cap = Math.max(1, Math.min(20, Math.trunc(limit) || 5));
    const result = await db.execute(sql`
      SELECT id, tenant_id, pattern_kind, pattern_payload, confidence,
             first_seen_at, last_seen_at, occurrences
        FROM advisor_observed_patterns
       WHERE tenant_id = ${tenantId}
       ORDER BY (occurrences * confidence) DESC, last_seen_at DESC
       LIMIT ${cap}
    `);
    return rowsOf(result).map(rowToPattern);
  } catch {
    return [];
  }
}

/**
 * Upsert a pattern by (tenant_id, kind, signature). Increments
 * occurrences + bumps last_seen_at when a row matches; inserts a fresh
 * row otherwise. Confidence climbs sub-linearly with occurrences and
 * is capped at 0.99.
 */
export async function upsertPattern(
  db: DbLike,
  tenantId: string,
  kind: PatternKind,
  payload: Record<string, unknown>,
  signature: string,
): Promise<void> {
  try {
    const payloadWithSig = { ...payload, signature };
    const json = JSON.stringify(payloadWithSig);
    await db.execute(sql`
      WITH existing AS (
        SELECT id, occurrences
          FROM advisor_observed_patterns
         WHERE tenant_id = ${tenantId}
           AND pattern_kind = ${kind}
           AND pattern_payload->>'signature' = ${signature}
         LIMIT 1
      ),
      updated AS (
        UPDATE advisor_observed_patterns p
           SET occurrences  = e.occurrences + 1,
               last_seen_at = NOW(),
               confidence   = LEAST(0.99, 0.5 + 0.04 * (e.occurrences + 1))
          FROM existing e
         WHERE p.id = e.id
        RETURNING p.id
      )
      INSERT INTO advisor_observed_patterns (
        tenant_id, pattern_kind, pattern_payload, confidence,
        first_seen_at, last_seen_at, occurrences
      )
      SELECT ${tenantId}, ${kind}, ${json}::jsonb, 0.54,
             NOW(), NOW(), 1
       WHERE NOT EXISTS (SELECT 1 FROM updated)
         AND NOT EXISTS (SELECT 1 FROM existing)
    `);
  } catch {
    // Swallow — memory writes must not break the chat turn.
  }
}
