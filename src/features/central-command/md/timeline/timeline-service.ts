/**
 * Timeline — Public Service API
 *
 * Composes the auto-generator, CPM scheduler, persister, and tier-policy
 * guards. Every public method emits a DecisionTrace.
 *
 * @module features/central-command/md/timeline/timeline-service
 */

import { randomUUID } from "node:crypto";

import { createLogger } from "@/lib/logger";
import { startTrace, type TraceStore } from "@/core/borjie-ai/decision-trace";
import {
  assertTierPolicy,
  type BorjieAITier,
} from "@/core/governance/tier-policy";
import { defaultGenerator, generateTimeline } from "./auto-generator";
import { adaptTimeline, type TimelineView } from "./owner-style-adapter";
import type { TimelinePersister } from "./persister";
import type {
  GeneratorFn,
  GeneratorInput,
  Milestone,
  Timeline,
  TimelineStyle,
} from "./types";

const log = createLogger("md.timeline.service");

export interface TimelineServiceDeps {
  readonly persister: TimelinePersister;
  readonly traceStore: TraceStore;
  readonly generator?: GeneratorFn;
  readonly idGen?: () => string;
  readonly clock?: () => Date;
}

export interface CreateTimelineInput {
  readonly tier: BorjieAITier;
  readonly sessionId: string;
  readonly correlationId: string;
  readonly userId: string;
  readonly request: GeneratorInput;
}

export interface CreateTimelineResult {
  readonly timeline: Timeline;
  readonly traceId: string;
}

export interface TimelineService {
  createFromDescription(
    input: CreateTimelineInput,
  ): Promise<CreateTimelineResult>;
  renderAs(timeline: Timeline, style: TimelineStyle): TimelineView;
  setMilestoneStatus(
    tier: BorjieAITier,
    timelineId: string,
    milestoneId: string,
    status: Milestone["status"],
  ): Promise<void>;
}

export function makeTimelineService(
  deps: TimelineServiceDeps,
): TimelineService {
  const generator = deps.generator ?? defaultGenerator;
  const idGen = deps.idGen ?? randomUUID;
  const clock = deps.clock ?? (() => new Date());

  return Object.freeze({
    async createFromDescription(
      input: CreateTimelineInput,
    ): Promise<CreateTimelineResult> {
      assertWrite(input.tier);
      const recorder = startTrace({
        correlationId: input.correlationId,
        sessionId: input.sessionId,
        userId: input.userId,
        tier: input.tier,
        model: "md.timeline.auto-generator",
        modelTier: "sonnet",
        input: {
          text: input.request.description,
          portalId: "central-command.md",
          route: "timeline/create",
        },
      });

      const start = Date.now();
      recorder.considerTool("timeline.auto-generator", 1.0);

      const timeline = await generateTimeline(input.request, generator, {
        idGen,
        nowIso: clock().toISOString(),
      });

      recorder.useTool({
        name: "timeline.auto-generator",
        input: { description: input.request.description.slice(0, 200) },
        output: {
          milestoneCount: timeline.milestones.length,
          endsAt: timeline.endsAt,
        },
        latencyMs: Date.now() - start,
      });
      recorder.addReasoning(
        `generated ${timeline.milestones.length} milestones; persisting`,
      );

      await deps.persister.upsert(timeline);

      const trace = await recorder.finalize(
        {
          type: "md.timeline.create",
          target: timeline.id,
          payload: {
            projectName: timeline.projectName,
            milestones: timeline.milestones.length,
          },
        },
        deps.traceStore,
      );

      log.info("timeline created", {
        id: timeline.id,
        project: timeline.projectName,
      });

      return Object.freeze({
        timeline,
        traceId: trace.id,
      });
    },

    renderAs(timeline: Timeline, style: TimelineStyle): TimelineView {
      return adaptTimeline(timeline, style);
    },

    async setMilestoneStatus(
      tier: BorjieAITier,
      timelineId: string,
      milestoneId: string,
      status: Milestone["status"],
    ): Promise<void> {
      assertWrite(tier);
      await deps.persister.setMilestoneStatus(timelineId, milestoneId, status);
    },
  });
}

function assertWrite(tier: BorjieAITier): void {
  const r = assertTierPolicy(tier, "chat:converse");
  if (!r.ok) {
    throw new Error(`md.timeline: tier ${tier} forbidden (${r.reason})`);
  }
}
