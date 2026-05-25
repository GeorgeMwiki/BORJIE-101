/**
 * Sandbox Store — in-memory session cache for sandbox estates.
 *
 * Keyed by session id (`mk_*`). Each entry has a lastAccessedAt timestamp.
 * Entries are garbage-collected when they have not been read or written
 * for `idleTtlMs` (default 30 minutes).
 *
 * This is deliberately NOT backed by Redis or Postgres: sandboxes are
 * ephemeral by design. A gateway restart wipes them all — prospects just
 * create another one, which takes a second.
 */

import type { SandboxEstate } from './sandbox-estate-generator.js';

interface StoreEntry {
  readonly estate: SandboxEstate;
  readonly lastAccessedAt: number;
}

export interface SandboxStore {
  readonly entries: Map<string, StoreEntry>;
  readonly idleTtlMs: number;
}

export function createSandboxStore(
  opts: { readonly idleTtlMs?: number } = {}
): SandboxStore {
  return {
    entries: new Map(),
    idleTtlMs: opts.idleTtlMs ?? 30 * 60 * 1000,
  };
}

export function putSandbox(
  store: SandboxStore,
  estate: SandboxEstate,
  now: Date = new Date()
): void {
  store.entries.set(estate.sessionId, {
    estate,
    lastAccessedAt: now.getTime(),
  });
}

export function getSandbox(
  store: SandboxStore,
  sessionId: string,
  now: Date = new Date()
): SandboxEstate | null {
  const entry = store.entries.get(sessionId);
  if (!entry) return null;
  const idle = now.getTime() - entry.lastAccessedAt;
  if (idle > store.idleTtlMs) {
    store.entries.delete(sessionId);
    return null;
  }
  // Touch on access so GC is activity-based, not create-time.
  store.entries.set(sessionId, {
    estate: entry.estate,
    lastAccessedAt: now.getTime(),
  });
  return entry.estate;
}

export function deleteSandbox(store: SandboxStore, sessionId: string): boolean {
  return store.entries.delete(sessionId);
}

/** Garbage-collect expired entries. Returns number of removed sessions. */
export function gcSandboxes(store: SandboxStore, now: Date = new Date()): number {
  let removed = 0;
  for (const [sid, entry] of store.entries) {
    if (now.getTime() - entry.lastAccessedAt > store.idleTtlMs) {
      store.entries.delete(sid);
      removed += 1;
    }
  }
  return removed;
}

export function sandboxCount(store: SandboxStore): number {
  return store.entries.size;
}
