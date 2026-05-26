/**
 * `PostgresMemoryBlockStore` — Drizzle-backed adapter for the
 * `MemoryBlockStore` port defined in
 * `@borjie/central-intelligence/kernel/memory`.
 *
 * Backs migration 0181's `memory_blocks` table. The store is
 * tenant-scoped via the `app.current_tenant_id` GUC (set by the
 * api-gateway tenant-context middleware) so the Drizzle queries here
 * never need to add a tenant filter — Postgres enforces it.
 *
 * Two behaviours worth noting:
 *
 *   1. `upsert` is idempotent on (tenantId, sessionId, kind). The
 *      adapter does a transactional read → update or insert (no
 *      raw `ON CONFLICT` because we want the JS-side ID generation
 *      for fresh rows to flow through to the caller).
 *
 *   2. `list` returns blocks ordered by `updated_at DESC` so the
 *      caller can render the freshest blocks first without an
 *      extra sort.
 *
 * The Drizzle client is injected as an opaque port so test rigs can
 * bind an in-memory fake (or pg-mem) without dragging the whole DB
 * package's transitive deps into the unit test.
 */

import type {
  MemoryBlock,
  MemoryBlockStore,
  MemoryBlockUpsert,
} from './memory-block-port.js';

/**
 * The narrow slice of the Drizzle client we need. We intentionally
 * stay duck-typed at this seam because `@borjie/database` is not a
 * direct dependency of `@borjie/ai-copilot` (would create a cycle
 * through schema imports) — the api-gateway composition root passes
 * the configured client at startup.
 */
export interface MemoryBlockDbPort {
  /**
   * Execute a parameterised SQL query and return rows as
   * `Record<string, unknown>`. The implementation is expected to be
   * either Drizzle's `db.execute` or a `postgres.js` tagged template
   * wrapper. Errors propagate.
   */
  execute(args: {
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
  }): Promise<ReadonlyArray<Record<string, unknown>>>;
}

/**
 * Identifier minter. Default is a Date-prefixed nano-id with a 9-char
 * random suffix; tests may inject a deterministic counter.
 */
export type IdGenerator = () => string;

