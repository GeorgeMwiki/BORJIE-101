/**
 * Record store — the generic, schema-on-read persistence for the records a
 * generated tab COLLECTS.
 *
 * A tab with `record.enabled` accepts user submissions. There is no per-tab
 * table: every tab's records land in ONE generic `portal_tab_records` table
 * (migration 0328) as a JSONB `payload`, tenant-scoped + keyed by `tab_id` /
 * `tab_key`. The shape is enforced not by the column types but by the tab's own
 * `PortalTabField[]` at write time — schema-ON-READ done at write — so a new
 * domain needs zero new migrations (composition, not code).
 *
 * `saveRecord` VALIDATES the payload against the tab's fields (required present,
 * kind-appropriate types, dropdown options membership, number min/max) via the
 * standalone `validateRecordAgainstTab` before it inserts. A validation failure
 * throws `RecordValidationError` carrying the failing field keys so the router
 * can answer 422 without re-validating.
 *
 * Two implementations: a Drizzle-backed adapter over the narrow `DbExecutor`
 * port (same `$client.unsafe(sql, params)` boundary the tab repo uses — RLS
 * FORCE on `app.current_tenant_id` does the tenant isolation in the DB), and an
 * in-memory variant for tests. Both share the pure validator.
 */

import {
  validateRecordAgainstTab,
  type RecordValidationFailure,
} from './record-validator.js';
import type { DbExecutor } from './drizzle-tab-repo.js';
import type { PortalTab } from '../types.js';

// ────────────────────────────────────────────────────────────────────
// Public types
// ────────────────────────────────────────────────────────────────────

/** A persisted record row. `payload` is the validated, tab-shaped submission. */
export interface PortalTabRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly tabId: string;
  readonly tabKey: string;
  readonly payload: Record<string, unknown>;
  readonly createdByUserId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveRecordInput {
  readonly tenantId: string;
  /** The owning tab — its fields drive validation, its id/key index the row. */
  readonly tab: PortalTab;
  readonly payload: unknown;
  /** The submitting user (audit / created_by). */
  readonly userId: string;
}

export interface ListRecordsInput {
  readonly tenantId: string;
  readonly tabId: string;
  /** Page size cap. Default 100, hard-max 500. */
  readonly limit?: number;
}

export interface GetRecordInput {
  readonly tenantId: string;
  readonly recordId: string;
}

export interface RecordStore {
  saveRecord(input: SaveRecordInput): Promise<PortalTabRecord>;
  listRecords(input: ListRecordsInput): Promise<ReadonlyArray<PortalTabRecord>>;
  getRecord(input: GetRecordInput): Promise<PortalTabRecord | null>;
}

/**
 * Thrown by `saveRecord` when the payload fails validation against the tab's
 * fields. Carries the failing field keys so the API can answer 422 directly.
 */
export class RecordValidationError extends Error {
  readonly invalidFieldKeys: ReadonlyArray<string>;
  readonly issues: Readonly<Record<string, string>>;
  constructor(failure: RecordValidationFailure) {
    super(
      `record payload failed validation for fields: ${failure.invalidFieldKeys.join(
        ', ',
      )}`,
    );
    this.name = 'RecordValidationError';
    this.invalidFieldKeys = failure.invalidFieldKeys;
    this.issues = failure.issues;
  }
}

// ────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clampLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Validate the payload against the tab's own fields. Throws
 * `RecordValidationError` on failure; returns the stripped payload on success.
 * Shared by both store implementations so validation can never be bypassed.
 */
function validateOrThrow(input: SaveRecordInput): Record<string, unknown> {
  const result = validateRecordAgainstTab(input.tab, input.payload);
  if (!result.ok) {
    throw new RecordValidationError(result);
  }
  return result.payload;
}

// ────────────────────────────────────────────────────────────────────
// Drizzle-backed store
// ────────────────────────────────────────────────────────────────────

interface PortalTabRecordRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly tab_id: string;
  readonly tab_key: string;
  readonly payload: Record<string, unknown> | string;
  readonly created_by_user_id: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
}

