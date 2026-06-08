/**
 * Storage PORT — signed-URL delivery, not bound to a concrete bucket.
 *
 * The engine never imports a Supabase/S3 client. It uploads artifact
 * bytes through this port and receives a signed, time-limited URL back.
 * A host wires a real adapter (e.g. over `@borjie/storage-adapter`); the
 * engine ships an in-memory implementation for hermetic tests.
 *
 * The port speaks in tenant-scoped logical paths so RLS/bucket policies
 * (first path segment = tenant_id) hold wherever it is wired.
 *
 * @module @borjie/media-engine/storage/storage-port
 */

export interface StoredObject {
  /** Logical, tenant-scoped storage key (e.g. `<tenant>/<artifact>.png`). */
  readonly storageKey: string;
  readonly byteLength: number;
}

export interface SignedDelivery {
  readonly url: string;
  readonly expiresAt: string;
}

/**
 * The single storage port the engine consumes. Implementations own
 * retries + bucket selection; the engine only knows logical keys.
 */
export interface MediaStoragePort {
  /**
   * Upload bytes under a tenant-scoped logical key. Returns the stored
   * object descriptor (the same key it was given, plus size).
   */
  put(
    tenantId: string,
    storageKey: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<StoredObject>;
  /**
   * Mint a signed, time-limited delivery URL for a stored object. Never
   * a public bucket URL for pending/tier-2 content.
   */
  sign(
    tenantId: string,
    storageKey: string,
    expiresInSeconds: number,
  ): Promise<SignedDelivery>;
}

/**
 * Compose a tenant-scoped key the same way the storage RLS policy
 * expects (`(storage.foldername(name))[1] = current_tenant_id`). Mirrors
 * `@borjie/storage-adapter` `tenantScopedPath` without importing it, so
 * this package stays dependency-light.
 */
export function tenantScopedKey(tenantId: string, fileName: string): string {
  if (!tenantId || tenantId.includes('/')) {
    throw new Error(
      `invalid tenantId for storage key: '${tenantId}' — non-empty, no '/'`,
    );
  }
  if (!fileName) throw new Error('fileName required for tenant-scoped key');
  const clean = fileName.replace(/^\/+/, '');
  return `${tenantId}/${clean}`;
}
