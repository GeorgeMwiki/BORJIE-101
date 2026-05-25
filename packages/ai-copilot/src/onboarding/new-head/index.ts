/**
 * New-head onboarding tour — Wave 28.
 *
 * Guided 5-step walkthrough for a fresh head of estates. Complementary
 * to (not a replacement for) the 7-step autonomy policy wizard.
 */
export { composeTour, buildInitialSteps } from './tour-composer.js';
export type { TourComposerInputs } from './tour-composer.js';
export {
  NewHeadTourService,
  InMemoryTourRepository,
} from './tour-service.js';
export type { NewHeadTourServiceDeps, AdvanceOutcome } from './tour-service.js';
export {
  TOUR_STEP_ORDER,
  TOUR_STEPS_TOTAL,
} from './types.js';
export type {
  FirstWeekTask,
  TourPayload,
  TourRepository,
  TourResult,
  TourResultOutcome,
  TourState,
  TourStep,
  TourStepId,
  TourStepStatus,
} from './types.js';
