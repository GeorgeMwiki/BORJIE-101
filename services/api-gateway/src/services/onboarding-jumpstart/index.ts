/**
 * Public surface of the Day-1 onboarding jumpstart service.
 * Wave COMPANY-BRAIN (Y-D).
 */

export {
  maybeFireJumpstart,
  type JumpstartDeps,
} from './jumpstart.js';
export {
  createDrizzleOnboardingPersistence,
  type OnboardingPersistence,
  type OnboardingStateRow,
} from './persistence.js';
export { buildJumpstartCard, type CardInput } from './card-builder.js';
export type {
  JumpstartCard,
  JumpstartInput,
  JumpstartResult,
} from './types.js';
