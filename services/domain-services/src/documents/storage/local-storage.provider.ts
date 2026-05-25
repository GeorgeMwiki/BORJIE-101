/**
 * Local Storage Provider
 * For development - stores files in local filesystem with tenant isolation.
 *
 * Security: every filesystem operation goes through `safeResolve()` which
 * rejects path traversal (`..`, absolute paths, NUL bytes) before any
 * call reaches `node:fs`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TenantId } from '@borjie/domain-models';
import type { StorageProvider, UploadInput, UploadResult, SignedUrlOptions } from './storage-provider.interface.js';

/** Default base path for local storage */
const DEFAULT_BASE_PATH = './storage/documents';

export interface LocalStorageProviderOptions {
  readonly basePath?: string;
}

export class LocalStorageProvider implements StorageProvider {
  private readonly basePath: string;

  constructor(options: LocalStorageProviderOptions = {}) {
    this.basePath = path.resolve(options.basePath ?? path.resolve(process.cwd(), DEFAULT_BASE_PATH));
  }

  private getTenantPath(tenantId: TenantId): string {
    return path.join(this.basePath, String(tenantId));
  }

  /**
   * Resolve a user-provided key to an absolute path guaranteed to stay within
   * `this.basePath`. Any attempt to traverse (`..`, NUL, absolute) throws.
   */
  private safeResolve(tenantId: TenantId, key: string): string {
    if (typeof key !== 'string' || key.length === 0 || key.length > 512) {
      throw new Error('Invalid storage key: length out of range');
    }
    if (key.includes('\0')) {
      throw new Error('Invalid storage key: NUL byte');
    }
    const tenantPath = path.resolve(this.getTenantPath(tenantId));
    const fullPath = path.resolve(tenantPath, key);
    const rel = path.relative(tenantPath, fullPath);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Invalid storage key: path traversal detected');
    }
    return fullPath;
  }

  async upload(input: UploadInput): Promise<UploadResult> {
    const fullPath = this.safeResolve(input.tenantId, input.key);
    const dir = path.dirname(fullPath);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by safeResolve()
    if (!fs.existsSync(dir)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by safeResolve()
      fs.mkdirSync(dir, { recursive: true });
    }

    const content = input.content instanceof Blob
      ? Buffer.from(await input.content.arrayBuffer())
      : (input.content as Buffer);

    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by safeResolve()
    fs.writeFileSync(fullPath, content);

    const url = `/documents/${input.tenantId}/${input.key}`;
    return { key: input.key, url };
  }

  async getSignedUrl(tenantId: TenantId, key: string, _options: SignedUrlOptions): Promise<string> {
    const fullPath = this.safeResolve(tenantId, key);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by safeResolve()
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${key}`);
    }
    return `/documents/${tenantId}/${key}`;
  }

  async delete(tenantId: TenantId, key: string): Promise<void> {
    const fullPath = this.safeResolve(tenantId, key);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by safeResolve()
    if (fs.existsSync(fullPath)) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by safeResolve()
      fs.unlinkSync(fullPath);
    }
  }

  async exists(tenantId: TenantId, key: string): Promise<boolean> {
    const fullPath = this.safeResolve(tenantId, key);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path validated by safeResolve()
    return fs.existsSync(fullPath);
  }

  getBaseUrl(tenantId: TenantId): string {
    return `/documents/${tenantId}`;
  }
}
