/**
 * Drizzle-backed `MemoryTool` — durable agent `/memories` notebook.
 *
 * Implements the central-intelligence kernel's canonical Anthropic
 * `memory_20250818` tool surface (kernel/orchestrator/memory-tool.ts) against
 * the `agent_memory` table (migration 0302), so the agent's working notebook
 * survives restarts and is shared across replicas — replacing the in-memory
 * LRU adapter the kernel falls back to today. Once bound as
 * `composeSovereign({ orchestrator: { memoryTool } })`, the kernel's main-loop
 * `memoryTool.recall({ scope })` (start of every tick) and every
 * view/create/str_replace/insert/delete/rename reads + writes REAL persisted
 * rows.
 *
 * SCOPE → ROW MAPPING. The kernel derives a `threadId` from the request scope
 * exactly as the in-memory adapter does: `scope.kind === 'platform'
 * ? '_platform' : scope.tenantId`. So the port's `threadId` parameter IS the
 * tenant scope key. This adapter therefore uses `threadId` as BOTH:
 *   - the RLS tenant binding (`withTenantContext(db, threadId, …)`), and
 *   - the `agent_id` column value.
 * The normalised, traversal-safe path (`safeMemoryPath`) becomes `mem_key`,
 * and `{ content, updatedAt }` becomes the `mem_value` jsonb. Platform-scope
 * threads bind the '_platform' sentinel tenant (migration 0302).
 *
 * TENANT ISOLATION (two layers):
 *   1. RLS — `agent_memory` FORCE-enables row-level security on the canonical
 *      `app.current_tenant_id` GUC; every op runs inside `withTenantContext`
 *      so the GUC is bound on the checked-out connection (kernel memory ops
 *      happen outside the request `databaseMiddleware`).
 *   2. Defence-in-depth — every query filters by `tenant_id = threadId` AND
 *      `agent_id = threadId`, and every write carries them on the row.
 *
 * PATH SAFETY — `safeMemoryPath` (imported from the kernel package) rejects
 * `..` / backslash / unsafe thread ids BEFORE any SQL, so a hostile path can
 * never reach another thread's rows.
 *
 * Canonical preconditions are reproduced faithfully: `create` →
 * 'already-exists'; `str_replace` → 'not-found' / 'old-str-missing' /
 * 'old-str-ambiguous'; `insert` → 'not-found' / 'line-out-of-range';
 * `rename` → 'not-found' / 'already-exists' — all raised as the kernel's
 * `MemoryPreconditionError` so callers branch identically to the in-memory
 * adapter.
 *
 * No `console.log` — errors propagate (the kernel main-loop handles them).
 */

import { and, asc, eq, like } from 'drizzle-orm';
import { agentMemory, withTenantContext } from '@borjie/database';
// The Anthropic `memory_20250818` tool surface is exported from the package
// under the `orchestrator` namespace (the main barrel re-exports `export * as
// orchestrator`). We alias the runtime helpers + types we need so the rest of
// this file reads like the in-memory adapter it mirrors.
import { orchestrator } from '@borjie/central-intelligence';
import type { ScopeContext } from '@borjie/central-intelligence';

const { safeMemoryPath, MemoryPreconditionError } = orchestrator;
type MemoryTool = orchestrator.MemoryTool;
type MemoryEntry = orchestrator.MemoryEntry;
type MemoryRecallArgs = orchestrator.MemoryRecallArgs;
type MemoryRecallResult = orchestrator.MemoryRecallResult;
type MemoryViewResult = orchestrator.MemoryViewResult;

/**
 * Drizzle client seam — `any` at the builder boundary to dodge the TS2709
 * namespace/type drift through the `@borjie/database` barrel (same idiom as
 * `stage/drizzle-stage-advisor-db.ts`). Every row is mapped through an
 * explicit converter so callers stay typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DrizzleLike = any;

interface StoredRow {
  readonly memKey: string;
  readonly memValue: { readonly content?: unknown; readonly updatedAt?: unknown };
}

function rowToEntry(row: StoredRow): MemoryEntry {
  const value = row.memValue ?? {};
  return {
    path: row.memKey,
    content: typeof value.content === 'string' ? value.content : '',
    updatedAt:
      typeof value.updatedAt === 'string' && value.updatedAt !== ''
        ? value.updatedAt
        : new Date(0).toISOString(),
  };
}

/** Derive the tenant/agent scope key from a recall ScopeContext. */
function threadIdOfScope(scope: ScopeContext): string {
  return scope.kind === 'platform' ? '_platform' : scope.tenantId;
}

export interface CreateDrizzleMemoryToolOptions {
  /** Inject the current time (deterministic timestamps in tests). */
  readonly now?: () => Date;
}

/**
 * Build the Drizzle-backed MemoryTool. `db` is the gateway's singleton
 * Drizzle client (`getDb()`). When `db` is null this throws on construction —
 * the composition root should only wire this adapter when a DB is present and
 * otherwise leave the kernel on its in-memory default.
 */
