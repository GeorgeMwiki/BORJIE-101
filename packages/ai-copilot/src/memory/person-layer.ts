/**
 * PersonLayer — federated personal-memory loader.
 *
 * Companion to `Docs/research/unified-personal-kb.md` §10 and migration
 * 0088 (`packages/database/src/schemas/personal-memory.schema.ts`).
 *
 * Per R8, the live brain in @borjie/ai-copilot already does the
 * tenant-scoped semantic recall via `semantic-memory.ts` and the
 * `BrainRegistry` (61 call sites). PersonLayer is the *additive* path
 * that overlays a person's federated cells on top of every recall —
 * but only when:
 *
 *   1. A `personId` is set on the request (resolved by the api-gateway
 *      `person-context.ts` middleware from `person_links` + an explicit
 *      `persons.consent_unified_kb_at` opt-in).
 *   2. The personal_memory_cells table exists (graceful empty fallback
 *      pre-migration 0088 so this code can ship before the migration
 *      lands without breaking any caller).
 *
 * RLS posture: `personal_memory_cells` is FEDERATED (no RLS, no
 * tenant_id). Access is gated by `app.current_person_id` bound by the
 * api-gateway. This module does NOT short-circuit isolation: every
 * cross-tenant numeric synthesis is filtered by `boundary-tagger.ts`.
 *
 * "Predictions APPEND to rule-based decisions" — CLAUDE.md. PersonLayer
 * cells are additive; they NEVER replace tenant memory rows. The brain
 * orchestrator UNION-ALLs them at recall time with the same `origin`
 * tags described in §5.
 */

import { logger } from '../logger.js';

// ────────────────────────────────────────────────────────────────────
// Types — kept structural so this file does not depend on the
// drizzle-orm types directly (matches the dsar-data-source-drizzle.ts
// pattern in this package).
// ────────────────────────────────────────────────────────────────────

/**
 * The five cell-kinds defined by migration 0088.
 *
 * Source: `packages/database/src/schemas/personal-memory.schema.ts`.
 */
export const PERSON_CELL_KINDS = [
  'preference',
  'context',
  'recurring-fact',
  'calibration',
  'sentiment',
] as const;

export type PersonCellKind = (typeof PERSON_CELL_KINDS)[number];

/**
 * One personal_memory_cells row, exposed to the brain in a readonly
 * shape. Mirrors the schema columns 1:1 but with branded immutability.
 */
export interface PersonalMemoryCell {
  readonly id: string;
  readonly personId: string;
  readonly cellKind: PersonCellKind;
  readonly key: string;
  readonly value: Readonly<Record<string, unknown>> | ReadonlyArray<unknown>;
  readonly confidence: number;
  readonly sourceTenantId: string | null;
  readonly sourceThreadId: string | null;
  readonly capturedAt: string;
  readonly expiresAt: string | null;
}

/**
 * Buckets returned by `loadPersonLayer`. We expose buckets (not a flat
 * list) so the brain orchestrator can blend each kind into a different
 * slot in the prompt without re-grouping on the hot path.
 *
 * The `sentiment` bucket from the schema is intentionally folded into
 * `context` here — the brain's prompt layer treats short-lived
 * emotional snapshots the same as situational context (per §10.5 of
 * unified-personal-kb.md). Callers needing the raw kind can read
 * `cell.cellKind` from any cell.
 */
export interface PersonLayerResult {
  readonly preferences: ReadonlyArray<PersonalMemoryCell>;
  readonly context: ReadonlyArray<PersonalMemoryCell>;
  readonly recurringFacts: ReadonlyArray<PersonalMemoryCell>;
  readonly calibration: ReadonlyArray<PersonalMemoryCell>;
}

const EMPTY_RESULT: PersonLayerResult = Object.freeze({
  preferences: Object.freeze([]) as ReadonlyArray<PersonalMemoryCell>,
  context: Object.freeze([]) as ReadonlyArray<PersonalMemoryCell>,
  recurringFacts: Object.freeze([]) as ReadonlyArray<PersonalMemoryCell>,
  calibration: Object.freeze([]) as ReadonlyArray<PersonalMemoryCell>,
});

/**
 * Per-kind cap. The brain has a finite prompt budget; we surface only
 * the most recent 50 cells per kind, matching the §10.6 "recency
 * window" recommendation. Stable upstream of any embedding / rerank.
 */
export const PERSON_LAYER_PER_KIND_LIMIT = 50;

