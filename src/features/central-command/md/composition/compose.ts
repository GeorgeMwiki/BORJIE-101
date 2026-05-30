/**
 * Composition root — builds the `MdSubagents` bundle the orchestrator
 * consumes by wiring concrete subagent services to the contract ports
 * through adapters.
 *
 * Lifecycle:
 *   - One bundle per request (request-scoped context).
 *   - The bundle is read-only; the orchestrator never mutates it.
 *   - The composition root is the ONLY place that knows about both the
 *     orchestrator's port shapes and the subagent service implementations.
 *
 * @module features/central-command/md/composition/compose
 */

import type { MdSubagents } from "@/features/central-command/md/core/contracts";
import type { NbaServicePort } from "@/features/central-command/md/nba";
import type { OwnerStyleService } from "@/features/central-command/md/owner-style/owner-style-service";
import type { FollowUpPersister } from "@/features/central-command/md/follow-up/persister";

import {
  createAutoPopulateAdapter,
  type ProcessChatFn,
} from "./auto-populate-adapter";
import { createFollowUpAdapter } from "./follow-up-adapter";
import { createNbaAdapter } from "./nba-adapter";
import { createOwnerStyleAdapter } from "./owner-style-adapter";
import {
  createTimelineAdapter,
  type TimelineGeneratorFn,
} from "./timeline-adapter";
import {
  createEmployeesAdapter,
  type EmployeesReaderFn,
} from "./employees-adapter";
import {
  createPresenterAdapter,
  type PresenterProcessFn,
} from "./presenter-adapter";
import type { RequestContext } from "./request-context";

export interface MdSubagentsBuildDeps {
  readonly ctx: RequestContext;
  readonly nbaService: NbaServicePort;
  readonly ownerStyleService: OwnerStyleService;
  readonly followUpPersister: FollowUpPersister;
  readonly autoPopulateProcessChat: ProcessChatFn;
  /** Concrete timeline generator; falls back to sequential schedule when absent. */
  readonly timelineGenerator?: TimelineGeneratorFn;
  /** Concrete employee-signal reader; returns [] when absent. */
  readonly employeesReader?: EmployeesReaderFn;
  /** Concrete presenter `processOwnerTurn`; returns null when absent. */
  readonly presenterProcess?: PresenterProcessFn;
  readonly clock?: () => Date;
  readonly idGen?: () => string;
  readonly logger?: { debug(msg: string, data?: unknown): void };
}

/**
 * Build the request-scoped subagent bundle.
 *
 * @param deps  Concrete services + the per-request context.
 * @returns     A frozen `MdSubagents` instance ready for the orchestrator.
 */
export function createMdSubagents(deps: MdSubagentsBuildDeps): MdSubagents {
  const { ctx, logger } = deps;

  // Default presenter shim: when the route doesn't inject a real
  // presenter, we always return null (the orchestrator falls back to
  // the normal NBA-driven turn). Defined here so the adapter has a
  // total `process` callable.
  const presenterProcess: PresenterProcessFn =
    deps.presenterProcess ?? (async () => null);

  return Object.freeze({
    nba: createNbaAdapter({
      service: deps.nbaService,
      ctx,
      logger,
    }),
    autoPopulate: createAutoPopulateAdapter({
      processChat: deps.autoPopulateProcessChat,
      ctx,
      logger,
    }),
    ownerStyle: createOwnerStyleAdapter({
      service: deps.ownerStyleService,
      ctx,
      logger,
    }),
    followUp: createFollowUpAdapter({
      persister: deps.followUpPersister,
      ctx,
      clock: deps.clock,
      idGen: deps.idGen,
      logger,
    }),
    timeline: createTimelineAdapter({
      generator: deps.timelineGenerator,
      ctx,
      logger,
    }),
    employees: createEmployeesAdapter({
      reader: deps.employeesReader,
      ctx,
      logger,
    }),
    presenter: createPresenterAdapter({
      process: presenterProcess,
      ctx,
      logger,
    }),
  });
}
