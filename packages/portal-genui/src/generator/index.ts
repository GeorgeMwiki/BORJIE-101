/** Public surface for the generator subsystem. */

export {
  createTabGenerator,
  type TabGenerator,
  type GeneratorBrainPort,
  type GeneratorBrainCall,
  type GeneratorBrainResult,
  type GeneratorDeps,
  type GenerateTabInput,
  type GenerateTabResult,
} from './generator.js';

export {
  buildGenerationSystemPrompt,
  buildGenerationUserMessage,
} from './prompt.js';

export {
  buildFallbackTab,
  getDomainSkeleton,
  getDefaultIcon,
} from './fallbacks.js';

export {
  buildCacheKey,
  createInMemoryGeneratorCache,
  type GeneratorCache,
  type GeneratorCacheEntry,
} from './cache.js';
