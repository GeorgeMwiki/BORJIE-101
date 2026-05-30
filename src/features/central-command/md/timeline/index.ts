/**
 * MD Timeline — Public API.
 *
 * @module features/central-command/md/timeline
 */

export type {
  CpmResult,
  GeneratorFn,
  GeneratorInput,
  Milestone,
  MilestoneStatus,
  Timeline,
  TimelineStyle,
} from "./types";

export {
  milestoneSchema,
  milestoneStatusSchema,
  timelineSchema,
  timelineStyleSchema,
  generatorInputSchema,
} from "./types";

export { runCpm, type CpmInput } from "./cpm";

export { defaultGenerator, generateTimeline } from "./auto-generator";

export {
  adaptTimeline,
  type AdapterOptions,
  type AgileCycle,
  type AgileView,
  type KanbanColumn,
  type KanbanView,
  type TimelineView,
  type WaterfallRow,
  type WaterfallView,
} from "./owner-style-adapter";

export {
  makeTimelinePersister,
  type TimelinePersister,
  type TimelinePersisterConfig,
  type SupabaseLike as TimelineSupabaseLike,
} from "./persister";

export {
  makeTimelineService,
  type CreateTimelineInput,
  type CreateTimelineResult,
  type TimelineService,
  type TimelineServiceDeps,
} from "./timeline-service";
