/**
 * NBA adapter — `NbaServicePort` ➜ `MdNbaPort`.
 *
 * The two surfaces happen to be near-identical (the orchestrator's contract
 * mirrors NBA's port). This adapter is a thin passthrough that exists for
 * three reasons:
 *
 *   1. Decouple the orchestrator from NBA's concrete file path so future
 *      NBA refactors don't ripple into `core/`.
 *   2. Allow per-request hooks (logging, tracing, rate-limit guards) to be
 *      added in one place.
 *   3. Make the composition root testable with a fake NbaServicePort.
 *
 * @module features/central-command/md/composition/nba-adapter
 */

import type {
  MdNbaPort,
  BusinessSnapshot,
  RankedAction,
} from "@/features/central-command/md/core/contracts";
import type { NbaServicePort } from "@/features/central-command/md/nba";

import type { RequestContext } from "./request-context";

export interface NbaAdapterDeps {
  readonly service: NbaServicePort;
  readonly ctx: RequestContext;
  readonly logger?: { debug(msg: string, data?: unknown): void };
}

export function createNbaAdapter(deps: NbaAdapterDeps): MdNbaPort {
  const { service, ctx, logger } = deps;

  return Object.freeze({
    async rankActions(
      snapshot: BusinessSnapshot,
      k: number,
    ): Promise<ReadonlyArray<RankedAction>> {
      logger?.debug("nba.rankActions", { correlationId: ctx.correlationId, k });
      return service.rankActions(snapshot, k);
    },

    async getNextLowHangingFruit(
      snapshot: BusinessSnapshot,
    ): Promise<RankedAction | null> {
      logger?.debug("nba.getNextLowHangingFruit", {
        correlationId: ctx.correlationId,
      });
      return service.getNextLowHangingFruit(snapshot);
    },

    async getNextHighImpact(
      snapshot: BusinessSnapshot,
    ): Promise<RankedAction | null> {
      logger?.debug("nba.getNextHighImpact", {
        correlationId: ctx.correlationId,
      });
      return service.getNextHighImpact(snapshot);
    },

    async getDailyAgenda(
      snapshot: BusinessSnapshot,
    ): Promise<ReadonlyArray<RankedAction>> {
      logger?.debug("nba.getDailyAgenda", { correlationId: ctx.correlationId });
      return service.getDailyAgenda(snapshot);
    },
  });
}