function safeJsonParse(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToRecord(row: PortalTabRecordRow): PortalTabRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    tabId: row.tab_id,
    tabKey: row.tab_key,
    payload:
      typeof row.payload === 'string'
        ? safeJsonParse(row.payload)
        : row.payload,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export interface DrizzleRecordStoreDeps {
  readonly db: DbExecutor;
  readonly clock?: () => Date;
  /** Id factory — defaults to `crypto.randomUUID`. Injectable for tests. */
  readonly newId?: () => string;
}

export function createDrizzleRecordStore(
  deps: DrizzleRecordStoreDeps,
): RecordStore {
  const clock = deps.clock ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());

  return {
    async saveRecord(input: SaveRecordInput): Promise<PortalTabRecord> {
      const payload = validateOrThrow(input);
      const id = newId();
      const now = clock().toISOString();
      await deps.db.query(
        `
        INSERT INTO public.portal_tab_records (
          id, tenant_id, tab_id, tab_key, payload,
          created_by_user_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
        `,
        [
          id,
          input.tenantId,
          input.tab.id,
          input.tab.tabKey,
          JSON.stringify(payload),
          input.userId,
          now,
          now,
        ],
      );
      return {
        id,
        tenantId: input.tenantId,
        tabId: input.tab.id,
        tabKey: input.tab.tabKey,
        payload,
        createdByUserId: input.userId,
        createdAt: now,
        updatedAt: now,
      };
    },

    async listRecords(
      input: ListRecordsInput,
    ): Promise<ReadonlyArray<PortalTabRecord>> {
      const limit = clampLimit(input.limit);
      const rows = await deps.db.query<PortalTabRecordRow>(
        `
        SELECT id, tenant_id, tab_id, tab_key, payload,
               created_by_user_id, created_at, updated_at
        FROM public.portal_tab_records
        WHERE tenant_id = $1 AND tab_id = $2
        ORDER BY created_at DESC, id DESC
        LIMIT $3
        `,
        [input.tenantId, input.tabId, limit],
      );
      return rows.map(rowToRecord);
    },

    async getRecord(input: GetRecordInput): Promise<PortalTabRecord | null> {
      const rows = await deps.db.query<PortalTabRecordRow>(
        `
        SELECT id, tenant_id, tab_id, tab_key, payload,
               created_by_user_id, created_at, updated_at
        FROM public.portal_tab_records
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1
        `,
        [input.recordId, input.tenantId],
      );
      const row = rows[0];
      return row ? rowToRecord(row) : null;
    },
  };
}

// ────────────────────────────────────────────────────────────────────
// In-memory store — tests / dev / smoke.
// ────────────────────────────────────────────────────────────────────

export interface InMemoryRecordStoreOptions {
  readonly clock?: () => Date;
  readonly newId?: () => string;
}

export function createInMemoryRecordStore(
  options: InMemoryRecordStoreOptions = {},
): RecordStore {
  const clock = options.clock ?? (() => new Date());
  let seq = 0;
  const newId = options.newId ?? (() => `rec_${++seq}`);
  const store = new Map<string, PortalTabRecord>();

  return {
    async saveRecord(input: SaveRecordInput): Promise<PortalTabRecord> {
      const payload = validateOrThrow(input);
      const now = clock().toISOString();
      const record: PortalTabRecord = {
        id: newId(),
        tenantId: input.tenantId,
        tabId: input.tab.id,
        tabKey: input.tab.tabKey,
        payload,
        createdByUserId: input.userId,
        createdAt: now,
        updatedAt: now,
      };
      store.set(record.id, record);
      return record;
    },

    async listRecords(
      input: ListRecordsInput,
    ): Promise<ReadonlyArray<PortalTabRecord>> {
      const limit = clampLimit(input.limit);
      const matches = [...store.values()].filter(
        (r) => r.tenantId === input.tenantId && r.tabId === input.tabId,
      );
      matches.sort((a, b) => {
        if (a.createdAt === b.createdAt) return b.id.localeCompare(a.id);
        return b.createdAt.localeCompare(a.createdAt);
      });
      return matches.slice(0, limit);
    },

    async getRecord(input: GetRecordInput): Promise<PortalTabRecord | null> {
      const record = store.get(input.recordId);
      if (!record || record.tenantId !== input.tenantId) return null;
      return record;
    },
  };
}
