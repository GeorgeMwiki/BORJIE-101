/**
 * MCP session checkpoint / resume.
 *
 * Persistent sessions across reconnects. Each session captures:
 *   - sessionId
 *   - oauth token id
 *   - last activity timestamp
 *   - a rolling "conversation summary" (the last 20 turns the dispatcher
 *     has observed)
 *   - free-form state JSON blob the client may push via session_state
 *
 * Backed by migration 0120 (mcp_sessions) — RLS isolates per token id
 * (which is tenant-scoped via oauth_agent_tokens). The api-gateway
 * adapter persists; this module owns the in-memory shape, checkpoint
 * cadence, and resume logic.
 */

const MAX_TURNS = 20;

export interface SessionTurn {
  readonly direction: 'request' | 'response' | 'notification';
  readonly method: string;
  readonly toolName?: string;
  readonly at: number;
  readonly summary: string;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly tokenId: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly conversationSummary: ReadonlyArray<SessionTurn>;
  readonly lastActivityAt: number;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface SessionStore {
  load(sessionId: string): Promise<SessionSnapshot | null>;
  save(snapshot: SessionSnapshot): Promise<void>;
  touch(sessionId: string, lastActivityAt: number): Promise<void>;
  drop(sessionId: string): Promise<void>;
}

/** Pure in-memory store used in tests. */
export function createInMemorySessionStore(): SessionStore {
  const sessions = new Map<string, SessionSnapshot>();
  const store: SessionStore = {
    async load(sessionId: string): Promise<SessionSnapshot | null> {
      return sessions.get(sessionId) ?? null;
    },
    async save(snapshot: SessionSnapshot): Promise<void> {
      sessions.set(snapshot.sessionId, snapshot);
    },
    async touch(sessionId: string, lastActivityAt: number): Promise<void> {
      const existing = sessions.get(sessionId);
      if (!existing) return;
      sessions.set(sessionId, Object.freeze({ ...existing, lastActivityAt }));
    },
    async drop(sessionId: string): Promise<void> {
      sessions.delete(sessionId);
    },
  };
  return Object.freeze(store);
}

export interface SessionCheckpointDeps {
  readonly store: SessionStore;
  readonly now?: () => number;
  readonly ttlMs?: number;
}

export interface SessionManager {
  resume(sessionId: string, tokenId: string): Promise<SessionSnapshot>;
  checkpoint(sessionId: string, turn: SessionTurn): Promise<SessionSnapshot>;
  setState(
    sessionId: string,
    tokenId: string,
    state: Readonly<Record<string, unknown>>,
  ): Promise<SessionSnapshot>;
  snapshot(sessionId: string): Promise<SessionSnapshot | null>;
  drop(sessionId: string): Promise<void>;
}

export function createSessionManager(deps: SessionCheckpointDeps): SessionManager {
  const now = deps.now ?? (() => Date.now());
  const ttlMs = deps.ttlMs ?? 24 * 60 * 60 * 1_000;

  async function fresh(sessionId: string, tokenId: string): Promise<SessionSnapshot> {
    const n = now();
    const snapshot: SessionSnapshot = Object.freeze({
      sessionId,
      tokenId,
      state: Object.freeze({}),
      conversationSummary: Object.freeze([]),
      lastActivityAt: n,
      createdAt: n,
      expiresAt: n + ttlMs,
    });
    await deps.store.save(snapshot);
    return snapshot;
  }

  const manager: SessionManager = {
    async resume(sessionId: string, tokenId: string): Promise<SessionSnapshot> {
      const existing = await deps.store.load(sessionId);
      if (!existing) return fresh(sessionId, tokenId);
      if (existing.tokenId !== tokenId) {
        // token mismatch — issue a fresh session under the new token.
        return fresh(sessionId, tokenId);
      }
      if (existing.expiresAt < now()) {
        await deps.store.drop(sessionId);
        return fresh(sessionId, tokenId);
      }
      await deps.store.touch(sessionId, now());
      return existing;
    },
    async checkpoint(sessionId: string, turn: SessionTurn): Promise<SessionSnapshot> {
      const loaded = await deps.store.load(sessionId);
      if (!loaded) {
        throw new Error(`session not found for checkpoint: ${sessionId}`);
      }
      const summary = [...loaded.conversationSummary, turn].slice(-MAX_TURNS);
      const n = now();
      const next: SessionSnapshot = Object.freeze({
        ...loaded,
        conversationSummary: Object.freeze(summary),
        lastActivityAt: n,
        expiresAt: n + ttlMs,
      });
      await deps.store.save(next);
      return next;
    },
    async setState(
      sessionId: string,
      tokenId: string,
      state: Readonly<Record<string, unknown>>,
    ): Promise<SessionSnapshot> {
      const loaded = await deps.store.load(sessionId);
      const merged: SessionSnapshot = Object.freeze({
        ...(loaded ?? (await fresh(sessionId, tokenId))),
        state: Object.freeze({ ...state }),
        lastActivityAt: now(),
      });
      await deps.store.save(merged);
      return merged;
    },
    async snapshot(sessionId: string): Promise<SessionSnapshot | null> {
      return deps.store.load(sessionId);
    },
    async drop(sessionId: string): Promise<void> {
      await deps.store.drop(sessionId);
    },
  };
  return Object.freeze(manager);
}
