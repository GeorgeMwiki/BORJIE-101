/**
 * Adapter registry — WAVE 28.
 *
 * Looks up a VendorApiAdapter for a vendor record by the vendor's
 * `integrationId` property. When no adapter is registered for the given
 * id (or the integrationId is absent) we fall back to the manual-queue
 * adapter so the orchestrator NEVER hits an undefined-adapter code path.
 */

import type { VendorAdapterId, VendorApiAdapter } from './adapter-contract.js';
import type { ManualQueueAdapter } from './adapters/manual-queue-adapter.js';

export interface VendorRecordLike {
  readonly id: string;
  readonly integrationId?: VendorAdapterId | string | null;
}

export interface VendorAdapterRegistry {
  resolveForVendor(vendor: VendorRecordLike): VendorApiAdapter;
  resolveById(id: VendorAdapterId | string): VendorApiAdapter;
  list(): readonly VendorApiAdapter[];
  fallback(): ManualQueueAdapter;
}

export function createVendorAdapterRegistry(params: {
  adapters: readonly VendorApiAdapter[];
  fallback: ManualQueueAdapter;
}): VendorAdapterRegistry {
  // Build an index immutably — copy into a fresh Map so the caller keeps
  // ownership of the source array and we cannot mutate it.
  const index = new Map<string, VendorApiAdapter>();
  for (const adapter of params.adapters) {
    index.set(adapter.id, adapter);
  }
  // Manual-queue is always registered under its canonical id (even if
  // the caller forgets to list it) so resolveById('manual-queue') works.
  if (!index.has(params.fallback.id)) {
    index.set(params.fallback.id, params.fallback);
  }

  const resolveById = (id: VendorAdapterId | string): VendorApiAdapter => {
    const adapter = index.get(id);
    return adapter ?? params.fallback;
  };

  const resolveForVendor = (vendor: VendorRecordLike): VendorApiAdapter => {
    if (!vendor.integrationId) return params.fallback;
    return resolveById(vendor.integrationId);
  };

  return {
    resolveById,
    resolveForVendor,
    list() {
      return Array.from(index.values());
    },
    fallback() {
      return params.fallback;
    },
  };
}
