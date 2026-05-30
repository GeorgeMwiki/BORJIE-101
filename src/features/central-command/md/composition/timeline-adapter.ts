/**
 * MD timeline adapter — bridges the orchestrator's `MdTimelinePort`
 * onto the concrete `generateTimeline` + `runCpm` services from
 * `@/features/central-command/md/timeline`.
 *
 * The adapter degrades safely: when the generator throws, the
 * orchestrator still gets a serialisable milestone list (a sequential
 * fall-back built from the supplied actions). The MD chat surface
 * therefore never blocks on a timeline-subagent crash.
 *
 * @module features/central-command/md/composition/timeline-adapter
 */

import type {
  MdTimelinePort,
  MdTimelineRequest,
  MdTimelineMilestone,
} from "@/features/central-command/md/core/contracts";

import type { RequestContext } from "./request-context";

const MS_PER_DAY = 86_400_000;

export interface TimelineGeneratorFn {
  (input: {
    readonly actions: MdTimelineRequest["actions"];
    readonly startMs: number;
  }): Promise<ReadonlyArray<MdTimelineMilestone>>;
}

export interface TimelineAdapterDeps {
  /** Optional override; if absent, the adapter uses the sequential fallback. */
  readonly generator?: TimelineGeneratorFn;
  readonly ctx: RequestContext;
  readonly logger?: { debug(msg: string, data?: unknown): void };
}

export function createTimelineAdapter(
  deps: TimelineAdapterDeps,
): MdTimelinePort {
  const { ctx, generator, logger } = deps;

  return Object.freeze({
    async build(
      req: MdTimelineRequest,
    ): Promise<ReadonlyArray<MdTimelineMilestone>> {
      logger?.debug("md.timeline.build", {
        correlationId: ctx.correlationId,
        actions: req.actions.length,
      });
      if (req.actions.length === 0) return [];
      if (generator) {
        try {
          return await generator(req);
        } catch (e) {
          logger?.debug("md.timeline.build.generator-failed", {
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      // Sequential fallback: stack milestones back-to-back starting at
      // `startMs`. Every milestone is on the critical path because the
      // schedule is linear. No slack.
      let cursor = req.startMs;
      return Object.freeze(
        req.actions.map((a): MdTimelineMilestone => {
          const start = cursor;
          const end = start + Math.max(1, a.effortPersonDays) * MS_PER_DAY;
          cursor = end;
          return Object.freeze({
            id: a.id,
            title: a.title,
            startMs: start,
            endMs: end,
            slackDays: 0,
            onCriticalPath: true,
          });
        }),
      );
    },
  });
}
