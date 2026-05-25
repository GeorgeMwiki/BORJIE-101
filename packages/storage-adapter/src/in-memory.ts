/**
 * In-memory StorageAdapter for tests.
 *
 * No I/O. Keeps each bucket's contents in a Map. URLs returned by
 * `getUrl` are opaque `memory://` placeholders that the test layer
 * can compare against.
 */

import {
  type ListedObject,
  type SignedUrl,
  type StorageAdapter,
  type UploadContent,
  type UploadResult,
} from './types.js';

interface MemoryObject {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly lastModified: Date;
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

export function createInMemoryStorageAdapter(): StorageAdapter & {
  /** Test-only escape hatch — total object count across all buckets. */
  readonly _count: () => number;
} {
  const buckets = new Map<string, Map<string, MemoryObject>>();

  function getBucket(name: string): Map<string, MemoryObject> {
    let b = buckets.get(name);
    if (!b) {
      b = new Map();
      buckets.set(name, b);
    }
    return b;
  }

  return {
    async upload(
      bucket: string,
      path: string,
      content: UploadContent,
      contentType: string,
    ): Promise<UploadResult> {
      const bytes = asBytes(content);
      getBucket(bucket).set(path, {
        bytes,
        contentType,
        lastModified: new Date(),
      });
      return { path, size: bytes.byteLength };
    },

    async getUrl(
      bucket: string,
      path: string,
      expiresInSeconds = 3600,
    ): Promise<SignedUrl> {
      return {
        url: `memory://${bucket}/${path}`,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      };
    },

    async delete(bucket: string, path: string): Promise<void> {
      getBucket(bucket).delete(path);
    },

    async list(
      bucket: string,
      prefix?: string,
    ): Promise<ReadonlyArray<ListedObject>> {
      const b = getBucket(bucket);
      const out: ListedObject[] = [];
      for (const [path, obj] of b) {
        if (prefix && !path.startsWith(prefix)) continue;
        out.push({
          path,
          size: obj.bytes.byteLength,
          lastModified: obj.lastModified,
        });
      }
      return out;
    },

    _count(): number {
      let n = 0;
      for (const b of buckets.values()) n += b.size;
      return n;
    },
  };
}
