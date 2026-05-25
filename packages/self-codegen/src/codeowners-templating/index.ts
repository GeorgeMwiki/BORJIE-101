/**
 * Module 5 — codeowners-templating
 * yml → CODEOWNERS file + required-reviewer-rule JSON.
 */

export * from './types.js';
export {
  generateCodeownersFile,
  generateRequiredReviewerRuleset,
} from './generate-codeowners.js';
export {
  loadCodeownersConfigFromYml,
  DEFAULT_BORJIE_CODEOWNERS_YML,
} from './load-yml.js';
