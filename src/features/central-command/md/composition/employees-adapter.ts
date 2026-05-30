/**
 * MD employees adapter — surfaces the active-employee sentiment
 * aggregate the orchestrator uses to emit "Aisha's last 1-on-1 was 47
 * days ago" style observations.
 *
 * The concrete reader is injected by the composition root because
 * the underlying Supabase queries depend on env / RLS that lives at
 * the route layer. If no reader is supplied the adapter returns an
 * empty list — the orchestrator falls back to the snapshot's
 * `employees` array instead.
 *
 * @module features/central-command/md/composition/employees-adapter
 */

import type {
  MdEmployeeSignal,
  MdEmployeesPort,
} from "@/features/central-command/md/core/contracts";

import type { RequestContext } from "./request-context";

export type EmployeesReaderFn = (
  orgId: string,
) => Promise<ReadonlyArray<MdEmployeeSignal>>;

export interface EmployeesAdapterDeps {
  readonly reader?: EmployeesReaderFn;
  readonly ctx: RequestContext;
  readonly logger?: { debug(msg: string, data?: unknown): void };
}

export function createEmployeesAdapter(
  deps: EmployeesAdapterDeps,
): MdEmployeesPort {
  const { ctx, reader, logger } = deps;

  return Object.freeze({
    async read(orgId: string): Promise<ReadonlyArray<MdEmployeeSignal>> {
      logger?.debug("md.employees.read", {
        correlationId: ctx.correlationId,
        orgId,
      });
      if (!reader) return [];
      try {
        return await reader(orgId);
      } catch (e) {
        logger?.debug("md.employees.read.failed", {
          error: e instanceof Error ? e.message : String(e),
        });
        return [];
      }
    },
  });
}
