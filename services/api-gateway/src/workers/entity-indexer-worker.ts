/**
 * Entity Indexer Worker — Wave ENTITY-LEGIBILITY.
 *
 * Companion to:
 *   - packages/database/src/migrations/0115_entity_index.sql
 *   - services/api-gateway/src/services/cross-reference-discovery/
 *   - services/api-gateway/src/composition/brain-tools/entity-legibility-tools.ts
 *   - Docs/DESIGN/ENTITY_LEGIBILITY_INDEX.md
 *
 * Ticks every 30 minutes (env-tunable). For every entity kind in the
 * `INDEXABLE_KINDS` registry the worker:
 *
 *   1. Scans for rows whose `updated_at > last refreshed_at` in
 *      `entity_index` (or never indexed before).
 *   2. Embeds the row's display text via OpenAI text-embedding-3-small
 *      (1536 dims). Falls back to NULL embedding when no key is set;
 *      the brain tools degrade to fuzzy text matching gracefully.
 *   3. Extracts tags + summary + lifecycle_stage from canonical fields.
 *   4. Upserts into `entity_index`.
 *   5. Calls the matching cross-reference discoverer and upserts every
 *      returned edge into `entity_cross_references`.
 *
 * Failure containment:
 *   - DB unwired → no-op + warn once.
 *   - Per-row errors isolated (one bad row cannot poison the batch).
 *   - Per-kind errors isolated (one missing table cannot poison the tick).
 *   - All errors logged via Pino — NO console.log in services.
 *
 * Tenant isolation: each `UPDATE` / `INSERT` carries the source row's
 * `tenant_id` literally; RLS at the api-gateway is bypassed here
 * because the worker runs as the platform identity (no
 * `app.tenant_id` GUC set). RLS still enforces tenant scope on every
 * read from the brain tools that consume the index.
 */

import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { discoverEdges, type DiscovererDb } from '../services/cross-reference-discovery';
import {
  registerWorker,
  workerHeartbeat,
  workerHeartbeatFailure,
} from './worker-heartbeat';

const THIRTY_MIN_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = THIRTY_MIN_MS;
const DEFAULT_BATCH_PER_KIND = 200;
const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings';
const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

export interface DbLike extends DiscovererDb {
  execute(query: unknown): Promise<unknown>;
}

export interface EntityIndexerOptions {
  readonly db: DbLike;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly enabled?: boolean;
  readonly now?: () => Date;
  /** Optional injection — bypasses OpenAI in tests. Returning `null`
   *  models the "no key configured" path. */
  readonly embedText?: (text: string) => Promise<number[] | null>;
  /** Optional override per tick — defaults to 200 rows per kind. */
  readonly batchPerKind?: number;
}

export interface EntityIndexerHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<EntityIndexerTickResult>;
}

export interface EntityIndexerTickResult {
  readonly indexedCount: number;
  readonly edgesUpserted: number;
  readonly failedRows: number;
  readonly perKindCounts: Readonly<Record<string, number>>;
}

// ─── Indexable kinds registry ────────────────────────────────────────
// Each entry binds an `entity_kind` (the legibility namespace) to:
//   - sourceQuery: the SQL that returns rows due for re-indexing
//   - parseRow:    pure mapper from the SQL row to the canonical
//                  IndexableRow envelope.
//
// Add a kind by extending this registry — the worker discovers it on
// the next tick. NO schema migration required: the entity_kind column
// in entity_index is open text.

interface IndexableRow {
  readonly tenantId: string;
  readonly entityId: string;
  readonly displayName: string;
  readonly textForEmbedding: string;
  readonly tags: ReadonlyArray<string>;
  readonly summary: string;
  readonly lifecycleStage: 'draft' | 'active' | 'dormant' | 'archived' | 'deleted';
  readonly sourceUpdatedAt: Date;
}

interface IndexableKind {
  readonly entityKind: string;
  /** Returns rows where source.updated_at > entity_index.refreshed_at. */
  readonly sourceQuery: (limit: number) => unknown;
  readonly parseRow: (row: Record<string, unknown>) => IndexableRow | null;
}