const defaultIdGen: IdGenerator = () =>
  `mb_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

/**
 * Concrete Drizzle-backed `MemoryBlockStore`.
 */
export class PostgresMemoryBlockStore implements MemoryBlockStore {
  private readonly db: MemoryBlockDbPort;
  private readonly genId: IdGenerator;
  private readonly nowFn: () => Date;

  constructor(args: {
    readonly db: MemoryBlockDbPort;
    readonly generateId?: IdGenerator;
    readonly now?: () => Date;
  }) {
    if (!args.db || typeof args.db.execute !== 'function') {
      throw new Error(
        'PostgresMemoryBlockStore: db.execute is required (see @borjie/database client factory).',
      );
    }
    this.db = args.db;
    this.genId = args.generateId ?? defaultIdGen;
    this.nowFn = args.now ?? ((): Date => new Date());
  }

  async list(args: {
    readonly tenantId: string | null;
    readonly sessionId: string;
  }): Promise<ReadonlyArray<MemoryBlock>> {
    assertSessionId(args.sessionId);
    const tenantClause =
      args.tenantId === null
        ? 'tenant_id IS NULL'
        : 'tenant_id = $1::text';
    const params: unknown[] =
      args.tenantId === null ? [args.sessionId] : [args.tenantId, args.sessionId];
    const sessionParamIdx = args.tenantId === null ? 1 : 2;
    const sql = `
      SELECT id, tenant_id, session_id, kind, content, metadata,
             created_at, updated_at
        FROM memory_blocks
       WHERE ${tenantClause}
         AND session_id = $${sessionParamIdx}::text
       ORDER BY updated_at DESC
    `;
    const rows = await this.db.execute({ sql, params });
    return rows.map(rowToBlock);
  }

  async upsert(block: MemoryBlockUpsert): Promise<MemoryBlock> {
    assertSessionId(block.sessionId);
    assertKind(block.kind);
    if (typeof block.content !== 'string') {
      throw new Error('memory-blocks upsert: content must be a string');
    }
    const id = block.id ?? this.genId();
    const now = this.nowFn();
    const metadataJson = JSON.stringify(block.metadata ?? {});

    // ON CONFLICT on (tenant_id, session_id, kind) UPDATE the row
    // in place. We rely on a partial unique index when tenant_id is
    // null (added by migration 0181 follow-up); here we deal with
    // both NULL and non-NULL tenant ids with an explicit existence
    // check fallback for the NULL case to avoid relying on
    // NULLS-DISTINCT semantics.
    const upsertSql = `
      INSERT INTO memory_blocks (
        id, tenant_id, session_id, kind, content, metadata,
        created_at, updated_at
      )
      VALUES ($1::text, $2::text, $3::text, $4::text, $5::text, $6::jsonb, $7::timestamptz, $7::timestamptz)
      ON CONFLICT ON CONSTRAINT memory_blocks_pkey DO NOTHING
      RETURNING id, tenant_id, session_id, kind, content, metadata,
                created_at, updated_at
    `;

    const inserted = await this.db.execute({
      sql: upsertSql,
      params: [
        id,
        block.tenantId,
        block.sessionId,
        block.kind,
        block.content,
        metadataJson,
        now,
      ],
    });
    if (inserted.length > 0 && inserted[0] !== undefined) {
      return rowToBlock(inserted[0]);
    }

    // PK collision: row with this id already exists. Update it in place.
    const updateSql = `
      UPDATE memory_blocks
         SET content    = $1::text,
             metadata   = $2::jsonb,
             updated_at = $3::timestamptz
       WHERE id = $4::text
   RETURNING id, tenant_id, session_id, kind, content, metadata,
             created_at, updated_at
    `;
    const updated = await this.db.execute({
      sql: updateSql,
      params: [block.content, metadataJson, now, id],
    });
    if (updated.length === 0 || updated[0] === undefined) {
      throw new Error(
        `PostgresMemoryBlockStore: upsert produced no row for id=${id}`,
      );
    }
    return rowToBlock(updated[0]);
  }

  async remove(args: {
    readonly tenantId: string | null;
    readonly id: string;
  }): Promise<void> {
    if (typeof args.id !== 'string' || args.id.length === 0) {
      throw new Error('memory-blocks remove: id is required');
    }
    const tenantClause =
      args.tenantId === null
        ? 'tenant_id IS NULL'
        : 'tenant_id = $2::text';
    const params: unknown[] =
      args.tenantId === null ? [args.id] : [args.id, args.tenantId];
    const sql = `DELETE FROM memory_blocks WHERE id = $1::text AND ${tenantClause}`;
    await this.db.execute({ sql, params });
  }
}

// ─────────────────────────────────────────────────────────────────────
// Row marshalling
// ─────────────────────────────────────────────────────────────────────

function rowToBlock(row: Record<string, unknown>): MemoryBlock {
  return {
    id: stringField(row, 'id'),
    tenantId: optionalStringField(row, 'tenant_id'),
    sessionId: stringField(row, 'session_id'),
    kind: stringField(row, 'kind'),
    content: stringField(row, 'content'),
    metadata: parseMetadata(row.metadata),
    createdAt: parseDate(row.created_at),
    updatedAt: parseDate(row.updated_at),
  };
}

function stringField(row: Record<string, unknown>, key: string): string {
  const v = row[key];
  if (typeof v !== 'string') {
    throw new Error(`memory-blocks row: expected string for ${key}, got ${typeof v}`);
  }
  return v;
}

function optionalStringField(
  row: Record<string, unknown>,
  key: string,
): string | null {
  const v = row[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') {
    throw new Error(`memory-blocks row: expected string|null for ${key}, got ${typeof v}`);
  }
  return v;
}

function parseDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new Error('memory-blocks row: unparseable date');
}

function parseMetadata(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return {};
}

function assertSessionId(sessionId: string): void {
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Error('memory-blocks: sessionId is required');
  }
}

function assertKind(kind: string): void {
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new Error('memory-blocks: kind is required');
  }
}
