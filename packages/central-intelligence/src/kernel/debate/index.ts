/**
 * Internal debate + counterfactual reasoning — barrel.
 *
 * Public surface for high-stakes deliberation:
 *   - `runDebate(question, context, deps, config)` — N voices × R rounds
 *     → synthesis. Tracks token budget + jaccard convergence.
 *   - `buildCounterfactuals(question, domain)` — three standardised
 *     "what if" perturbations per domain.
 *   - `runCounterfactuals(scenarios, context, deps)` — one sensor call
 *     per scenario; returns the alternative-world answers.
 */

export {
  type DebateConfig,
  type DebateContribution,
  type DebateDeps,
  type DebateOutcome,
  type DebatePersona,
  type DebateVoice,
} from './debate-types.js';

export { runDebate } from './debate-runner.js';
export {
  runStakesAwareDebate,
  type DispatchedDebateMode,
  type RunStakesAwareDebateOptions,
  type StakesAwareDebateResult,
} from './debate-runner.js';
export {
  runThreeAgentDebate,
  type ConstitutionRulePrompt,
  type DebateResult,
  type SensorLike,
  type ThreeAgentDebateOptions,
} from './three-agent-debate.js';
export { DEFAULT_PROPERTY_DEBATE_VOICES } from './default-voices.js';
export {
  buildCounterfactuals,
  runCounterfactuals,
  type CounterfactualDomain,
  type CounterfactualOutcome,
  type CounterfactualScenario,
} from './counterfactual.js';
