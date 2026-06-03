/**
 * `@borjie/brain-llm-router/judge-loop` (LP-11) — public surface.
 *
 * Self-judge regenerate loop: score a draft 0–100, regenerate with feedback
 * while below threshold, return the best attempt. Generator + judge are
 * injected ports.
 */

export {
  runJudgeLoop,
  type JudgeVerdict,
  type GeneratePort,
  type JudgePort,
  type JudgeLoopConfig,
  type JudgeLoopAttempt,
  type JudgeLoopResult,
} from './judge-loop.js';
