/**
 * `FieldStateMirror` factory — the SERVER side of Tier II.
 *
 * Constructs a `FieldStateMirror` from a session_id by reading the
 * extended `passive_capture_events` table. The MD's tool layer calls
 * this once per turn and gets a fresh mirror; the mirror's methods are
 * thin wrappers over the row store.
 *
 * The factory is dependency-injected with a row store so it can be
 * exercised in tests without spinning up Postgres. Production wiring
 * lives in `@borjie/database` and passes the Drizzle-backed store.
 */

import type { FieldStateMirror, FieldValue } from '../types.js';

export interface FieldStateRow {
  readonly tabId: string;
  readonly fieldId: string;
  readonly capturedAt: string;
  readonly value: FieldValue;
}

export interface FieldStateRowStore {
  /** Return every captured field row for the session, newest first per (tabId, fieldId). */
  readonly latestForSession: (
    sessionId: string,
  ) => Promise<ReadonlyArray<FieldStateRow>>;
  /** Return the most recent row for a specific (tabId, fieldId). */
  readonly latestForField: (
    sessionId: string,
    tabId: string,
    fieldId: string,
  ) => Promise<FieldStateRow | null>;
  /** Block-wait for the next row beyond `since` (returns null on timeout). */
  readonly waitForNext: (args: {
    readonly sessionId: string;
    readonly tabId: string;
    readonly fieldId: string;
    readonly sinceIso: string;
    readonly timeoutMs: number;
  }) => Promise<FieldStateRow | null>;
}

export interface CreateFieldStateMirrorArgs {
  readonly sessionId: string;
  readonly store: FieldStateRowStore;
  /** Clock injection — defaults to `new Date().toISOString()`. */
  readonly now?: () => string;
}

export function createFieldStateMirror(
  args: CreateFieldStateMirrorArgs,
): FieldStateMirror {
  const now = args.now ?? (() => new Date().toISOString());

  async function read(
    tabId: string,
    fieldId: string,
  ): Promise<FieldValue | null> {
    const row = await args.store.latestForField(args.sessionId, tabId, fieldId);
    return row?.value ?? null;
  }

  async function snapshot(): Promise<ReadonlyMap<string, FieldValue>> {
    const rows = await args.store.latestForSession(args.sessionId);
    const map = new Map<string, FieldValue>();
    // Newest-first iteration; first hit wins. Key = `${tabId}::${fieldId}`.
    for (const row of rows) {
      const key = `${row.tabId}::${row.fieldId}`;
      if (!map.has(key)) {
        map.set(key, row.value);
      }
    }
    return map;
  }

  async function waitForChange(
    tabId: string,
    fieldId: string,
    timeoutMs: number,
  ): Promise<FieldValue | null> {
    const sinceIso = now();
    const row = await args.store.waitForNext({
      sessionId: args.sessionId,
      tabId,
      fieldId,
      sinceIso,
      timeoutMs,
    });
    return row?.value ?? null;
  }

  return { read, snapshot, waitForChange };
}