/**
 * Opaque Drizzle client — kept structural so this file never imports
 * `drizzle-orm` directly (would create a cycle with `@borjie/database`).
 * The `execute(query)` method is what every NodePgDatabase /
 * PostgresJsDatabase instance exposes; we accept either at runtime.
 */
export interface PersonLayerDrizzleClient {
  execute(query: unknown): Promise<unknown>;
}

/**
 * `drizzle-orm`'s `sql` tag — passed in so we never import the
 * runtime here.
 */
export type PersonLayerSqlTemplate = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => unknown;

export interface LoadPersonLayerArgs {
  readonly personId: string;
  /** Active tenant for provenance comparison in boundary-tagger. */
  readonly currentTenantId: string;
  readonly db: PersonLayerDrizzleClient;
  /** Injected `sql` template — defaults to lazy import. */
  readonly sqlTemplate?: PersonLayerSqlTemplate;
  /** Override per-kind cap (default `PERSON_LAYER_PER_KIND_LIMIT`). */
  readonly perKindLimit?: number;
}

export interface UpsertPersonalFactArgs {
  readonly personId: string;
  readonly cellKind: PersonCellKind;
  readonly key: string;
  readonly value: Record<string, unknown> | ReadonlyArray<unknown>;
  readonly confidence?: number;
  /** Provenance only — never used to filter access. */
  readonly sourceTenantId?: string | null;
  readonly sourceThreadId?: string | null;
  readonly db: PersonLayerDrizzleClient;
  readonly sqlTemplate?: PersonLayerSqlTemplate;
  /** Optional TTL — passed straight to `expires_at`. */
  readonly expiresAt?: string | null;
}

// ────────────────────────────────────────────────────────────────────
// SQL template resolution
// ────────────────────────────────────────────────────────────────────

let cachedSqlTemplate: PersonLayerSqlTemplate | null = null;

async function resolveSqlTemplate(
  override?: PersonLayerSqlTemplate,
): Promise<PersonLayerSqlTemplate> {
  if (override) return override;
  if (cachedSqlTemplate) return cachedSqlTemplate;
  const mod = (await import('drizzle-orm')) as {
    sql: PersonLayerSqlTemplate;
  };
  cachedSqlTemplate = mod.sql;
  return mod.sql;
}

// ────────────────────────────────────────────────────────────────────
// Row coercion — postgres.js / node-postgres return slightly different
// shapes (camel vs snake). Normalise here so the brain never has to
// branch on the driver.
// ────────────────────────────────────────────────────────────────────

interface RawRow {
  readonly id?: unknown;
  readonly person_id?: unknown;
  readonly personId?: unknown;
  readonly cell_kind?: unknown;
  readonly cellKind?: unknown;
  readonly key?: unknown;
  readonly value?: unknown;
  readonly confidence?: unknown;
  readonly source_tenant_id?: unknown;
  readonly sourceTenantId?: unknown;
  readonly source_thread_id?: unknown;
  readonly sourceThreadId?: unknown;
  readonly captured_at?: unknown;
  readonly capturedAt?: unknown;
  readonly expires_at?: unknown;
  readonly expiresAt?: unknown;
}

function isPersonCellKind(value: unknown): value is PersonCellKind {
  return (
    typeof value === 'string' &&
    (PERSON_CELL_KINDS as ReadonlyArray<string>).includes(value)
  );
}

function coerceTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  // Fail-soft: return epoch so callers can still sort without throwing.
  return new Date(0).toISOString();
}

function coerceNullableTimestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function coerceNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return String(value);
}

function coerceConfidence(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp01(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return clamp01(parsed);
  }
  return 1;
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function coerceValue(
  raw: unknown,
): Readonly<Record<string, unknown>> | ReadonlyArray<unknown> {
  if (Array.isArray(raw)) return raw as ReadonlyArray<unknown>;
  if (raw === null || raw === undefined) return Object.freeze({});
  if (typeof raw === 'object') {
    return raw as Readonly<Record<string, unknown>>;
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return Array.isArray(parsed)
          ? (parsed as ReadonlyArray<unknown>)
          : (parsed as Record<string, unknown>);
      }
    } catch {
      // Not JSON — fall through to wrapping the string in an envelope.
    }
    return Object.freeze({ raw });
  }
  return Object.freeze({ raw });
}

