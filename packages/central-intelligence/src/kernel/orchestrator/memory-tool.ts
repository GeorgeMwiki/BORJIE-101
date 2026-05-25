/**
 * Anthropic `/memories` tool wiring — file-based per-thread scratchpad.
 *
 * This is NOT the same as the LITFIN four-tier domain memory hierarchy
 * (episodic / semantic / procedural / reflective) — those store
 * *property-management* facts. The `/memories` primitive is the MD's
 * OWN working notebook: a chunk of files, scoped to one thread, that
 * the MD reads + writes between turns to remember its plan, partial
 * computations, intermediate tool outputs, etc.
 *
 * Storage shape:
 *
 *   /memories/thread_<threadId>/
 *   ├── plan.md
 *   ├── scratch.md
 *   └── tool-cache/<callId>.json
 *
 * Canonical API surface mirrors Anthropic's `memory_20250818` tool
 * contract — `view / create / str_replace / insert / delete / rename`.
 * Legacy aliases (`read / write / list`) remain as deprecated re-exports
 * so callers wired in Phase E.1 keep working through one release.
 *
 * The port is pure-async — composition root wires an S3 / local-disk /
 * Postgres-jsonb adapter; tests use the in-memory implementation.
 */

import type { ScopeContext } from '../../types.js';

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  readonly path: string;
  readonly content: string;
  readonly updatedAt: string;
}

export interface MemoryRecallArgs {
  readonly scope: ScopeContext;
  /** Optional path prefix to filter — default returns the whole thread. */
  readonly prefix?: string;
  /** Max entries returned. */
  readonly limit?: number;
}

export interface MemoryRecallResult {
  readonly entries: ReadonlyArray<MemoryEntry>;
  readonly totalBytes: number;
}

/**
 * View outcome — either a single file's content, or a directory listing
 * of immediate children. Mirrors the canonical `memory_20250818.view`
 * return shape: a string for a file, an array of paths for a directory.
 */
export type MemoryViewResult =
  | { readonly kind: 'file'; readonly entry: MemoryEntry }
  | { readonly kind: 'directory'; readonly paths: ReadonlyArray<string> }
  | { readonly kind: 'not-found' };

/**
 * Error raised when a canonical mutation precondition fails — e.g.
 * `create` on an existing path, `str_replace` where `old_str` is not
 * present, `insert` at an out-of-range line.
 */
export class MemoryPreconditionError extends Error {
  constructor(
    public readonly code:
      | 'already-exists'
      | 'not-found'
      | 'old-str-missing'
      | 'old-str-ambiguous'
      | 'line-out-of-range',
    message: string,
  ) {
    super(message);
    this.name = 'MemoryPreconditionError';
  }
}

/**
 * Canonical Anthropic `memory_20250818` tool surface.
 *
 * Every method is threadId-scoped (so the orchestrator can route a
 * single MemoryTool instance across many concurrent sessions without
 * leaking state) and async (so the adapter can be backed by S3,
 * Postgres-jsonb, or the local disk).
 */
export interface MemoryTool {
  /** Bulk recall used by the orchestrator at the start of each tick. */
  recall(args: MemoryRecallArgs): Promise<MemoryRecallResult>;

  /**
   * Canonical `view(path)` — returns file content if `path` is a file,
   * a listing if `path` is a directory, or `not-found` otherwise.
   */
  view(threadId: string, path: string): Promise<MemoryViewResult>;

  /**
   * Canonical `create(path, content)` — fails with
   * `MemoryPreconditionError('already-exists')` if the file already
   * exists. To overwrite, callers should `delete` then `create`, or use
   * the legacy `write` alias which is upsert-style.
   */
  create(
    threadId: string,
    path: string,
    content: string,
  ): Promise<MemoryEntry>;

  /**
   * Canonical `str_replace(path, old_str, new_str)` — replaces the
   * single occurrence of `old_str` inside the file at `path` with
   * `new_str`. Fails when the file does not exist, when `old_str` is
   * missing, or when it appears more than once (ambiguous edit).
   */
  str_replace(
    threadId: string,
    path: string,
    old_str: string,
    new_str: string,
  ): Promise<MemoryEntry>;

  /**
   * Canonical `insert(path, line, content)` — inserts `content` (a new
   * line of text) at the given 1-based line number inside the file. A
   * `line` equal to `lineCount + 1` appends. Fails when the file does
   * not exist or the line is out of range.
   */
  insert(
    threadId: string,
    path: string,
    line: number,
    content: string,
  ): Promise<MemoryEntry>;

  /**
   * Canonical `delete(path)` — returns `true` when an entry was
   * removed, `false` when the path did not exist. Directory deletes
   * (no trailing path) wipe every entry under the prefix.
   */
  delete(threadId: string, path: string): Promise<boolean>;

  /**
   * Canonical `rename(path, new_path)` — moves the entry under a new
   * key. Fails when the source is missing or the destination exists.
   */
  rename(
    threadId: string,
    path: string,
    new_path: string,
  ): Promise<MemoryEntry>;

