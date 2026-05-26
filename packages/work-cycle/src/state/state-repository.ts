/**
 * State repository — per-tenant resumption pointer (spec §5, §9).
 *
 * One row per tenant. Holds:
 *   - last_tick_no (monotone; advanced atomically with journal append)
 *   - last_tick_at (ISO timestamp of last completed tick)
 *   - current_mode (active | idle | night | observe)
 *   - pending_threads (slow-burn investigation list)
 *
 * Two implementations match the journal-repository pattern: in-memory
 * for tests + worker startup, SQL via a driver port for production.
 *
 * In production the state update + journal append happen in a single
 * transaction; in tests we expose `applyTickResult` for the tick
 * runner so the in-memory path stays single-step.
 */

import {
  WORK_CYCLE_MODES,
  WorkCycleError,
  type WorkCycleMode,
  type WorkCycleState,
} from '../types.js';

export interface StateRepository {
  /** Read the state row, or null if the tenant has not been initialised. */
  read(tenantId: string): Promise<WorkCycleState | null>;

  /** Read-or-default. If null, returns a genesis state (tick_no=0n, idle). */
  readOrDefault(tenantId: string): Promise<WorkCycleState>;

  /**
   * Advance the state after a successful journal append. tick_no MUST
   * equal `previous.last_tick_no + 1n`, else throws.
   */
  applyTickResult(args: {
    readonly tenantId: string;
    readonly tickNo: bigint;
    readonly tickAtIso: string;
    readonly nextMode: WorkCycleMode;
    readonly pendingThreads: ReadonlyArray<{
      readonly id: string;
      readonly title: string;
    }>;
  }): Promise<WorkCycleState>;

  /** Switch mode without advancing tick_no. Used for external transitions. */
  switchMode(tenantId: string, mode: WorkCycleMode): Promise<WorkCycleState>;
}

function isMode(value: string): value is WorkCycleMode {
  return (WORK_CYCLE_MODES as ReadonlyArray<string>).includes(value);
}

function genesis(tenantId: string): WorkCycleState {
  return Object.freeze({
    tenant_id: tenantId,
    last_tick_no: 0n,
    last_tick_at: null,
    current_mode: 'idle',
    pending_threads: [],
  });
}

// ---------------------------------------------------------------------------
// In-memory implementation
// ---------------------------------------------------------------------------

export function createInMemoryStateRepository(
  initial: ReadonlyArray<WorkCycleState> = [],
): StateRepository {
  const store: Map<string, WorkCycleState> = new Map();
  for (const row of initial) {
    store.set(row.tenant_id, row);
  }

  return {
    async read(tenantId) {
      return store.get(tenantId) ?? null;
    },

    async readOrDefault(tenantId) {
      return store.get(tenantId) ?? genesis(tenantId);
    },

    async applyTickResult({
      tenantId,
      tickNo,
      tickAtIso,
      nextMode,
      pendingThreads,
    }) {
      if (!isMode(nextMode)) {
        throw new WorkCycleError(
          'state.invalid_mode',
          `unknown mode ${nextMode}`,
        );
      }
      const previous = store.get(tenantId) ?? genesis(tenantId);
      const expected = previous.last_tick_no + 1n;
      if (tickNo !== expected) {
        throw new WorkCycleError(
          'state.tick_no_mismatch',
          `expected tick_no ${expected.toString()} got ${tickNo.toString()} for tenant ${tenantId}`,
        );
      }
      const next: WorkCycleState = Object.freeze({
        tenant_id: tenantId,
        last_tick_no: tickNo,
        last_tick_at: tickAtIso,
        current_mode: nextMode,
        pending_threads: pendingThreads,
      });
      store.set(tenantId, next);
      return next;
    },

    async switchMode(tenantId, mode) {
      if (!isMode(mode)) {
        throw new WorkCycleError(
          'state.invalid_mode',
          `unknown mode ${mode}`,
        );
      }
      const previous = store.get(tenantId) ?? genesis(tenantId);
      const next: WorkCycleState = Object.freeze({
        ...previous,
        current_mode: mode,
      });
      store.set(tenantId, next);
      return next;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL driver port
// ---------------------------------------------------------------------------

export interface StateSqlDriver {
  readState(tenantId: string): Promise<WorkCycleState | null>;
  upsertState(state: WorkCycleState): Promise<WorkCycleState>;
}

export function createSqlStateRepository(args: {
  readonly driver: StateSqlDriver;
}): StateRepository {
  const { driver } = args;
  return {
    async read(tenantId) {
      return driver.readState(tenantId);
    },

    async readOrDefault(tenantId) {
      const existing = await driver.readState(tenantId);
      return existing ?? genesis(tenantId);
    },

    async applyTickResult({
      tenantId,
      tickNo,
      tickAtIso,
      nextMode,
      pendingThreads,
    }) {
      const previous = await driver.readState(tenantId);
      const base = previous ?? genesis(tenantId);
      const expected = base.last_tick_no + 1n;
      if (tickNo !== expected) {
        throw new WorkCycleError(
          'state.tick_no_mismatch',
          `expected tick_no ${expected.toString()} got ${tickNo.toString()} for tenant ${tenantId}`,
        );
      }
      const next: WorkCycleState = {
        tenant_id: tenantId,
        last_tick_no: tickNo,
        last_tick_at: tickAtIso,
        current_mode: nextMode,
        pending_threads: pendingThreads,
      };
      return driver.upsertState(next);
    },

    async switchMode(tenantId, mode) {
      const previous = (await driver.readState(tenantId)) ?? genesis(tenantId);
      return driver.upsertState({ ...previous, current_mode: mode });
    },
  };
}
