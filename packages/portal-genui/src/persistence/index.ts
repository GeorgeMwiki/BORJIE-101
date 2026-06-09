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

export {
  createDrizzleRecordStore,
  createInMemoryRecordStore,
  RecordValidationError,
  type RecordStore,
  type PortalTabRecord,
  type SaveRecordInput,
  type ListRecordsInput,
  type GetRecordInput,
  type DrizzleRecordStoreDeps,
  type InMemoryRecordStoreOptions,
} from './record-store.js';

export {
  buildRecordValidator,
  validateRecordPayload,
  validateRecordAgainstTab,
  type RecordValidationResult,
  type RecordValidationSuccess,
  type RecordValidationFailure,
} from './record-validator.js';
