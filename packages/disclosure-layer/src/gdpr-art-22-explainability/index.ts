/**
 * GDPR Art. 22 explainability — counterfactual generator for any
 * consequential decision the Brain makes or recommends.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §5
 */

export {
  type Counterfactual,
  type CounterfactualClause,
  type DecisionEvent,
  type DecisionInput,
} from './types.js';
export { generateCounterfactual, renderCounterfactual } from './counterfactual.js';
