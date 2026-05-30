/** Public entry point for the onboarding feature. */

export { ConversationalOnboardingFlow } from "./conversational-onboarding-flow";
export {
  ONBOARDING_FIELDS,
  buildConfirmationBanner,
  getNextField,
  initialState,
  isReadyToConfirm,
  selectRegister,
  updateField,
  type ConfirmationBanner,
  type FieldProvenance,
  type OnboardingField,
  type OnboardingFieldId,
  type OnboardingState,
  type UpdateFieldInput,
} from "./conversational-onboarding-state";
