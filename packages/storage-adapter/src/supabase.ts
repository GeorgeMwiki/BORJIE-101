/**
 * Supabase-Storage StorageAdapter — production.
 *
 * Delegates to the `@supabase/supabase-js` storage client. Path
 * conventions mirror `tenantScopedPath`. Adapters created with an
 * `environment` automatically prefix bucket names with
 * `borjie-<environment>-` so dev/staging/production are isolated.
 */

import type { SupabaseClient } from '@borjie/supabase-client';
import {
  type ListedObject,
  type SignedUrl,
  type StorageAdapter,
  type UploadContent,
  type UploadResult,
  StorageAdapterError,
  physicalBucketName,
} from './types.js';

export interface SupabaseStorageOptions {
  readonly supabase: SupabaseClient;
  /**
   * Deployment env, used to compute physical bucket names. Pass the
   * raw logical name and the adapter will compose it with this prefix
   * — keeps callers env-agnostic.
   */
  readonly environment: string;
}

function asBytes(content: UploadContent): Uint8Array {
  if (typeof content === 'string') {
    return new TextEncoder().encode(content);
  }
  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content);
  }
  return content;
}

export function createSupabaseStorageAdapter(
  options: SupabaseStorageOptions,
): StorageAdapter {
  if (!options.supabase) throw new Error('supabase client required');
  if (!options.environment) throw new Error('environment required');

  const resolve = (logical: string): string =>
    physicalBucketName(logical, options.environment);

  return {
    async upload(
      bucket: string,
      path: string,
      content: UploadContent,
      contentType: string,
    ): Promise<UploadResult> {
      const bytes = asBytes(content);
      const physical = resolve(bucket);
      const { error } = await options.supabase.storage
        .from(physical)
        .upload(path, bytes, {
          contentType,
          upsert: true,
          cacheControl: '3600',
        });
      if (error) {
        throw new StorageAdapterError(
          `Supabase upload failed for ${physical}/${path}: ${error.message}`,
          error,
        );
      }
      return { path, size: bytes.byteLength };
    },

    async getUrl(
      bucket: string,
      path: string,
      expiresInSeconds = 3600,
    ): Promise<SignedUrl> {
      const physical = resolve(bucket);
      const { data, error } = await options.supabase.storage
        .from(physical)
        .createSignedUrl(path, expiresInSeconds);
      if (error || !data?.signedUrl) {
        throw new StorageAdapterError(
          `Supabase getUrl failed for ${physical}/${path}: ${error?.message ?? 'unknown'}`,
          error,
        );
      }
      return {
        url: data.signedUrl,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      };
    },

    async delete(bucket: string, path: string): Promise<void> {
      const physical = resolve(bucket);
      const { error } = await options.supabase.storage
        .from(physical)
        .remove([path]);
      if (error) {
        throw new StorageAdapterError(
          `Supabase delete failed for ${physical}/${path}: ${error.message}`,
          error,
        );
      }
    },

    async list(
      bucket: string,
      prefix?: string,
    ): Promise<ReadonlyArray<ListedObject>> {
      const physical = resolve(bucket);
      const { data, error } = await options.supabase.storage
        .from(physical)
        .list(prefix ?? '');
      if (error) {
        throw new StorageAdapterError(
          `Supabase list failed for ${physical}: ${error.message}`,
          error,
        );
      }
      return (data ?? []).map((entry) => ({
        path: prefix ? `${prefix.replace(/\/$/, '')}/${entry.name}` : entry.name,
        size:
          typeof entry.metadata?.size === 'number' ? entry.metadata.size : 0,
        lastModified: entry.updated_at
          ? new Date(entry.updated_at)
          : new Date(0),
      }));
    },
  };
}
