/**
 * Storage Provider Interface
 * Abstraction for document storage - supports S3, local filesystem, etc.
 */

import type { TenantId } from '@borjie/domain-models';

/** Input for uploading a file */
export interface UploadInput {
  readonly tenantId: TenantId;
  readonly key: string;
  readonly content: Buffer | Blob;
  readonly contentType: string;
  readonly metadata?: Record<string, string>;
}

/** Result of upload operation */
export interface UploadResult {
  readonly key: string;
  readonly url: string;
  readonly etag?: string;
}

/** Options for generating signed URLs */
export interface SignedUrlOptions {
  readonly expiresIn: number; // seconds
  readonly responseContentDisposition?: string;
}

/** Storage provider interface - abstracts S3, local filesystem, etc. */
export interface StorageProvider {
  /** Upload a file and return its storage key and URL */
  upload(input: UploadInput): Promise<UploadResult>;

  /** Get a signed URL for temporary access */
  getSignedUrl(tenantId: TenantId, key: string, options: SignedUrlOptions): Promise<string>;

  /** Delete a file by key */
  delete(tenantId: TenantId, key: string): Promise<void>;

  /** Check if a file exists */
  exists(tenantId: TenantId, key: string): Promise<boolean>;

  /** Get the base URL for the storage (e.g. bucket URL) */
  getBaseUrl(tenantId: TenantId): string;
}
