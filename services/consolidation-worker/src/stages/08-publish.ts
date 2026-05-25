/**
 * Stage 08 — Publish.
 *
 * Emit a `brain.delta` OTel event (and optionally a Langfuse summary
 * row) so downstream consumers refresh caches. The publisher port is
 * duck-typed so production can wire whatever transport (OTel exporter,
 * Redis pubsub, Langfuse REST) without coupling the worker to a
 * specific telemetry library.
 *
 * When no publisher is wired, the stage logs the delta and returns —
 * never blocks the tick.
 */

import { randomUUID } from 'crypto';
import type {
  BrainDelta,
  BrainDeltaPublisher,
  StageLogger,
} from './types.js';

export interface PublishArgs {
  readonly publisher?: BrainDeltaPublisher;
  readonly logger: StageLogger;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly skillsPromoted: number;
  readonly promptPatches: number;
  readonly factsDecayed: number;
  readonly entitiesMerged: number;
  readonly factsReEmbedded: number;
  readonly clustersInspected: number;
  readonly tickId?: string;
}

export async function runPublishStage(args: PublishArgs): Promise<BrainDelta> {
  const delta: BrainDelta = {
    tickId: args.tickId ?? `tick_${randomUUID()}`,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    skillsPromoted: args.skillsPromoted,
    promptPatches: args.promptPatches,
    factsDecayed: args.factsDecayed,
    entitiesMerged: args.entitiesMerged,
    factsReEmbedded: args.factsReEmbedded,
    clustersInspected: args.clustersInspected,
  };

  args.logger.info(
    {
      stage: '08-publish',
      tickId: delta.tickId,
      skillsPromoted: delta.skillsPromoted,
      promptPatches: delta.promptPatches,
      factsDecayed: delta.factsDecayed,
      entitiesMerged: delta.entitiesMerged,
      factsReEmbedded: delta.factsReEmbedded,
      clustersInspected: delta.clustersInspected,
    },
    'brain.delta',
  );

  if (args.publisher) {
    try {
      await args.publisher.publish(delta);
    } catch (error) {
      args.logger.warn(
        { stage: '08-publish', err: asMessage(error) },
        'publish failed — delta logged only',
      );
    }
  }
  return delta;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