  // ───────────────────────────────────────────────────────────────────
  // Legacy aliases — DEPRECATED. Will be removed in a follow-up release
  // once every caller has migrated to the canonical names above. Kept
  // here as upsert-style adapters so Phase E.1 wires keep working.
  // ───────────────────────────────────────────────────────────────────

  /**
   * @deprecated Use `view()` instead — returns the raw entry or null.
   */
  read(threadId: string, path: string): Promise<MemoryEntry | null>;

  /**
   * @deprecated Use `create()` (or `delete` + `create` for upsert).
   * Legacy semantics: writes always succeed, overwriting any existing
   * entry at `path`.
   */
  write(
    threadId: string,
    path: string,
    content: string,
  ): Promise<MemoryEntry>;

  /**
   * @deprecated Use `view()` against a directory path instead.
   */
  list(
    threadId: string,
    prefix?: string,
  ): Promise<ReadonlyArray<string>>;
}

// ─────────────────────────────────────────────────────────────────────
// Path safety — defence-in-depth so a hostile path escape (..) can't
// reach another thread's memory bucket.
// ─────────────────────────────────────────────────────────────────────

export class MemoryPathError extends Error {
  constructor(public readonly path: string) {
    super(`unsafe memory path: ${path}`);
    this.name = 'MemoryPathError';
  }
}

export function safeMemoryPath(threadId: string, raw: string): string {
  if (!threadId || /[^a-zA-Z0-9_\-]/.test(threadId)) {
    throw new MemoryPathError(threadId);
  }
  const trimmed = raw.replace(/^\/+/, '');
  if (trimmed.includes('..') || trimmed.includes('\\')) {
    throw new MemoryPathError(raw);
  }
  return `/memories/thread_${threadId}/${trimmed}`;
}

// ─────────────────────────────────────────────────────────────────────
// In-memory MemoryTool — test fixture + early composition.
// ─────────────────────────────────────────────────────────────────────

/**
 * H7 — Bounds on the in-memory adapter so a long-running thread cannot
 * accumulate unbounded `/memories` scratch storage. Production adapters
 * (S3, Postgres-jsonb) MUST enforce a similar cap.
 */
export interface InMemoryMemoryToolBounds {
  /** Maximum total entries across all threads (LRU eviction). Default 1000. */
  readonly maxEntries?: number;
  /** Optional TTL in ms; entries older than this are evicted on access. */
  readonly entryTtlMs?: number;
  /** Optional counter sink — called with the current store size after every write. */
  readonly onSizeChange?: (size: number) => void;
}

const DEFAULT_MAX_ENTRIES = 1000;

