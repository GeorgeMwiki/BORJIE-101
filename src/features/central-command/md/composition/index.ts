/**
 * MD composition — public barrel.
 *
 * The composition layer is the only seam between the MD orchestrator
 * (`core/`) and the concrete subagent services (`nba/`, `auto-populate/`,
 * `owner-style/`, `follow-up/`). The orchestrator imports `MdSubagents`
 * from `core/contracts`; the boot path imports `createMdSubagents` from
 * here and hands the bundle to the orchestrator's constructor.
 *
 * @module features/central-command/md/composition
 */

export { createMdSubagents } from "./compose";
export type { MdSubagentsBuildDeps } from "./compose";

export { parseRequestContext, requestContextSchema } from "./request-context";
export type { RequestContext } from "./request-context";

export { createNbaAdapter } from "./nba-adapter";
export { createOwnerStyleAdapter } from "./owner-style-adapter";
export { createFollowUpAdapter } from "./follow-up-adapter";
export { createAutoPopulateAdapter } from "./auto-populate-adapter";
export type { ProcessChatFn } from "./auto-populate-adapter";

export { createTimelineAdapter } from "./timeline-adapter";
export type { TimelineGeneratorFn } from "./timeline-adapter";

export { createEmployeesAdapter } from "./employees-adapter";
export type { EmployeesReaderFn } from "./employees-adapter";

export { createPresenterAdapter } from "./presenter-adapter";
export type { PresenterProcessFn } from "./presenter-adapter";
