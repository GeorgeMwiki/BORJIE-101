/**
 * StorageAdapter-backed StorageProvider — the canonical wiring of the
 * shared `@borjie/storage-adapter` port into the legacy
 * `StorageProvider` interface that `DocumentService`,
 * `EvidencePackBuilderService`, and other existing consumers depend on.
 *
 * Why this exists (wiring-gaps-audit chain 6): before this bridge, the
 * shared `StorageAdapter` port had ZERO non-self consumers. Production
 * upload code was wiring to ad-hoc `StorageProvider` implementations
 * (S3/GCS/local-disk) whose tenant-scoping rules each duplicated by hand.
 * Routing those consumers through this single bridge gives us one place
 * where `tenantScopedPath(tenantId, key)` is enforced — and therefore
 * one place where Supabase Storage RLS (which keys off the first path
 * segment) is guaranteed to match.
 *
 * Security invariants:
 *   - Every read/write/delete/exists/list passes through
 *     `tenantScopedPath(tenantId, key)`. The caller never composes the
 *     bucket key themselves.
 *   - `tenantId` MUST be derived from the caller's authenticated session
 *     (NEVER from request body/path/query). Callers that violate this
 *     contract are the cross-tenant leak; this adapter cannot rescue
 *     a forged tenantId because the adapter trusts its input.
 *   - The bucket parameter is operator-configured at construction time
 *     and never tenant-controlled.
 */

import type { TenantId } from '@borjie/domain-models';
import {
  type StorageAdapter,
  tenantScopedPath,
} from '@borjie/storage-adapter';
import type {
  SignedUrlOptions,
  StorageProvider,
  UploadInput,
  UploadResult,
} from './storage-provider.interface.js';

export interface StorageAdapterProviderOptions {
  /** The underlying StorageAdapter port (Supabase / local-disk / in-memory). */
  readonly adapter: StorageAdapter;
  /**
   * The logical bucket name used for every operation. Pass the
   * STANDARD_BUCKET literal (e.g. `'documents'`, `'media-photos'`); the
   * underlying adapter handles env-prefixing.
   */
  readonly bucket: string;
  /**
   * Public URL prefix exposed by `getBaseUrl`. The legacy contract has
   * callers occasionally embed `baseUrl + key` into responses — this lets
   * the bridge return a stable, scoped URL prefix without leaking the
   * physical bucket name. Defaults to `/storage/<bucket>` which the
   * gateway can rewrite as needed.
   */
  readonly baseUrlPrefix?: string;
  /** Default signed-URL TTL in seconds when `getSignedUrl` is called. */
  readonly defaultExpiresInSeconds?: number;
}

/**
 * Bridge: implements the legacy `StorageProvider` by delegating to the
 * shared `StorageAdapter` port. Always tenant-scopes the path so the
 * underlying Supabase RLS policy matches.
 */
export function createStorageAdapterProvider(
  options: StorageAdapterProviderOptions,
): StorageProvider {
  if (!options.adapter) throw new Error('adapter required');
  if (!options.bucket) throw new Error('bucket required');

  const adapter = options.adapter;
  const bucket = options.bucket;
  const baseUrlPrefix = options.baseUrlPrefix ?? `/storage/${bucket}`;
  const defaultExpires = options.defaultExpiresInSeconds ?? 3600;

  function bytesFromInput(
    input: UploadInput,
  ): Promise<Uint8Array> | Uint8Array {
    const c = input.content;
    if (c instanceof Blob) {
      // Blob → Uint8Array via arrayBuffer().
      return c
        .arrayBuffer()
        .then((ab) => new Uint8Array(ab));
    }
    // Buffer extends Uint8Array.
    return c as unknown as Uint8Array;
  }

  return {
    async upload(input: UploadInput): Promise<UploadResult> {
      const path = tenantScopedPath(String(input.tenantId), input.key);
      const bytes = await bytesFromInput(input);
      const result = await adapter.upload(
        bucket,
        path,
        bytes,
        input.contentType,
      );
      // Returned `key` is the original (un-scoped) key so the legacy
      // consumers can store it without leaking the tenant prefix; the
      // bridge re-scopes on every subsequent read/write/delete.
      return {
        key: input.key,
        url: `${baseUrlPrefix}/${path}`,
      };
    },

    async getSignedUrl(
      tenantId: TenantId,
      key: string,
      opts: SignedUrlOptions,
    ): Promise<string> {
      const path = tenantScopedPath(String(tenantId), key);
      const signed = await adapter.getUrl(
        bucket,
        path,
        opts.expiresIn ?? defaultExpires,
      );
      return signed.url;
    },

    async delete(tenantId: TenantId, key: string): Promise<void> {
      const path = tenantScopedPath(String(tenantId), key);
      await adapter.delete(bucket, path);
    },

    async exists(tenantId: TenantId, key: string): Promise<boolean> {
      const path = tenantScopedPath(String(tenantId), key);
      // The StorageAdapter port has no `exists()`; we approximate by
      // listing the tenant's prefix and checking membership. This is
      // O(n) in the tenant's file count — fine for the per-file
      // pre-condition checks the legacy callers do, not fine for hot
      // loops. Callers that need hot-path existence checks should keep
      // their own index in the document repository (which they already do).
      const prefix = `${String(tenantId)}/`;
      const objects = await adapter.list(bucket, prefix);
      return objects.some((o) => o.path === path);
    },

    getBaseUrl(tenantId: TenantId): string {
      return `${baseUrlPrefix}/${String(tenantId)}`;
    },
  };
}
