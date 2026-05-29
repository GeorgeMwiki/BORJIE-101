/**
 * Mr. Mwikila autonomous worker — fires per-tenant per-handler ticks
 * at a configurable cadence.
 *
 * Composition root wires:
 *   - the recorder + delegation store + handler runtime
 *   - the 5 (or more) per-category handlers
 *   - a tenant-listing port so the worker iterates every active
 *     tenant exactly once per tick
 *
 * Pure-logic shape mirrors the saved-search-worker — DbLike / port
 * stubs let vitest drive every branch.
 */

import type { Logger } from 'pino';

import type {
  MwikilaHandler,
  MwikilaHandlerRuntime,
  MwikilaInboxRow,
} from '../services/mwikila-autonomy/index.js';

export interface MwikilaTenantPort {
  /**
   * Return tenants the worker should tick this turn. The composition
   * root wires this to read active tenants from `tenants`.
   */
  listActiveTenants(): Promise<
    ReadonlyArray<{
      readonly tenantId: string;
      readonly ownerUserId: string;
    }>
  >;
}

export interface MwikilaAutonomousWorkerOptions {
  readonly runtime: MwikilaHandlerRuntime;
  readonly tenants: MwikilaTenantPort;
  readonly handlers: ReadonlyArray<MwikilaHandler>;
  readonly logger?: Logger;
  readonly intervalMs?: number;
}

export interface MwikilaAutonomousWorker {
  start(): void;
  stop(): void;
  tickOnce(): Promise<{
    readonly tenantsScanned: number;
    readonly handlersInvoked: number;
    readonly inboxRowsWritten: number;
  }>;
}

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

export function createMwikilaAutonomousWorker(
  opts: MwikilaAutonomousWorkerOptions,
): MwikilaAutonomousWorker {
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const logger = opts.logger;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tickOnce() {
    const tenants = await opts.tenants.listActiveTenants();
    let handlersInvoked = 0;
    let inboxRowsWritten = 0;
    for (const tenant of tenants) {
      for (const handler of opts.handlers) {
        handlersInvoked += 1;
        try {
          const row: MwikilaInboxRow | null = await opts.runtime.run({
            tenantId: tenant.tenantId,
            actingOnUserId: tenant.ownerUserId,
            handler,
          });
          if (row !== null) inboxRowsWritten += 1;
        } catch (err) {
          logger?.error(
            {
              err,
              tenantId: tenant.tenantId,
              actionKind: handler.actionKind,
            },
            'mwikila autonomous worker — handler failed',
          );
        }
      }
    }
    return {
      tenantsScanned: tenants.length,
      handlersInvoked,
      inboxRowsWritten,
    };
  }

  return {
    start() {
      if (timer) return;
      if (process.env.MWIKILA_WORKER_DISABLED === 'true') return;
      timer = setInterval(() => {
        void tickOnce().catch((err: unknown) => {
          logger?.error({ err }, 'mwikila autonomous worker tick crashed');
        });
      }, interval);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    tickOnce,
  };
}
