/**
 * `@borjie/storage-adapter` — public surface.
 *
 * Port + three adapters (Supabase, local disk, in-memory) so the rest
 * of the platform can depend on a single `StorageAdapter` interface
 * regardless of the backend.
 */

export {
  STANDARD_BUCKETS,
  type StandardBucket,
  tenantScopedPath,
  tenantIdFromPath,
  physicalBucketName,
  UploadContentSchema,
  type UploadContent,
  type ListedObject,
  type SignedUrl,
  type StorageAdapter,
  type UploadResult,
  StorageAdapterError,
} from './types.js';

export { createInMemoryStorageAdapter } from './in-memory.js';

export {
  createLocalDiskStorageAdapter,
  localUrlToPath,
  type LocalDiskOptions,
} from './local-disk.js';

export {
  createSupabaseStorageAdapter,
  type SupabaseStorageOptions,
} from './supabase.js';
