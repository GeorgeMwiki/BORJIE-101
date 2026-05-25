/**
 * Counter-model — Central Command Phase B (B5) public surface.
 *
 * Second-LLM sanity check for destroy-tier + billing-tier actions
 * BEFORE the four-eye approval gate fires.
 */

export {
  createCounterModelReview,
  DEFAULT_COUNTER_MODEL_ID,
  type CounterModel,
  type CounterModelConfig,
  type CounterModelLlmClient,
  type CounterModelReviewArgs,
  type CounterModelReviewOutcome,
  type CounterModelVerdict,
  COUNTER_MODEL_VERDICTS,
} from './counter-model.js';

export {
  buildCounterModelPrompt,
  COUNTER_MODEL_SYSTEM_PROMPT,
  parseCounterModelResponse,
  type CounterModelPromptBuild,
} from './prompt-template.js';
