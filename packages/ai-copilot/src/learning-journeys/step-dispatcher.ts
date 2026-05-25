/**
 * Step Dispatcher — selects the right UI component / handler for a step kind.
 *
 * Pure mapping layer. The admin-portal / customer-app / owner-portal each
 * provide their own renderers and register them through `createStepDispatcher`.
 */

import type { JourneyStep, StepKind } from './journey-ui-types.js';

export interface StepRenderResult {
  readonly componentKey: string;
  readonly props: Record<string, unknown>;
}

export type StepRenderer = (step: JourneyStep) => StepRenderResult;

export type StepRendererMap = Readonly<Record<StepKind, StepRenderer>>;

export const DEFAULT_STEP_RENDERER_MAP: StepRendererMap = {
  video: (step) => {
    if (step.kind !== 'video') throw new Error('expected video step');
    return {
      componentKey: 'VideoPlayer',
      props: {
        videoRef: step.videoRef,
        durationSeconds: step.durationSeconds,
        transcriptRef: step.transcriptRef,
      },
    };
  },
  reading: (step) => {
    if (step.kind !== 'reading') throw new Error('expected reading step');
    return {
      componentKey: 'ReadingPane',
      props: {
        contentMdRef: step.contentMdRef,
        estimatedWordCount: step.estimatedWordCount,
      },
    };
  },
  quiz: (step) => {
    if (step.kind !== 'quiz') throw new Error('expected quiz step');
    return {
      componentKey: 'QuizRunner',
      props: {
        questionIds: step.questionIds,
        passingScore: step.passingScore,
        maxAttempts: step.maxAttempts,
      },
    };
  },
  'hands-on-task': (step) => {
    if (step.kind !== 'hands-on-task') throw new Error('expected task step');
    return {
      componentKey: 'HandsOnTaskPanel',
      props: {
        taskRef: step.taskRef,
        successCriteria: step.successCriteria,
        blockOnCompletion: step.blockOnCompletion,
      },
    };
  },
  'ai-conversation': (step) => {
    if (step.kind !== 'ai-conversation') throw new Error('expected conversation step');
    return {
      componentKey: 'AiConversationPanel',
      props: {
        personaId: step.personaId,
        openingPromptEn: step.openingPromptEn,
        openingPromptSw: step.openingPromptSw,
        evaluationRubric: step.evaluationRubric,
      },
    };
  },
};

export interface StepDispatcher {
  dispatch(step: JourneyStep): StepRenderResult;
}

export function createStepDispatcher(
  overrides: Partial<StepRendererMap> = {},
): StepDispatcher {
  const merged: StepRendererMap = {
    ...DEFAULT_STEP_RENDERER_MAP,
    ...overrides,
  };
  return {
    dispatch(step: JourneyStep): StepRenderResult {
      const renderer = merged[step.kind];
      if (!renderer) {
        throw new Error(`No renderer registered for step kind: ${step.kind}`);
      }
      return renderer(step);
    },
  };
}
