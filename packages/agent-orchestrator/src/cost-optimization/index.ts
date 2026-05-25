/**
 * Cost-optimization subsystem barrel.
 */

export {
  wrapWithBudget,
  BudgetExceededError,
  type BudgetedBrain,
  type BudgetState,
  type WrapWithBudgetInput,
} from './budget.js';

export {
  createModelRouter,
  defaultComplexityScorer,
  type BrainPerTier,
  type CreateModelRouterInput,
  type RoutedBrain,
} from './model-router.js';

export {
  createPromptCacheManager,
  type CacheStats,
  type CreatePromptCacheInput,
  type PromptCacheManager,
} from './prompt-cache.js';

export {
  createBatchExecutor,
  DEFAULT_BATCH_SIZE,
  type BatchBrainPort,
  type BatchExecutor,
  type CreateBatchExecutorInput,
} from './batch-executor.js';
