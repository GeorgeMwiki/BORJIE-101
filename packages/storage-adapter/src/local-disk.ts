/**
 * Local-disk StorageAdapter for dev / offline.
 *
 * Mirrors the bucket/path layout under `<rootDir>/<bucket>/<path>`.
 * `getUrl` returns a `file://` URL because the local-disk adapter has
 * no notion of HTTP signing.
 */

import {
  type ListedObject,
  type SignedUrl,
  type StorageAdapter,
  type UploadContent,
  type UploadResult,
} from './types.js';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface LocalDiskOptions {
  /** Filesystem root. Must exist and be writable. */
  readonly rootDir: string;
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

function bucketRoot(rootDir: string, bucket: string): string {
  // Reject `..` to prevent escape; reject empty.
  if (!bucket || bucket.includes('..') || bucket.includes(sep)) {
    throw new Error(`Invalid bucket name: ${bucket}`);
  }
  return join(rootDir, bucket);
}

function objectPath(rootDir: string, bucket: string, path: string): string {
  const safePath = path.replace(/^\/+/, '').replace(/\\/g, '/');
  if (safePath.split('/').some((seg) => seg === '..' || seg === '')) {
    throw new Error(`Invalid object path: ${path}`);
  }
  return join(bucketRoot(rootDir, bucket), ...safePath.split('/'));
}

async function walkDir(
  root: string,
  base: string,
  prefix: string | undefined,
  out: ListedObject[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const abs = join(root, entry.name);
    const rel = posix.join(base, entry.name);
    if (entry.isDirectory()) {
      await walkDir(abs, rel, prefix, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (prefix && !rel.startsWith(prefix)) continue;
    const s = await stat(abs);
    out.push({
      path: rel,
      size: s.size,
      lastModified: s.mtime,
    });
  }
}

export function createLocalDiskStorageAdapter(
  options: LocalDiskOptions,
): StorageAdapter & { readonly rootDir: string } {
  if (!options.rootDir) throw new Error('rootDir required');

  return {
    rootDir: options.rootDir,

    async upload(
      bucket: string,
      path: string,
      content: UploadContent,
      _contentType: string,
    ): Promise<UploadResult> {
      const dest = objectPath(options.rootDir, bucket, path);
      await mkdir(dirname(dest), { recursive: true });
      const bytes = asBytes(content);
      await writeFile(dest, bytes);
      return { path, size: bytes.byteLength };
    },

    async getUrl(
      bucket: string,
      path: string,
      expiresInSeconds = 3600,
    ): Promise<SignedUrl> {
      const abs = objectPath(options.rootDir, bucket, path);
      return {
        url: pathToFileURL(abs).href,
        // Local URLs don't actually expire — we still return a future
        // expiry so callers can treat the interface uniformly.
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      };
    },

    async delete(bucket: string, path: string): Promise<void> {
      const dest = objectPath(options.rootDir, bucket, path);
      try {
        await unlink(dest);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    },

    async list(
      bucket: string,
      prefix?: string,
    ): Promise<ReadonlyArray<ListedObject>> {
      const out: ListedObject[] = [];
      await walkDir(bucketRoot(options.rootDir, bucket), '', prefix, out);
      return out;
    },
  };
}

/**
 * Resolve the local URL produced by `getUrl` back to a filesystem path.
 * Useful for tests that want to assert content on disk.
 */
export function localUrlToPath(url: string): string {
  return fileURLToPath(url);
}
