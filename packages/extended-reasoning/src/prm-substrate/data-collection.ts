import { z } from 'zod';
import type {
  EmitPrmTrainingSampleInput,
  J1Emitter,
  PrmTrainingSample,
} from './types.js';

const stepSchema = z.object({
  index: z.number().int().nonnegative(),
  description: z.string().min(1, 'step description must be non-empty'),
  context: z.unknown().optional(),
});

// `rewardSignal` is a cumulative trajectory reward and may exceed 1 — e.g.
// when a LATS run returns the sum of per-step rewards across N steps. We
// keep the lower bound at 0 (rewards are nonnegative in our convention) but
// remove the upper bound; the training pipeline normalises downstream.
const inputSchema = z.object({
  conversationId: z.string().min(1, 'conversationId must be non-empty'),
  taskClass: z.string().min(1, 'taskClass must be non-empty'),
  steps: z.array(stepSchema).min(1, 'steps must be non-empty'),
  outcome: z.enum(['success', 'partial', 'failure']),
  rewardSignal: z.number().nonnegative(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Emit a J1 entity describing a completed multi-step action. The shape is
 * stable so the training-data team can stream samples straight into a model
 * fine-tune pipeline once we accumulate enough.
 *
 * Throws on schema violations — better to surface bad emissions in dev than
 * to silently drop training data.
 */
export async function emitPrmTrainingSample(
  input: EmitPrmTrainingSampleInput,
  emitter: J1Emitter,
  now: () => Date = () => new Date(),
): Promise<PrmTrainingSample> {
  const parsed = inputSchema.parse(input);
  // Re-enforce ordered, contiguous step indices for downstream training
  for (let i = 0; i < parsed.steps.length; i += 1) {
    if (parsed.steps[i]?.index !== i) {
      throw new Error(
        `[PRM] step indices must be contiguous starting at 0; got index=${parsed.steps[i]?.index} at position ${i}`,
      );
    }
  }
  const base = {
    version: '1.0' as const,
    conversationId: parsed.conversationId,
    taskClass: parsed.taskClass,
    steps: parsed.steps as PrmTrainingSample['steps'],
    outcome: parsed.outcome,
    rewardSignal: parsed.rewardSignal,
    emittedAt: now().toISOString(),
  };
  const sample: PrmTrainingSample =
    parsed.metadata !== undefined
      ? {
          ...base,
          metadata: parsed.metadata as NonNullable<PrmTrainingSample['metadata']>,
        }
      : base;
  await emitter(sample);
  return sample;
}
