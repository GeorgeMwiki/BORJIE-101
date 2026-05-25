/**
 * Memory Recall Bench — barrel.
 *
 * Phase D fix-wave (A4) — closes parity gap "Memory recall bench"
 * (`.planning/parity-litfin/08-eval-judge.md` Gap 8 / `00-STATUS-2026-05-18.md` §4).
 */

export { runRecallBench } from './runner.js';
export { seedRecallCorpus } from './seeder.js';
export { tokenF1, tokenise } from './tokenize.js';
export type {
  RecallBenchInput,
  RecallBenchOptions,
  RecallBenchReport,
  RecallMetric,
  RecallSample,
} from './types.js';
