/**
 * Module 6 — multi-agent-reflexion
 * 3 parallel critics (factual + senior-eng + security) → combined verdict.
 */

export * from './types.js';
export {
  runReflexionRound,
  combineCriticVerdicts,
  DEFAULT_CRITICS,
} from './run-reflexion.js';
