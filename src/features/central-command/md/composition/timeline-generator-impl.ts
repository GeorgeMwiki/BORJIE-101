/**
 * Concrete TimelineGenerator — wraps `generateTimeline + runCpm` from
 * the existing `@/features/central-command/md/timeline` module and
 * maps its output back to the orchestrator's MdTimelineMilestone
 * shape.
 *
 * The orchestrator hands the adapter:
 *   { actions: [{id,title,effortPersonDays,dependsOn?}], startMs }
 *
 * `generateTimeline` expects a `GeneratorInput` (free-form description
 * + style) and uses an LLM-shaped generator. For the synchronous MD
 * path we sidestep the generator entirely and feed pre-shaped
 * milestones directly into `runCpm`, then translate back. This keeps
 * us deterministic, hermetic, and side-effect-free — same discipline
 * the rest of the MD composition layer uses.
 *
 * Falls back to the orchestrator's sequential fallback when:
 *   - actions is empty
 *   - any milestone references a dependency that isn't in the set
 *
 * @module features/central-command/md/composition/timeline-generator-impl
 */

import { runCpm } from "@/features/central-command/md/timeline/cpm";
import type {
  MdTimelineMilestone,
  MdTimelineRequest,
} from "@/features/central-command/md/core/contracts";

import type { TimelineGeneratorFn } from "./timeline-adapter";

const MS_PER_DAY = 86_400_000;

/**
 * Concrete generator the chat route plugs into the timeline adapter.
 */
export const concreteTimelineGenerator: TimelineGeneratorFn = async ({
  actions,
  startMs,
}) => {
  if (actions.length === 0) return [];

  // Validate every dependsOn references an action id we know about.
  // If not, return [] so the adapter falls back to the sequential
  // scheduler — we don't want runCpm to panic on a dangling edge.
  const ids = new Set(actions.map((a) => a.id));
  for (const a of actions) {
    for (const d of a.dependsOn ?? []) {
      if (!ids.has(d)) {
        return [];
      }
    }
  }

  // runCpm expects { id, label, durationDays, dependencies }. Map.
  // Spread `dependsOn` into a mutable array since runCpm's typed input
  // wants `string[]` rather than `readonly string[]`.
  const cpmInput = actions.map((a) => ({
    id: a.id,
    label: a.title,
    durationDays: Math.max(1, Math.round(a.effortPersonDays)),
    dependencies: [...(a.dependsOn ?? [])],
  }));

  const startsAt = new Date(startMs).toISOString();
  const result = runCpm({ milestones: cpmInput, startsAt });

  const criticalSet = new Set(result.criticalPath);
  const projectEndMs = startMs + result.totalDurationDays * MS_PER_DAY;

  return Object.freeze(
    result.milestones.map((m): MdTimelineMilestone => {
      // `earliestStartAt` and `dueAt` are typed as nullable on the
      // schema but runCpm always populates them — defensive fallbacks
      // for the type checker.
      const startIso = m.earliestStartAt ?? startsAt;
      const start = new Date(startIso).getTime();
      const end = start + m.durationDays * MS_PER_DAY;
      // Slack = project-finish - earliest-finish for this node (upper
      // bound; true slack for sink nodes equals this exactly). For
      // critical-path nodes slack is always 0 by definition.
      const slackDays = criticalSet.has(m.id)
        ? 0
        : Math.max(0, Math.round((projectEndMs - end) / MS_PER_DAY));
      return Object.freeze({
        id: m.id,
        title: m.label,
        startMs: start,
        endMs: end,
        slackDays,
        onCriticalPath: criticalSet.has(m.id),
      });
    }),
  );
};

// Re-export the request type so callers don't need to reach into core/.
export type { MdTimelineRequest };
