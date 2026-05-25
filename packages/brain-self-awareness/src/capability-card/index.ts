// Public surface of the capability-card module.

export {
  CAP_BRAND,
  type AutonomyScope,
  type CalibratedLimits,
  type OngoingFlow,
  type RecentDecisionSummary,
  type SuggestedNextSkill,
  type CapabilityCard,
  type ISkillRegistry,
  type IDecisionStore,
  type IFlowRegistry,
  type IAutomationSuggester,
  type ICalibrationSource,
  type CapabilityCardDeps
} from './types.js'

export { buildCapabilityCard } from './build-capability-card.js'
