/**
 * S3 Storage Provider
 * Production storage using AWS S3 with tenant-prefixed keys.
 */

import type { TenantId } from '@borjie/domain-models';
import type { StorageProvider, UploadInput, UploadResult, SignedUrlOptions } from './storage-provider.interface.js';

/** S3 client interface - use @aws-sdk/client-s3 in production */
export interface S3ClientLike {
  putObject(params: {
    Bucket: string;
    Key: string;
    Body: Buffer | Blob;
    ContentType?: string;
    Metadata?: Record<string, string>;
  }): Promise<{ ETag?: string }>;
  deleteObject(params: { Bucket: string; Key: string }): Promise<void>;
  headObject(params: { Bucket: string; Key: string }): Promise<unknown>;
  getSignedUrl?(operation: string, params: Record<string, unknown>, expiresIn: number): Promise<string>;
}

export interface S3StorageProviderOptions {
  readonly bucket: string;
  readonly s3Client: S3ClientLike;
  readonly region?: string;
}

/**
 * S3 Storage Provider
 * Uses tenant-prefixed keys for multi-tenant isolation: {tenantId}/{key}
 */
export class S3StorageProvider implements StorageProvider {
  private readonly bucket: string;
  private readonly s3: S3ClientLike;

  constructor(options: S3StorageProviderOptions) {
    this.bucket = options.bucket;
    this.s3 = options.s3Client;
  }

  private getS3Key(tenantId: TenantId, key: string): string {
    return `${String(tenantId)}/${key}`;
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const s3Key = this.getS3Key(input.tenantId, input.key);
    const content = input.content instanceof Blob
      ? Buffer.from(await input.content.arrayBuffer())
      : (input.content as Buffer);

    const result = await this.s3.putObject({
      Bucket: this.bucket,
      Key: s3Key,
      Body: content,
      ContentType: input.contentType,
      Metadata: input.metadata ? { ...input.metadata } : undefined,
    });

    const url = `https://${this.bucket}.s3.amazonaws.com/${s3Key}`;
    return { key: input.key, url, etag: result.ETag };
  }

  async getSignedUrl(tenantId: TenantId, key: string, options: SignedUrlOptions): Promise<string> {
    const s3Key = this.getS3Key(tenantId, key);

    if (this.s3.getSignedUrl) {
      return this.s3.getSignedUrl(
        'getObject',
        {
          Bucket: this.bucket,
          Key: s3Key,
          ResponseContentDisposition: options.responseContentDisposition,
        },
        options.expiresIn
      );
    }

    throw new Error(
      'S3 client does not support getSignedUrl. Use @aws-sdk/s3-request-presigner with GetObjectCommand.'
    );
  }

  async delete(tenantId: TenantId, key: string): Promise<void> {
    const s3Key = this.getS3Key(tenantId, key);
    await this.s3.deleteObject({ Bucket: this.bucket, Key: s3Key });
  }

  async exists(tenantId: TenantId, key: string): Promise<boolean> {
    try {
      const s3Key = this.getS3Key(tenantId, key);
      await this.s3.headObject({ Bucket: this.bucket, Key: s3Key });
      return true;
    } catch {
      return false;
    }
  }

  getBaseUrl(tenantId: TenantId): string {
    return `https://${this.bucket}.s3.amazonaws.com/${String(tenantId)}`;
  }
}
