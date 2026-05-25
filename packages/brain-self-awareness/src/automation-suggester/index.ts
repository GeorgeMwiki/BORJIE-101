// Public surface of the automation-suggester module.

export type {
  DecisionEventForAnalysis,
  SampleInvocation,
  SkillSuggestion,
  AnalyzePatternsInput
} from './types.js'

export {
  DEFAULT_SUGGESTION_THRESHOLD,
  DEFAULT_MAX_SAMPLES
} from './types.js'

export { analyzePatterns } from './analyze-patterns.js'
