/**
 * Google Cloud Storage Provider
 * Production storage using Google Cloud Storage with tenant-prefixed keys.
 */

import type { TenantId } from '@borjie/domain-models';
import type { StorageProvider, UploadInput, UploadResult, SignedUrlOptions } from './storage-provider.interface.js';

/** GCS client interface - use @google-cloud/storage in production */
export interface GCSClientLike {
  bucket(name: string): GCSBucketLike;
}

export interface GCSBucketLike {
  file(name: string): GCSFileLike;
  upload(
    pathOrBuffer: Buffer | string,
    options?: { metadata?: { contentType?: string; metadata?: Record<string, string> } }
  ): Promise<[{ metadata: { name: string; mediaLink?: string } }]>;
}

export interface GCSFileLike {
  save(
    data: Buffer | string,
    options?: {
      metadata?: {
        contentType?: string;
        metadata?: Record<string, string>;
      };
    }
  ): Promise<void>;
  getSignedUrl(config: { action: string; expires: number }): Promise<[string]>;
  delete(): Promise<void>;
  exists(): Promise<[boolean]>;
}

export interface GCSStorageProviderOptions {
  readonly bucket: string;
  readonly gcsClient: GCSClientLike;
}

/**
 * GCS Storage Provider
 * Uses tenant-prefixed keys for multi-tenant isolation: {tenantId}/{key}
 */
export class GCSStorageProvider implements StorageProvider {
  private readonly bucket: string;
  private readonly gcs: GCSClientLike;

  constructor(options: GCSStorageProviderOptions) {
    this.bucket = options.bucket;
    this.gcs = options.gcsClient;
  }

  private getGCSKey(tenantId: TenantId, key: string): string {
    return `${String(tenantId)}/${key}`;
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const gcsKey = this.getGCSKey(input.tenantId, input.key);
    const content = input.content instanceof Blob
      ? Buffer.from(await input.content.arrayBuffer())
      : (input.content as Buffer);

    const bucket = this.gcs.bucket(this.bucket);
    const file = bucket.file(gcsKey);

    await file.save(content, {
      metadata: {
        contentType: input.contentType,
        ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
      },
    });

    const url = `https://storage.googleapis.com/${this.bucket}/${gcsKey}`;
    return { key: input.key, url };
  }

  async getSignedUrl(tenantId: TenantId, key: string, options: SignedUrlOptions): Promise<string> {
    const gcsKey = this.getGCSKey(tenantId, key);
    const bucket = this.gcs.bucket(this.bucket);
    const file = bucket.file(gcsKey);

    const [url] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + options.expiresIn * 1000,
    });

    return url;
  }

  async delete(tenantId: TenantId, key: string): Promise<void> {
    const gcsKey = this.getGCSKey(tenantId, key);
    const bucket = this.gcs.bucket(this.bucket);
    const file = bucket.file(gcsKey);
    await file.delete();
  }

  async exists(tenantId: TenantId, key: string): Promise<boolean> {
    try {
      const gcsKey = this.getGCSKey(tenantId, key);
      const bucket = this.gcs.bucket(this.bucket);
      const file = bucket.file(gcsKey);
      const [exists] = await file.exists();
      return exists;
    } catch {
      return false;
    }
  }

  getBaseUrl(tenantId: TenantId): string {
    return `https://storage.googleapis.com/${this.bucket}/${String(tenantId)}`;
  }
}