function strOrEmpty(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function parseDate(v: unknown): Date {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function lifecycleFromStatus(status: string): IndexableRow['lifecycleStage'] {
  const s = status.toLowerCase();
  if (s === 'draft' || s === 'drafting' || s === 'pending') return 'draft';
  if (s === 'archived' || s === 'archive') return 'archived';
  if (s === 'dormant' || s === 'paused' || s === 'suspended') return 'dormant';
  if (s === 'deleted' || s === 'cancelled' || s === 'surrendered') return 'deleted';
  return 'active';
}

// ─── Per-kind specs ──────────────────────────────────────────────────

const LICENCE_KIND: IndexableKind = {
  entityKind: 'licence',
  sourceQuery: (limit) => sql`
    SELECT l.tenant_id, l.id, l.number, l.kind, l.mineral, l.status,
           l.expiry_date, l.updated_at
      FROM licences l
      LEFT JOIN entity_index ei
        ON ei.tenant_id   = l.tenant_id
       AND ei.entity_kind = 'licence'
       AND ei.entity_id   = l.id
     WHERE ei.refreshed_at IS NULL
        OR ei.refreshed_at < l.updated_at
     ORDER BY l.updated_at ASC
     LIMIT ${limit}
  `,
  parseRow(row) {
    const tenantId = strOrEmpty(row.tenant_id);
    const id = strOrEmpty(row.id);
    if (!tenantId || !id) return null;
    const number = strOrEmpty(row.number);
    const kind = strOrEmpty(row.kind);
    const mineral = strOrEmpty(row.mineral);
    const status = strOrEmpty(row.status);
    const displayName = `${kind} ${number}`.trim();
    const expiry = row.expiry_date ? String(row.expiry_date).slice(0, 10) : '';
    return {
      tenantId,
      entityId: id,
      displayName,
      textForEmbedding: [displayName, mineral, status, expiry].filter(Boolean).join(' '),
      tags: [`kind:${kind}`, `mineral:${mineral}`, `status:${status}`].filter(
        (t) => !t.endsWith(':'),
      ),
      summary: `${kind} ${number} (${mineral}) — ${status}${expiry ? `, expires ${expiry}` : ''}`,
      lifecycleStage: lifecycleFromStatus(status),
      sourceUpdatedAt: parseDate(row.updated_at),
    };
  },
};

const SITE_KIND: IndexableKind = {
  entityKind: 'site',
  sourceQuery: (limit) => sql`
    SELECT s.tenant_id, s.id, s.name, s.mineral, s.phase, s.status, s.updated_at
      FROM sites s
      LEFT JOIN entity_index ei
        ON ei.tenant_id   = s.tenant_id
       AND ei.entity_kind = 'site'
       AND ei.entity_id   = s.id
     WHERE ei.refreshed_at IS NULL
        OR ei.refreshed_at < s.updated_at
     ORDER BY s.updated_at ASC
     LIMIT ${limit}
  `,
  parseRow(row) {
    const tenantId = strOrEmpty(row.tenant_id);
    const id = strOrEmpty(row.id);
    if (!tenantId || !id) return null;
    const name = strOrEmpty(row.name);
    const mineral = strOrEmpty(row.mineral);
    const phase = strOrEmpty(row.phase);
    const status = strOrEmpty(row.status);
    return {
      tenantId,
      entityId: id,
      displayName: name || `Site ${id}`,
      textForEmbedding: [name, mineral, phase, status].filter(Boolean).join(' '),
      tags: [`mineral:${mineral}`, `phase:${phase}`, `status:${status}`].filter(
        (t) => !t.endsWith(':'),
      ),
      summary: `${name} — ${mineral}, phase ${phase}, ${status}`,
      lifecycleStage: lifecycleFromStatus(status),
      sourceUpdatedAt: parseDate(row.updated_at),
    };
  },
};

const REMINDER_KIND: IndexableKind = {
  entityKind: 'reminder',
  sourceQuery: (limit) => sql`
    SELECT r.tenant_id, r.id::text, r.title, r.body, r.status, r.trigger_at, r.created_at
      FROM reminders r
      LEFT JOIN entity_index ei
        ON ei.tenant_id   = r.tenant_id
       AND ei.entity_kind = 'reminder'
       AND ei.entity_id   = r.id::text
     WHERE ei.refreshed_at IS NULL
        OR ei.refreshed_at < r.created_at
     ORDER BY r.created_at ASC
     LIMIT ${limit}
  `,
  parseRow(row) {
    const tenantId = strOrEmpty(row.tenant_id);
    const id = strOrEmpty(row.id);
    if (!tenantId || !id) return null;
    const title = strOrEmpty(row.title);
    const status = strOrEmpty(row.status);
    const triggerAt = row.trigger_at ? String(row.trigger_at).slice(0, 16) : '';
    return {
      tenantId,
      entityId: id,
      displayName: title,
      textForEmbedding: [title, strOrEmpty(row.body)].filter(Boolean).join(' '),
      tags: [`status:${status}`].filter((t) => !t.endsWith(':')),
      summary: `Reminder "${title}"${triggerAt ? ` at ${triggerAt}` : ''} (${status})`,
      lifecycleStage: lifecycleFromStatus(status),
      sourceUpdatedAt: parseDate(row.created_at),
    };
  },
};

const ROYALTY_DRAFT_KIND: IndexableKind = {
  entityKind: 'royalty_draft',
  sourceQuery: (limit) => sql`
    SELECT d.tenant_id, d.id::text AS id, d.title_sw AS title, d.status, d.updated_at
      FROM document_drafts d
      LEFT JOIN entity_index ei
        ON ei.tenant_id   = d.tenant_id
       AND ei.entity_kind = 'royalty_draft'
       AND ei.entity_id   = d.id::text
     WHERE d.kind = 'royalty'
       AND (ei.refreshed_at IS NULL OR ei.refreshed_at < d.updated_at)
     ORDER BY d.updated_at ASC
     LIMIT ${limit}
  `,
  parseRow(row) {
    const tenantId = strOrEmpty(row.tenant_id);
    const id = strOrEmpty(row.id);
    if (!tenantId || !id) return null;
    const title = strOrEmpty(row.title);
    const status = strOrEmpty(row.status);
    return {
      tenantId,
      entityId: id,
      displayName: title || `Royalty draft ${id.slice(0, 8)}`,
      textForEmbedding: [title, 'royalty', status].filter(Boolean).join(' '),
      tags: [`kind:royalty`, `status:${status}`].filter((t) => !t.endsWith(':')),
      summary: `Royalty draft "${title}" — ${status}`,
      lifecycleStage: lifecycleFromStatus(status),
      sourceUpdatedAt: parseDate(row.updated_at),
    };
  },
};

const INDEXABLE_KINDS: ReadonlyArray<IndexableKind> = Object.freeze([
  LICENCE_KIND,
  SITE_KIND,
  REMINDER_KIND,
  ROYALTY_DRAFT_KIND,
]);

// ─── Embedding adapter (OpenAI text-embedding-3-small) ───────────────

let warnedNoEmbedKey = false;

async function defaultEmbedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !text.trim()) {
    if (!warnedNoEmbedKey && !apiKey) {
      warnedNoEmbedKey = true;
    }
    return null;
  }
  try {
    const response = await fetch(OPENAI_EMBED_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_EMBED_MODEL,
        input: text.slice(0, 8000),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const vec = body.data?.[0]?.embedding;
    if (!vec || vec.length !== EMBEDDING_DIM) return null;
    return vec;
  } catch {
    return null;
  }
}

// ─── DB helpers ──────────────────────────────────────────────────────

function rowsOf(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function embeddingLiteral(vec: number[] | null): string | null {
  if (!vec) return null;
  return `[${vec.join(',')}]`;
}

async function upsertEntityIndexRow(
  db: DbLike,
  row: IndexableRow,
  entityKind: string,
  embedding: number[] | null,
  now: Date,
): Promise<void> {
  const embLit = embeddingLiteral(embedding);
  await db.execute(sql`
    INSERT INTO entity_index
      (tenant_id, entity_kind, entity_id, display_name, embedding,
       tags, summary, lifecycle_stage, updated_at, refreshed_at)
    VALUES (
      ${row.tenantId},
      ${entityKind},
      ${row.entityId},
      ${row.displayName},
      ${embLit}::vector,
      ${row.tags as unknown as string[]}::text[],
      ${row.summary},
      ${row.lifecycleStage}::entity_lifecycle_stage,
      ${row.sourceUpdatedAt.toISOString()}::timestamptz,
      ${now.toISOString()}::timestamptz
    )
    ON CONFLICT (tenant_id, entity_kind, entity_id) DO UPDATE
      SET display_name    = EXCLUDED.display_name,
          embedding       = COALESCE(EXCLUDED.embedding, entity_index.embedding),
          tags            = EXCLUDED.tags,
          summary         = EXCLUDED.summary,
          lifecycle_stage = EXCLUDED.lifecycle_stage,
          updated_at      = EXCLUDED.updated_at,
          refreshed_at    = EXCLUDED.refreshed_at
  `);
}

async function upsertCrossReferences(
  db: DbLike,
  args: {
    readonly tenantId: string;
    readonly kind: string;
    readonly id: string;
    readonly now: Date;
  },
): Promise<number> {
  const edges = await discoverEdges(db, {
    tenantId: args.tenantId,
    kind: args.kind,
    id: args.id,
  });
  let upserted = 0;
  for (const edge of edges) {
    try {
      await db.execute(sql`
        INSERT INTO entity_cross_references
          (tenant_id, source_kind, source_id, target_kind, target_id,
           relationship, confidence, derived_at, derivation_source, metadata)
        VALUES (
          ${edge.tenantId},
          ${edge.sourceKind},
          ${edge.sourceId},
          ${edge.targetKind},
          ${edge.targetId},
          ${edge.relationship}::entity_cross_ref_relationship,
          ${edge.confidence.toFixed(3)}::numeric,
          ${args.now.toISOString()}::timestamptz,
          ${edge.derivationSource},
          ${JSON.stringify(edge.metadata ?? {})}::jsonb
        )
        ON CONFLICT (tenant_id, source_kind, source_id, target_kind, target_id, relationship)
        DO UPDATE
          SET confidence        = EXCLUDED.confidence,
              derived_at        = EXCLUDED.derived_at,
              derivation_source = EXCLUDED.derivation_source,
              metadata          = EXCLUDED.metadata
      `);
      upserted += 1;
    } catch {
      // Per-edge failure does not poison the batch.
    }
  }
  return upserted;
}

// ─── Main loop ───────────────────────────────────────────────────────

export function createEntityIndexerWorker(
  options: EntityIndexerOptions,
): EntityIndexerHandle {
  const envIntervalMs = Number(process.env.BORJIE_ENTITY_INDEXER_INTERVAL_MS);
  const intervalMs = Math.max(
    60_000,
    options.intervalMs ??
      (Number.isFinite(envIntervalMs) && envIntervalMs > 0
        ? envIntervalMs
        : DEFAULT_INTERVAL_MS),
  );
  const enabled =
    options.enabled ??
    (process.env.NODE_ENV !== 'test' &&
      process.env.BORJIE_ENTITY_INDEXER_DISABLED !== 'true');
  const now = options.now ?? (() => new Date());
  const embedText = options.embedText ?? defaultEmbedText;
  const batchPerKind = options.batchPerKind ?? DEFAULT_BATCH_PER_KIND;

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function indexKind(
    kindSpec: IndexableKind,
    nowTs: Date,
    counters: {
      indexedCount: number;
      edgesUpserted: number;
      failedRows: number;
      perKindCounts: Record<string, number>;
    },
  ): Promise<void> {
    let rows: readonly Record<string, unknown>[];
    try {
      const res = await options.db.execute(kindSpec.sourceQuery(batchPerKind));
      rows = rowsOf(res);
    } catch (err) {
      options.logger.warn(
        {
          worker: 'entity-indexer',
          kind: kindSpec.entityKind,
          err: err instanceof Error ? err.message : String(err),
        },
        'entity-indexer: fetch failed',
      );
      return;
    }
    let kindCount = 0;
    for (const raw of rows) {
      const parsed = kindSpec.parseRow(raw);
      if (!parsed) {
        counters.failedRows += 1;
        continue;
      }
      try {
        const embedding = await embedText(parsed.textForEmbedding);
        await upsertEntityIndexRow(
          options.db,
          parsed,
          kindSpec.entityKind,
          embedding,
          nowTs,
        );
        counters.indexedCount += 1;
        kindCount += 1;
        const edgeCount = await upsertCrossReferences(options.db, {
          tenantId: parsed.tenantId,
          kind: kindSpec.entityKind,
          id: parsed.entityId,
          now: nowTs,
        });
        counters.edgesUpserted += edgeCount;
      } catch (err) {
        counters.failedRows += 1;
        options.logger.warn(
          {
            worker: 'entity-indexer',
            kind: kindSpec.entityKind,
            entityId: parsed.entityId,
            err: err instanceof Error ? err.message : String(err),
          },
          'entity-indexer: upsert failed',
        );
      }
    }
    counters.perKindCounts[kindSpec.entityKind] = kindCount;
  }

  async function tickOnce(): Promise<EntityIndexerTickResult> {
    const counters = {
      indexedCount: 0,
      edgesUpserted: 0,
      failedRows: 0,
      perKindCounts: {} as Record<string, number>,
    };
    if (running) return counters;
    running = true;
    const started = Date.now();
    try {
      const ts = now();
      for (const kindSpec of INDEXABLE_KINDS) {
        await indexKind(kindSpec, ts, counters);
      }
      if (counters.indexedCount > 0 || counters.failedRows > 0) {
        options.logger.info(
          {
            worker: 'entity-indexer',
            durationMs: Date.now() - started,
            ...counters,
          },
          'entity-indexer: tick complete',
        );
      }
      // G6 — heartbeat on the success path.
      workerHeartbeat('entity-indexer');
    } catch (err) {
      workerHeartbeatFailure('entity-indexer', err);
      throw err;
    } finally {
      running = false;
    }
    return counters;
  }

  return {
    start(): void {
      if (!enabled) {
        options.logger.info(
          { worker: 'entity-indexer' },
          'entity-indexer: disabled by config',
        );
        return;
      }
      if (timer) return;
      // G6 — register before the first tick.
      registerWorker({ name: 'entity-indexer', intervalMs });
      timer = setInterval(() => {
        tickOnce().catch((err) => {
          options.logger.error(
            {
              worker: 'entity-indexer',
              err: err instanceof Error ? err.message : String(err),
            },
            'entity-indexer: tick threw',
          );
        });
      }, intervalMs);
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref();
      }
      options.logger.info(
        { worker: 'entity-indexer', intervalMs },
        'entity-indexer: started',
      );
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tickOnce,
  };
}