function rowToCell(raw: RawRow): PersonalMemoryCell | null {
  const cellKindRaw = raw.cell_kind ?? raw.cellKind;
  if (!isPersonCellKind(cellKindRaw)) return null;

  const id = coerceNullableString(raw.id);
  const personId = coerceNullableString(raw.person_id ?? raw.personId);
  const key = coerceNullableString(raw.key);
  if (id === null || personId === null || key === null) return null;

  return Object.freeze({
    id,
    personId,
    cellKind: cellKindRaw,
    key,
    value: coerceValue(raw.value),
    confidence: coerceConfidence(raw.confidence),
    sourceTenantId: coerceNullableString(
      raw.source_tenant_id ?? raw.sourceTenantId,
    ),
    sourceThreadId: coerceNullableString(
      raw.source_thread_id ?? raw.sourceThreadId,
    ),
    capturedAt: coerceTimestamp(raw.captured_at ?? raw.capturedAt),
    expiresAt: coerceNullableTimestamp(raw.expires_at ?? raw.expiresAt),
  });
}

// ────────────────────────────────────────────────────────────────────
// Driver shape normalisation
// ────────────────────────────────────────────────────────────────────

function extractRows(result: unknown): ReadonlyArray<RawRow> {
  if (Array.isArray(result)) return result as ReadonlyArray<RawRow>;
  if (result && typeof result === 'object') {
    const candidate = (result as { rows?: unknown }).rows;
    if (Array.isArray(candidate)) return candidate as ReadonlyArray<RawRow>;
  }
  return [];
}

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

/**
 * Load a person's federated memory cells, bucketed by kind, capped per
 * `perKindLimit`. Pre-filtered to drop expired cells. Returns an empty
 * result when:
 *
 *   - `personId` is falsy (caller did not opt in / no link present)
 *   - The personal_memory_cells table does not exist yet (pre-0088)
 *   - The query throws for any reason (logged, never propagated)
 *
 * This contract is "additive": never throws into the recall hot path.
 */
