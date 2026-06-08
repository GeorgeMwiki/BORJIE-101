/**
 * In-memory {@link MediaStoragePort} for hermetic tests and the
 * zero-infrastructure default. Mints a deterministic `memory://` signed
 * URL with an expiry derived from an injected clock. Not for production
 * delivery — a host wires a real adapter over `@borjie/storage-adapter`.
 *
 * @module @borjie/media-engine/storage/in-memory-storage
 */

import type {
  MediaStoragePort,
  SignedDelivery,
  StoredObject,
} from './storage-port.js';

export interface InMemoryStorageOptions {
  /** Injected clock so expiry is deterministic in tests. */
  readonly now?: () => Date;
}

export interface InMemoryStorage extends MediaStoragePort {
  /** Test helper: read back stored bytes by tenant + key. */
  read(tenantId: string, storageKey: string): Uint8Array | undefined;
}

export function createInMemoryStorage(
  options: InMemoryStorageOptions = {},
): InMemoryStorage {
  const now = options.now ?? (() => new Date());
  const store = new Map<string, Uint8Array>();
  const composite = (tenantId: string, key: string): string =>
    `${tenantId}::${key}`;

  return {
    put: async (
      tenantId: string,
      storageKey: string,
      body: Uint8Array,
    ): Promise<StoredObject> => {
      store.set(composite(tenantId, storageKey), body);
      return { storageKey, byteLength: body.byteLength };
    },
    sign: async (
      tenantId: string,
      storageKey: string,
      expiresInSeconds: number,
    ): Promise<SignedDelivery> => {
      const expiresAt = new Date(
        now().getTime() + expiresInSeconds * 1000,
      ).toISOString();
      return {
        url: `memory://${tenantId}/${storageKey}?expires=${expiresAt}`,
        expiresAt,
      };
    },
    read: (tenantId: string, storageKey: string) =>
      store.get(composite(tenantId, storageKey)),
  };
}
