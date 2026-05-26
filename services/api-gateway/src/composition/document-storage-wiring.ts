/**
 * Document-storage wiring — composition-root flip that activates the
 * P40 `createStorageAdapterProvider` bridge (lives in
 * `@borjie/domain-services/documents`) and binds it to the shared
 * `@borjie/storage-adapter` Supabase backend via the typed
 * `@borjie/supabase-client` admin client.
 *
 * Why this exists:
 *
 *   P40 shipped `createStorageAdapterProvider` — the canonical bridge
 *   that implements the legacy `StorageProvider` interface (consumed by
 *   `DocumentService`, `EvidencePackBuilderService`, and the rest of the
 *   document pipeline) by delegating every operation through
 *   `tenantScopedPath(tenantId, key)` on the shared StorageAdapter port.
 *   The bridge was built but never wired into the composition root, so
 *   the audit trail still listed it as a "wiring gap": ZERO non-self
 *   consumers in production.
 *
 *   This module closes that gap by constructing the bridge at boot and
 *   surfacing it on `ServiceRegistry.documentStorage` so downstream
 *   service constructors (and routers that lazily instantiate
 *   DocumentService / EvidencePackBuilderService) automatically inherit
 *   the tenant-scoped Supabase Storage path on every call.
 *
 * Backward compatibility:
 *
 *   - When `NEXT_PUBLIC_SUPABASE_URL` AND `SUPABASE_SERVICE_ROLE_KEY`
 *     are both set, we wire the Supabase bridge.
 *   - Otherwise we fall back to `LocalStorageProvider` (same default
 *     used by every dev / CI environment today) so the gateway boots
 *     without crashing on local stacks that have no Supabase project.
 *   - Either path returns a fully-functional `StorageProvider`; callers
 *     never branch on which backend they got.
 *
 * Tenant-isolation invariants — see the bridge itself
 * (`storage-adapter.provider.ts`) for the full security narrative. In
 * short: every read/write/delete/exists/list passes through
 * `tenantScopedPath(tenantId, key)`, and `tenantId` MUST come from the
 * authenticated session (never from request body/path/query).
 */

import {
  createSupabaseStorageAdapter,
  type StorageAdapter,
} from '@borjie/storage-adapter';
import { createSupabaseAdminClient } from '@borjie/supabase-client';
import {
  createStorageAdapterProvider,
  LocalStorageProvider,
  type StorageProvider,
} from '@borjie/domain-services/documents';

/**
 * The logical bucket name used for the document pipeline (DocumentService
 * uploads + EvidencePackBuilderService PDF outputs). Matches the
 * STANDARD_BUCKETS literal shipped by `@borjie/storage-adapter`; the
 * underlying Supabase adapter env-prefixes the physical name.
 */
export const DOCUMENTS_BUCKET = 'documents';

export interface DocumentStorageWiringDeps {
  /**
   * Override env-derived values for tests. When omitted we read from
   * `process.env` so the production path is zero-config.
   */
  readonly env?: {
    readonly supabaseUrl?: string;
    readonly supabaseServiceRoleKey?: string;
    readonly supabaseEnvironment?: string;
    readonly localStorageBasePath?: string;
  };
  /**
   * Pre-built StorageAdapter for tests that want to assert against the
   * in-memory adapter without spinning up a real Supabase client.
   * When set, the bridge is built directly on this adapter and the
   * Supabase env vars are ignored.
   */
  readonly overrideAdapter?: StorageAdapter;
  /** Optional structured logger for the boot-mode hint. */
  readonly logger?: {
    info?(obj: Record<string, unknown>, msg?: string): void;
    warn?(obj: Record<string, unknown>, msg?: string): void;
  };
}

export interface DocumentStorageWiring {
  /** The wired `StorageProvider` consumed by DocumentService / EvidencePackBuilder. */
  readonly provider: StorageProvider;
  /** Which path the wiring took at boot — useful for ops dashboards. */
  readonly mode: 'supabase-adapter' | 'legacy-local';
  /** The bucket the bridge was bound to (when mode === 'supabase-adapter'). */
  readonly bucket: string | null;
}

/**
 * Construct the document StorageProvider.
 *
 * Decision tree:
 *
 *   1. `overrideAdapter` set        → build the bridge on that adapter
 *      (test-only path; uses `LOCAL_DEV` as the env-prefix so paths are
 *      readable in assertions).
 *
 *   2. Both Supabase URL + service-role key present → build the bridge
 *      on a `createSupabaseAdminClient` + `createSupabaseStorageAdapter`
 *      stack. This is the production path.
 *
 *   3. Otherwise → fall back to `LocalStorageProvider` (the existing
 *      dev/CI default). The gateway still boots; uploads land on local
 *      disk under `./storage/documents/<tenantId>/...`.
 */
export function createDocumentStorageWiring(
  deps: DocumentStorageWiringDeps = {},
): DocumentStorageWiring {
  const env = deps.env ?? {};
  const supabaseUrl =
    env.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey =
    env.supabaseServiceRoleKey ??
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const environment =
    env.supabaseEnvironment ??
    process.env.SUPABASE_ENVIRONMENT?.trim() ??
    process.env.NODE_ENV?.trim() ??
    'development';

  // Test path — caller provided a pre-built adapter (typically the
  // in-memory one). Skip the Supabase client entirely so we don't blow
  // up the env-validation on `createSupabaseAdminClient`.
  if (deps.overrideAdapter) {
    const provider = createStorageAdapterProvider({
      adapter: deps.overrideAdapter,
      bucket: DOCUMENTS_BUCKET,
    });
    return { provider, mode: 'supabase-adapter', bucket: DOCUMENTS_BUCKET };
  }

  // Production path — both Supabase env vars present.
  if (supabaseUrl && supabaseServiceRoleKey) {
    try {
      const supabase = createSupabaseAdminClient({
        url: supabaseUrl,
        serviceRoleKey: supabaseServiceRoleKey,
      });
      const adapter = createSupabaseStorageAdapter({
        supabase,
        environment,
      });
      const provider = createStorageAdapterProvider({
        adapter,
        bucket: DOCUMENTS_BUCKET,
      });
      deps.logger?.info?.(
        { wiring: 'document-storage', mode: 'supabase-adapter', bucket: DOCUMENTS_BUCKET, environment },
        'document-storage-wiring: bound Supabase storage-adapter bridge',
      );
      return { provider, mode: 'supabase-adapter', bucket: DOCUMENTS_BUCKET };
    } catch (err) {
      // The Supabase client throws on malformed URLs / missing keys.
      // Falling back to local storage keeps boot from crashing — the
      // operator sees a warning and can fix the env without losing the
      // gateway.
      deps.logger?.warn?.(
        {
          wiring: 'document-storage',
          error: err instanceof Error ? err.message : String(err),
        },
        'document-storage-wiring: Supabase client init failed — falling back to LocalStorageProvider',
      );
    }
  }

  // Legacy fallback — local-disk provider. Matches what the codebase
  // shipped before the bridge landed.
  const provider = new LocalStorageProvider({
    ...(env.localStorageBasePath !== undefined ? { basePath: env.localStorageBasePath } : {}),
  });
  deps.logger?.info?.(
    { wiring: 'document-storage', mode: 'legacy-local' },
    'document-storage-wiring: bound LocalStorageProvider (Supabase env unset)',
  );
  return { provider, mode: 'legacy-local', bucket: null };
}
