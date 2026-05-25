/**
 * Composition root — convenience facade for callers that want one
 * object holding all subsystems bound to a shared embedder + brain.
 *
 * Pure: stores nothing; just returns bound functions. Each call is
 * still independent — callers can also import each subsystem directly
 * if they don't want the facade.
 */
import type { Brain, Embedder } from './types.js';
import {
  resolveEntity,
  mergeEntities,
  type ResolveEntityArgs,
  type MergeEntitiesArgs,
} from './entity-resolution/index.js';
import {
  flagUncertainCases,
  requestLabel,
  incorporateLabel,
  type FlagUncertainCasesArgs,
  type RequestLabelArgs,
  type IncorporateLabelArgs,
} from './active-learning/index.js';
import {
  coach,
  type CoachArgs,
} from './live-coaching/index.js';
import {
  streamInference,
  type StreamInferenceArgs,
} from './streaming/index.js';
import {
  unifyProfile,
  linkFragments,
  type UnifyProfileArgs,
  type LinkFragmentsArgs,
} from './profile-unification/index.js';
import {
  buildPersonalizedPrompt,
  type BuildPersonalizedPromptArgs,
} from './personalization/index.js';

export interface ProgressiveIntelligenceOptions {
  readonly embedder?: Embedder;
  readonly brain?: Brain;
}

export interface ProgressiveIntelligence {
  resolveEntity(args: Omit<ResolveEntityArgs, 'embedder'>): ReturnType<typeof resolveEntity>;
  mergeEntities(args: MergeEntitiesArgs): ReturnType<typeof mergeEntities>;
  flagUncertainCases<T>(args: FlagUncertainCasesArgs<T>): ReturnType<typeof flagUncertainCases<T>>;
  requestLabel<T>(args: RequestLabelArgs<T>): ReturnType<typeof requestLabel<T>>;
  incorporateLabel<T>(args: IncorporateLabelArgs<T>): ReturnType<typeof incorporateLabel<T>>;
  coach(args: Omit<CoachArgs, 'brain'>): ReturnType<typeof coach>;
  streamInference(args: Omit<StreamInferenceArgs, 'brain'>): ReturnType<typeof streamInference>;
  unifyProfile(args: UnifyProfileArgs): ReturnType<typeof unifyProfile>;
  linkFragments(args: LinkFragmentsArgs): ReturnType<typeof linkFragments>;
  buildPersonalizedPrompt(args: BuildPersonalizedPromptArgs): string;
}

export function createProgressiveIntelligence(
  options: ProgressiveIntelligenceOptions = {},
): ProgressiveIntelligence {
  const { embedder, brain } = options;
  return {
    resolveEntity(args) {
      return resolveEntity({
        ...args,
        ...(embedder !== undefined ? { embedder } : {}),
      });
    },
    mergeEntities,
    flagUncertainCases,
    requestLabel,
    incorporateLabel,
    coach(args) {
      return coach({
        ...args,
        ...(brain !== undefined ? { brain } : {}),
      });
    },
    streamInference(args) {
      if (!brain) throw new Error('createProgressiveIntelligence: brain required for streamInference');
      return streamInference({ ...args, brain });
    },
    unifyProfile,
    linkFragments,
    buildPersonalizedPrompt,
  };
}
