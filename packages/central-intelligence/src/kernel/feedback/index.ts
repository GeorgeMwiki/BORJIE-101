/**
 * Kernel feedback port — barrel.
 *
 * The kernel's online-learning side-channel: read-only access at
 * step 4 (memory recall) to the user's recent thumbs / corrections
 * so the next turn can apologise for past mistakes and bias toward
 * conservative output when the negative-rate is elevated. Mirrors
 * LITFIN's feedback loop and closes the "stock LLMs are STATIC"
 * assessment gap.
 *
 * Adapters live in `@borjie/database`; the api-gateway
 * composition root binds them via BrainKernelDeps.feedback.
 */

export type {
  FeedbackEntry,
  FeedbackMemoryPort,
  FeedbackRecallArgs,
  FeedbackSignal,
} from './types.js';
