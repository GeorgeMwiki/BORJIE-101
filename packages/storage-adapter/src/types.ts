/**
 * StorageAdapter port + bucket/path conventions.
 *
 * The platform stores its files in seven well-known buckets. Each
 * bucket's RLS policy (see `supabase/storage-policies.sql`) requires
 * the first path segment to be the tenant_id, so cross-tenant access
 * is impossible by construction. The `tenantScopedPath` helper makes
 * that convention safe and obvious.
 */

import { z } from 'zod';

/**
 * Canonical bucket names. These map 1:1 to physical Supabase buckets
 * named `borjie-<env>-<bucket>` (the env prefix is applied by the
 * Supabase adapter, not at the port level).
 */
export const STANDARD_BUCKETS = [
  'documents',
  'media-photos',
  'media-videos',
  'media-audio',
  'reports',
  'avatars',
  'tenant-uploads',
] as const;

export type StandardBucket = (typeof STANDARD_BUCKETS)[number];

/**
 * Compose a tenant-scoped path so RLS policy
 * `(storage.foldername(name))[1] = current_setting('app.current_tenant_id')`
 * matches. Always prefer this over manual concatenation.
 */
export function tenantScopedPath(
  tenantId: string,
  fileId: string,
): string {
  if (!tenantId || tenantId.includes('/')) {
    throw new Error(
      `Invalid tenantId for storage path: '${tenantId}' — must be non-empty and contain no '/'`,
    );
  }
  if (!fileId) throw new Error('fileId required for tenant-scoped path');
  // Strip any leading slash on fileId; nothing forces the caller, so
  // we normalise here to avoid `tenantId//file` glitches.
  const cleanFile = fileId.replace(/^\/+/, '');
  return `${tenantId}/${cleanFile}`;
}

/**
 * Extract tenantId from a path produced by `tenantScopedPath`. Returns
 * null if the path does not match the convention.
 */
export function tenantIdFromPath(path: string): string | null {
  const parts = path.split('/');
  if (parts.length < 2) return null;
  const t = parts[0];
  return t && t.length > 0 ? t : null;
}

export const UploadContentSchema = z.union([
  z.instanceof(Uint8Array),
  z.instanceof(ArrayBuffer),
  z.string(),
]);

export type UploadContent = Uint8Array | ArrayBuffer | string;

export interface ListedObject {
  readonly path: string;
  readonly size: number;
  readonly lastModified: Date;
}

export interface SignedUrl {
  readonly url: string;
  readonly expiresAt: Date;
}

export interface UploadResult {
  readonly path: string;
  readonly size: number;
}

/**
 * The single port adapters implement. Side-effect-free at the type
 * level — implementations are responsible for their own retries.
 */
export interface StorageAdapter {
  /** Upload bytes to `bucket/path`. Returns the resulting path + size. */
  upload(
    bucket: string,
    path: string,
    content: UploadContent,
    contentType: string,
  ): Promise<UploadResult>;

  /**
   * Get a (signed, time-limited) URL for `bucket/path`. Supabase
   * adapters return a signed URL; the local-disk adapter returns a
   * `file://` URL.
   *
   * `expiresInSeconds` defaults to 3600 (one hour). The adapter MAY
   * choose to ignore it (e.g. local-disk).
   */
  getUrl(
    bucket: string,
    path: string,
    expiresInSeconds?: number,
  ): Promise<SignedUrl>;

  /** Delete one object. No-op if missing. */
  delete(bucket: string, path: string): Promise<void>;

  /** List objects under an optional path prefix. */
  list(bucket: string, prefix?: string): Promise<ReadonlyArray<ListedObject>>;
}

export class StorageAdapterError extends Error {
  readonly kind = 'StorageAdapterError' as const;
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'StorageAdapterError';
    this.cause = cause;
  }
}

/**
 * Compute the physical Supabase bucket name from a logical bucket name
 * and the deployment environment. e.g. `'documents'`, `'production'`
 * → `'borjie-production-documents'`.
 */
export function physicalBucketName(
  logical: string,
  environment: string,
): string {
  if (!environment) throw new Error('environment required');
  return `borjie-${environment}-${logical}`;
}