export function createInMemoryMemoryTool(
  clock: () => Date = () => new Date(),
  bounds: InMemoryMemoryToolBounds = {},
): MemoryTool {
  // Map keeps insertion order. We exploit that for an LRU: every write
  // (re-)inserts the key at the end, and eviction takes the oldest.
  const store = new Map<string, MemoryEntry>();
  const maxEntries = bounds.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const ttlMs = bounds.entryTtlMs;
  const onSizeChange = bounds.onSizeChange;

  function threadIdOfScope(scope: ScopeContext): string {
    return scope.kind === 'platform' ? '_platform' : scope.tenantId;
  }

  /**
   * H7 — Centralised LRU touch. After any write that creates or
   * updates a key, we delete-then-set so the key moves to the tail of
   * the insertion order, AND evict from the head if size exceeds the
   * cap.
   */
  function touchAndEnforceLru(key: string, entry: MemoryEntry): void {
    store.delete(key);
    store.set(key, entry);
    while (store.size > maxEntries) {
      const oldest = store.keys().next();
      if (oldest.done) break;
      store.delete(oldest.value);
    }
    onSizeChange?.(store.size);
  }

  /**
   * H7 — TTL sweep on access. Cheap O(n) but bounded by maxEntries; we
   * only call this when ttlMs is configured.
   */
  function expireIfTtl(): void {
    if (!ttlMs) return;
    const nowMs = clock().getTime();
    for (const [key, entry] of store) {
      const entryMs = Date.parse(entry.updatedAt);
      if (Number.isFinite(entryMs) && nowMs - entryMs > ttlMs) {
        store.delete(key);
      }
    }
  }

  async function recall(
    args: MemoryRecallArgs,
  ): Promise<MemoryRecallResult> {
    expireIfTtl();
    const threadId = threadIdOfScope(args.scope);
    const prefix = safeMemoryPath(threadId, args.prefix ?? '');
    const entries: MemoryEntry[] = [];
    let totalBytes = 0;
    for (const [path, entry] of store) {
      if (!path.startsWith(prefix)) continue;
      entries.push(entry);
      totalBytes += entry.content.length;
      if (args.limit && entries.length >= args.limit) break;
    }
    return { entries, totalBytes };
  }

  async function view(
    threadId: string,
    path: string,
  ): Promise<MemoryViewResult> {
    const full = safeMemoryPath(threadId, path);
    const fileHit = store.get(full);
    if (fileHit) {
      return { kind: 'file', entry: fileHit };
    }
    // Treat as directory query — list immediate descendants by prefix.
    const prefix = full.endsWith('/') ? full : `${full}/`;
    const matches: string[] = [];
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) matches.push(key);
    }
    if (matches.length > 0) {
      return { kind: 'directory', paths: matches };
    }
    return { kind: 'not-found' };
  }

  async function create(
    threadId: string,
    path: string,
    content: string,
  ): Promise<MemoryEntry> {
    const full = safeMemoryPath(threadId, path);
    if (store.has(full)) {
      throw new MemoryPreconditionError(
        'already-exists',
        `entry already exists at ${path}`,
      );
    }
    const entry: MemoryEntry = {
      path: full,
      content,
      updatedAt: clock().toISOString(),
    };
    touchAndEnforceLru(full, entry);
    return entry;
  }

  async function str_replace(
    threadId: string,
    path: string,
    old_str: string,
    new_str: string,
  ): Promise<MemoryEntry> {
    const full = safeMemoryPath(threadId, path);
    const existing = store.get(full);
    if (!existing) {
      throw new MemoryPreconditionError(
        'not-found',
        `no entry at ${path}`,
      );
    }
    const firstIdx = existing.content.indexOf(old_str);
    if (firstIdx === -1) {
      throw new MemoryPreconditionError(
        'old-str-missing',
        `old_str not found in ${path}`,
      );
    }
    const secondIdx = existing.content.indexOf(
      old_str,
      firstIdx + old_str.length,
    );
    if (secondIdx !== -1) {
      throw new MemoryPreconditionError(
        'old-str-ambiguous',
        `old_str appears multiple times in ${path}`,
      );
    }
    const updated: MemoryEntry = {
      path: full,
      content:
        existing.content.slice(0, firstIdx) +
        new_str +
        existing.content.slice(firstIdx + old_str.length),
      updatedAt: clock().toISOString(),
    };
    touchAndEnforceLru(full, updated);
    return updated;
  }

  async function insert(
    threadId: string,
    path: string,
    line: number,
    content: string,
  ): Promise<MemoryEntry> {
    const full = safeMemoryPath(threadId, path);
    const existing = store.get(full);
    if (!existing) {
      throw new MemoryPreconditionError(
        'not-found',
        `no entry at ${path}`,
      );
    }
    const lines = existing.content.length === 0
      ? []
      : existing.content.split('\n');
    if (line < 1 || line > lines.length + 1) {
      throw new MemoryPreconditionError(
        'line-out-of-range',
        `line ${line} out of range (1..${lines.length + 1})`,
      );
    }
    const next = [...lines.slice(0, line - 1), content, ...lines.slice(line - 1)];
    const updated: MemoryEntry = {
      path: full,
      content: next.join('\n'),
      updatedAt: clock().toISOString(),
    };
    touchAndEnforceLru(full, updated);
    return updated;
  }

  async function del(
    threadId: string,
    path: string,
  ): Promise<boolean> {
    const full = safeMemoryPath(threadId, path);
    if (store.has(full)) {
      store.delete(full);
      return true;
    }
    // Directory delete — drop every key under the prefix.
    const prefix = full.endsWith('/') ? full : `${full}/`;
    let removed = false;
    for (const key of [...store.keys()]) {
      if (key.startsWith(prefix)) {
        store.delete(key);
        removed = true;
      }
    }
    return removed;
  }

  async function rename(
    threadId: string,
    path: string,
    new_path: string,
  ): Promise<MemoryEntry> {
    const src = safeMemoryPath(threadId, path);
    const dst = safeMemoryPath(threadId, new_path);
    const existing = store.get(src);
    if (!existing) {
      throw new MemoryPreconditionError(
        'not-found',
        `no entry at ${path}`,
      );
    }
    if (store.has(dst)) {
      throw new MemoryPreconditionError(
        'already-exists',
        `destination already exists at ${new_path}`,
      );
    }
    const next: MemoryEntry = {
      path: dst,
      content: existing.content,
      updatedAt: clock().toISOString(),
    };
    store.delete(src);
    touchAndEnforceLru(dst, next);
    return next;
  }

  // Legacy aliases — upsert-style adapters around the canonical surface.

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
    const entry: MemoryEntry = {
      path: full,
      content,
      updatedAt: clock().toISOString(),
    };
    touchAndEnforceLru(full, entry);
    return entry;
  }

  async function list(
    threadId: string,
    prefix?: string,
  ): Promise<ReadonlyArray<string>> {
    const base = safeMemoryPath(threadId, prefix ?? '');
    return [...store.keys()].filter((k) => k.startsWith(base));
  }

  return {
    recall,
    view,
    create,
    str_replace,
    insert,
    delete: del,
    rename,
    read,
    write,
    list,
  };
}