export async function loadPersonLayer(
  args: LoadPersonLayerArgs,
): Promise<PersonLayerResult> {
  if (!args.personId || args.personId.trim() === '') {
    return EMPTY_RESULT;
  }
  if (!args.currentTenantId || args.currentTenantId.trim() === '') {
    // `currentTenantId` is required so boundary-tagger can tag
    // cross-tenant cells. Callers in degraded mode pass an empty
    // string accidentally; refuse rather than mislabel.
    return EMPTY_RESULT;
  }

  const perKindLimit =
    args.perKindLimit && args.perKindLimit > 0
      ? Math.floor(args.perKindLimit)
      : PERSON_LAYER_PER_KIND_LIMIT;

  let sql: PersonLayerSqlTemplate;
  try {
    sql = await resolveSqlTemplate(args.sqlTemplate);
  } catch (error) {
    logger.warn('person-layer: sql template unavailable', {
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_RESULT;
  }

  // The `LATERAL` form keeps each kind's per-row cap independent —
  // a person with 1000 preferences and 2 contexts still surfaces both
  // contexts. Falls back gracefully when the table is absent (the
  // catch-block hits the SQLSTATE for undefined_table 42P01).
  const queryStrings = [
    `
WITH bucketed AS (
  SELECT
    id,
    person_id,
    cell_kind,
    key,
    value,
    confidence,
    source_tenant_id,
    source_thread_id,
    captured_at,
    expires_at,
    ROW_NUMBER() OVER (
      PARTITION BY cell_kind
      ORDER BY captured_at DESC, id DESC
    ) AS rn
  FROM personal_memory_cells
  WHERE person_id = `,
    `
    AND (expires_at IS NULL OR expires_at > now())
)
SELECT
  id,
  person_id,
  cell_kind,
  key,
  value,
  confidence,
  source_tenant_id,
  source_thread_id,
  captured_at,
  expires_at
FROM bucketed
WHERE rn <= `,
    `
ORDER BY cell_kind, captured_at DESC, id DESC
`,
  ];
  const queryStringArray = Object.assign(queryStrings.slice(), {
    raw: queryStrings.slice(),
  }) as unknown as TemplateStringsArray;

  let result: unknown;
  try {
    result = await args.db.execute(
      sql(queryStringArray, args.personId, perKindLimit),
    );
  } catch (error) {
    // SQLSTATE 42P01 = undefined_table. We treat ANY query error as
    // "person layer unavailable" so a missing migration cannot
    // brick the recall hot path. Logged at warn so operators see it.
    logger.warn('person-layer: query failed; returning empty layer', {
      personId: args.personId,
      error: error instanceof Error ? error.message : String(error),
    });
    return EMPTY_RESULT;
  }

  const rows = extractRows(result);
  const preferences: PersonalMemoryCell[] = [];
  const context: PersonalMemoryCell[] = [];
  const recurringFacts: PersonalMemoryCell[] = [];
  const calibration: PersonalMemoryCell[] = [];

  for (const raw of rows) {
    const cell = rowToCell(raw);
    if (!cell) continue;
    switch (cell.cellKind) {
      case 'preference':
        preferences.push(cell);
        break;
      case 'context':
      case 'sentiment':
        // §10.6: sentiment folds into context for prompt-layer purposes.
        context.push(cell);
        break;
      case 'recurring-fact':
        recurringFacts.push(cell);
        break;
      case 'calibration':
        calibration.push(cell);
        break;
    }
  }

  return Object.freeze({
    preferences: Object.freeze(preferences),
    context: Object.freeze(context),
    recurringFacts: Object.freeze(recurringFacts),
    calibration: Object.freeze(calibration),
  });
}

/**
 * Upsert a single personal fact. The schema's
 * `uq_person_links_person_tenant_user`/`uq_personal_memory_person_kind_key`
 * UNIQUE on (person_id, cell_kind, key) gives us idempotency
 * deterministically.
 *
 * Confidence is clamped to [0,1]. `expiresAt` MUST be an ISO timestamp
 * if provided (Postgres will parse it under the column type). Returns
 * `void` because the call site never needs the row back — the brain
 * re-reads on the next recall.
 *
 * Fails closed when the table is missing or `personId` is empty.
 */
export async function upsertPersonalFact(
  args: UpsertPersonalFactArgs,
): Promise<void> {
  if (!args.personId || args.personId.trim() === '') {
    return;
  }
  if (!args.key || args.key.trim() === '') {
    return;
  }
  if (!isPersonCellKind(args.cellKind)) {
    return;
  }

  let sql: PersonLayerSqlTemplate;
  try {
    sql = await resolveSqlTemplate(args.sqlTemplate);
  } catch (error) {
    logger.warn('person-layer: sql template unavailable on upsert', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const confidence = clamp01(
    typeof args.confidence === 'number' ? args.confidence : 1,
  );
  const valueJson = JSON.stringify(args.value ?? {});
  const sourceTenantId = args.sourceTenantId ?? null;
  const sourceThreadId = args.sourceThreadId ?? null;
  const expiresAt = args.expiresAt ?? null;

  const queryStrings = [
    `
INSERT INTO personal_memory_cells (
  person_id,
  cell_kind,
  key,
  value,
  confidence,
  source_tenant_id,
  source_thread_id,
  expires_at
) VALUES (
  `,
    `,
  `,
    `,
  `,
    `,
  `,
    `::jsonb,
  `,
    `,
  `,
    `,
  `,
    `,
  `,
    `
)
ON CONFLICT (person_id, cell_kind, key)
DO UPDATE SET
  value = EXCLUDED.value,
  confidence = EXCLUDED.confidence,
  source_tenant_id = EXCLUDED.source_tenant_id,
  source_thread_id = EXCLUDED.source_thread_id,
  captured_at = now(),
  expires_at = EXCLUDED.expires_at
`,
  ];
  const queryStringArray = Object.assign(queryStrings.slice(), {
    raw: queryStrings.slice(),
  }) as unknown as TemplateStringsArray;

  try {
    await args.db.execute(
      sql(
        queryStringArray,
        args.personId,
        args.cellKind,
        args.key,
        valueJson,
        confidence,
        sourceTenantId,
        sourceThreadId,
        expiresAt,
      ),
    );
  } catch (error) {
    logger.warn('person-layer: upsert failed', {
      personId: args.personId,
      cellKind: args.cellKind,
      key: args.key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Convenience: flatten a `PersonLayerResult` into a single readonly
 * list. Useful for boundary-tagger / audit chain. Preserves bucket
 * ordering (preferences → context → recurringFacts → calibration).
 */
export function flattenPersonLayer(
  result: PersonLayerResult,
): ReadonlyArray<PersonalMemoryCell> {
  return Object.freeze([
    ...result.preferences,
    ...result.context,
    ...result.recurringFacts,
    ...result.calibration,
  ]);
}