export function createDrizzleMemoryTool(
  db: DrizzleLike,
  options: CreateDrizzleMemoryToolOptions = {},
): MemoryTool {
  if (!db) {
    throw new Error(
      'createDrizzleMemoryTool requires a non-null Drizzle client',
    );
  }
  const now = options.now ?? (() => new Date());

  /** Run `fn` with the tenant GUC bound to the thread's scope key. */
  function inScope<T>(
    threadId: string,
    fn: (tx: DrizzleLike) => Promise<T>,
  ): Promise<T> {
    return withTenantContext(db, threadId, fn);
  }

  async function getRow(
    tx: DrizzleLike,
    threadId: string,
    fullPath: string,
  ): Promise<StoredRow | null> {
    const rows = (await tx
      .select({
        memKey: agentMemory.memKey,
        memValue: agentMemory.memValue,
      })
      .from(agentMemory)
      .where(
        and(
          eq(agentMemory.tenantId, threadId),
          eq(agentMemory.agentId, threadId),
          eq(agentMemory.memKey, fullPath),
        ),
      )
      .limit(1)) as ReadonlyArray<StoredRow>;
    return rows[0] ?? null;
  }

  async function upsert(
    tx: DrizzleLike,
    threadId: string,
    fullPath: string,
    content: string,
  ): Promise<MemoryEntry> {
    const updatedAt = now().toISOString();
    await tx
      .insert(agentMemory)
      .values({
        tenantId: threadId,
        agentId: threadId,
        memKey: fullPath,
        memValue: { content, updatedAt },
        updatedAt: now(),
      })
      .onConflictDoUpdate({
        target: [agentMemory.tenantId, agentMemory.agentId, agentMemory.memKey],
        set: { memValue: { content, updatedAt }, updatedAt: now() },
      });
    return { path: fullPath, content, updatedAt };
  }

  async function recall(
    args: MemoryRecallArgs,
  ): Promise<MemoryRecallResult> {
    const threadId = threadIdOfScope(args.scope);
    const prefix = safeMemoryPath(threadId, args.prefix ?? '');
    return inScope(threadId, async (tx) => {
      const rows = (await tx
        .select({
          memKey: agentMemory.memKey,
          memValue: agentMemory.memValue,
        })
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.tenantId, threadId),
            eq(agentMemory.agentId, threadId),
            like(agentMemory.memKey, `${prefix}%`),
          ),
        )
        .orderBy(asc(agentMemory.memKey))) as ReadonlyArray<StoredRow>;

      const limited =
        args.limit && args.limit > 0 ? rows.slice(0, args.limit) : rows;
      const entries = limited.map(rowToEntry);
      const totalBytes = entries.reduce((sum, e) => sum + e.content.length, 0);
      return { entries, totalBytes };
    });
  }

  async function view(
    threadId: string,
    path: string,
  ): Promise<MemoryViewResult> {
    const full = safeMemoryPath(threadId, path);
    return inScope(threadId, async (tx) => {
      const hit = await getRow(tx, threadId, full);
      if (hit) return { kind: 'file', entry: rowToEntry(hit) };

      // Directory query — list immediate descendants by prefix.
      const dirPrefix = full.endsWith('/') ? full : `${full}/`;
      const rows = (await tx
        .select({ memKey: agentMemory.memKey })
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.tenantId, threadId),
            eq(agentMemory.agentId, threadId),
            like(agentMemory.memKey, `${dirPrefix}%`),
          ),
        )
        .orderBy(asc(agentMemory.memKey))) as ReadonlyArray<{ memKey: string }>;
      if (rows.length > 0) {
        return { kind: 'directory', paths: rows.map((r) => r.memKey) };
      }
      return { kind: 'not-found' };
    });
  }

  async function create(
    threadId: string,
    path: string,
    content: string,
  ): Promise<MemoryEntry> {
    const full = safeMemoryPath(threadId, path);
    return inScope(threadId, async (tx) => {
      const existing = await getRow(tx, threadId, full);
      if (existing) {
        throw new MemoryPreconditionError(
          'already-exists',
          `entry already exists at ${path}`,
        );
      }
      return upsert(tx, threadId, full, content);
    });
  }

  async function strReplace(
    threadId: string,
    path: string,
    old_str: string,
    new_str: string,
  ): Promise<MemoryEntry> {
    const full = safeMemoryPath(threadId, path);
    return inScope(threadId, async (tx) => {
      const existing = await getRow(tx, threadId, full);
      if (!existing) {
        throw new MemoryPreconditionError('not-found', `no entry at ${path}`);
      }
      const content = rowToEntry(existing).content;
      const firstIdx = content.indexOf(old_str);
      if (firstIdx === -1) {
        throw new MemoryPreconditionError(
          'old-str-missing',
          `old_str not found in ${path}`,
        );
      }
      const secondIdx = content.indexOf(old_str, firstIdx + old_str.length);
      if (secondIdx !== -1) {
        throw new MemoryPreconditionError(
          'old-str-ambiguous',
          `old_str appears multiple times in ${path}`,
        );
      }
      const next =
        content.slice(0, firstIdx) +
        new_str +
        content.slice(firstIdx + old_str.length);
      return upsert(tx, threadId, full, next);
    });
  }

  async function insert(
    threadId: string,
    path: string,
    line: number,
    content: string,
  ): Promise<MemoryEntry> {
    const full = safeMemoryPath(threadId, path);
    return inScope(threadId, async (tx) => {
      const existing = await getRow(tx, threadId, full);
      if (!existing) {
        throw new MemoryPreconditionError('not-found', `no entry at ${path}`);
      }
      const body = rowToEntry(existing).content;
      const lines = body.length === 0 ? [] : body.split('\n');
      if (line < 1 || line > lines.length + 1) {
        throw new MemoryPreconditionError(
          'line-out-of-range',
          `line ${line} out of range (1..${lines.length + 1})`,
        );
      }
      const next = [
        ...lines.slice(0, line - 1),
        content,
        ...lines.slice(line - 1),
      ].join('\n');
      return upsert(tx, threadId, full, next);
    });
  }

  async function del(threadId: string, path: string): Promise<boolean> {
    const full = safeMemoryPath(threadId, path);
    return inScope(threadId, async (tx) => {
      const existing = await getRow(tx, threadId, full);
      if (existing) {
        await tx
          .delete(agentMemory)
          .where(
            and(
              eq(agentMemory.tenantId, threadId),
              eq(agentMemory.agentId, threadId),
              eq(agentMemory.memKey, full),
            ),
          );
        return true;
      }
      // Directory delete — drop every key under the prefix.
      const dirPrefix = full.endsWith('/') ? full : `${full}/`;
      const rows = (await tx
        .select({ memKey: agentMemory.memKey })
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.tenantId, threadId),
            eq(agentMemory.agentId, threadId),
            like(agentMemory.memKey, `${dirPrefix}%`),
          ),
        )) as ReadonlyArray<{ memKey: string }>;
      if (rows.length === 0) return false;
      await tx
        .delete(agentMemory)
        .where(
          and(
            eq(agentMemory.tenantId, threadId),
            eq(agentMemory.agentId, threadId),
            like(agentMemory.memKey, `${dirPrefix}%`),
          ),
        );
      return true;
    });
  }

  async function rename(
    threadId: string,
    path: string,
    new_path: string,
  ): Promise<MemoryEntry> {
    const src = safeMemoryPath(threadId, path);
    const dst = safeMemoryPath(threadId, new_path);
    return inScope(threadId, async (tx) => {
      const existing = await getRow(tx, threadId, src);
      if (!existing) {
        throw new MemoryPreconditionError('not-found', `no entry at ${path}`);
      }
      const collision = await getRow(tx, threadId, dst);
      if (collision) {
        throw new MemoryPreconditionError(
          'already-exists',
          `destination already exists at ${new_path}`,
        );
      }
      const content = rowToEntry(existing).content;
      const entry = await upsert(tx, threadId, dst, content);
      await tx
        .delete(agentMemory)
        .where(
          and(
            eq(agentMemory.tenantId, threadId),
            eq(agentMemory.agentId, threadId),
            eq(agentMemory.memKey, src),
          ),
        );
      return entry;
    });
  }

  // ── Legacy aliases (DEPRECATED, upsert-style) ──────────────────────────

  async function read(
    threadId: string,
    path: string,
  ): Promise<MemoryEntry | null> {
    const result = await view(threadId, path);
    return result.kind === 'file' ? result.entry : null;
  }

  async function write(
    threadId: string,
    path: string,
    content: string,
  ): Promise<MemoryEntry> {
    const full = safeMemoryPath(threadId, path);
    return inScope(threadId, (tx) => upsert(tx, threadId, full, content));
  }

  async function list(
    threadId: string,
    prefix?: string,
  ): Promise<ReadonlyArray<string>> {
    const base = safeMemoryPath(threadId, prefix ?? '');
    return inScope(threadId, async (tx) => {
      const rows = (await tx
        .select({ memKey: agentMemory.memKey })
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.tenantId, threadId),
            eq(agentMemory.agentId, threadId),
            like(agentMemory.memKey, `${base}%`),
          ),
        )
        .orderBy(asc(agentMemory.memKey))) as ReadonlyArray<{ memKey: string }>;
      return rows.map((r) => r.memKey);
    });
  }

  return Object.freeze({
    recall,
    view,
    create,
    str_replace: strReplace,
    insert,
    delete: del,
    rename,
    read,
    write,
    list,
  });
}
