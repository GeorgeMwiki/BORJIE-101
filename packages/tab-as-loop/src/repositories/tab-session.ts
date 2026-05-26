/**
 * In-memory `TabSessionRepository` + a SQL contract stub.
 *
 * Wave M5. Pure-memory adapter for unit + integration tests. The
 * database package wires the real Drizzle adapter against
 * `tab_sessions` from migration 0036; the contract there mirrors
 * this interface verbatim.
 *
 * All stored rows are frozen on insert to enforce immutability.
 */

import { randomUUID } from 'node:crypto';
import { computeTabAuditHash } from '../audit/audit-chain-link.js';
import { transitionTabLifecycle } from '../lifecycle/tab-lifecycle.js';
import type {
  OpenTabInput,
  TabLifecycleState,
  TabSession,
  TabSessionRepository,
} from '../types.js';
import { TAB_AS_LOOP_CONSTANTS } from '../types.js';

interface InMemoryTabSessionRepositoryDeps {
  readonly now: () => Date;
  readonly nextId: () => string;
}

export function createInMemoryTabSessionRepository(
  deps: Partial<InMemoryTabSessionRepositoryDeps> = {},
): TabSessionRepository {
  // Deps are retained for symmetry with the SQL adapter signature.
  // The in-memory adapter does not need them today but the contract
  // is identical.
  void deps;
  const rows = new Map<string, TabSession>();

  return {
    async insert(session: TabSession): Promise<TabSession> {
      const frozen = Object.freeze({ ...session });
      rows.set(frozen.id, frozen);
      return frozen;
    },

    async findById(tenantId: string, id: string): Promise<TabSession | null> {
      const row = rows.get(id);
      if (row === undefined || row.tenantId !== tenantId) return null;
      return row;
    },

    async listOpenForUser(
      tenantId: string,
      userId: string,
    ): Promise<ReadonlyArray<TabSession>> {
      const matches: TabSession[] = [];
      for (const row of rows.values()) {
        if (
          row.tenantId === tenantId &&
          row.userId === userId &&
          row.lifecycleState !== 'closed'
        ) {
          matches.push(row);
        }
      }
      return matches;
    },

    async replace(session: TabSession): Promise<void> {
      if (!rows.has(session.id)) return;
      rows.set(session.id, Object.freeze({ ...session }));
    },

    async listExpiring(at: Date): Promise<ReadonlyArray<TabSession>> {
      const matches: TabSession[] = [];
      for (const row of rows.values()) {
        if (
          row.lifecycleState === 'paused' &&
          row.expiresAt.getTime() <= at.getTime()
        ) {
          matches.push(row);
        }
      }
      return matches;
    },
  };
}

/**
 * Helper — builds a fresh `TabSession` envelope from caller input.
 * The repository inserts it; this function does not persist.
 */
export function buildFreshTabSession(
  input: OpenTabInput,
  deps: { readonly now: () => Date; readonly nextId: () => string },
): TabSession {
  const now = deps.now();
  const ttl = input.ttlMs ?? TAB_AS_LOOP_CONSTANTS.DEFAULT_TTL_MS;
  const id = deps.nextId();
  void randomUUID; // imported for SQL-adapter symmetry; unused in helper.
  // The freshly opened tab is in `opening`; the very next event must
  // be OPEN to advance it into `hydrating`.
  const startState: TabLifecycleState = 'opening';
  const auditHash = computeTabAuditHash({
    op: 'tab_session.open',
    id,
    tenantId: input.tenantId,
    userId: input.userId,
    tabKind: input.tabKind,
    recipeId: input.initialState.recipeId,
    recipeVersion: input.initialState.recipeVersion,
    openedAtMs: now.getTime(),
  });
  return Object.freeze({
    id,
    tenantId: input.tenantId,
    userId: input.userId,
    tabKind: input.tabKind,
    state: input.initialState,
    lifecycleState: startState,
    openedAt: now,
    pausedAt: null,
    expiresAt: new Date(now.getTime() + ttl),
    auditHash,
    prevHash: 'GENESIS',
  });
}

/**
 * Helper — apply a lifecycle transition + return the next session,
 * with timestamps + audit hash updated. Pure; caller persists via the
 * repo.
 */
export function transitionSession(
  session: TabSession,
  via: Parameters<typeof transitionTabLifecycle>[1],
  now: Date,
): TabSession {
  const next = transitionTabLifecycle(session.lifecycleState, via);
  const auditHash = computeTabAuditHash(
    {
      op: 'tab_session.transition',
      id: session.id,
      via,
      from: session.lifecycleState,
      to: next,
      atMs: now.getTime(),
    },
    session.auditHash,
  );
  return Object.freeze({
    ...session,
    lifecycleState: next,
    pausedAt: next === 'paused' ? now : session.pausedAt,
    auditHash,
    prevHash: session.auditHash,
  });
}
