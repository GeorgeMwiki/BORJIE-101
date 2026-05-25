/** Public surface for the persistence subsystem. */

export {
  createInMemoryTabRegistry,
  type TabRegistry,
  type SaveTabInput,
  type SaveTabResult,
  type ListTabsInput,
  type DeleteTabInput,
  type InMemoryRegistryOptions,
} from './registry.js';

export {
  createDrizzleTabRegistry,
  type DbExecutor,
  type DrizzleTabRegistryDeps,
} from './drizzle-tab-repo.js';
