/**
 * OwnerOS Tab Registry — singleton storage for tab descriptors.
 *
 * A new panel module imports `registerTab(descriptor)` at the top of
 * its file. The first time the module is evaluated, the descriptor is
 * stored. Subsequent re-registrations of the same `type` overwrite the
 * previous descriptor (useful for hot-reload).
 *
 * Lookups are O(1) by tab type. `listTabs()` returns the descriptors
 * in stable union-order (so the "+" menu is deterministic).
 *
 * The registry holds DESCRIPTORS only — never React components. The
 * consuming app (apps/owner-web) maps `rendererId` to a component via
 * its own table. This keeps the package zero-React.
 */

import {
  OWNER_OS_TAB_TYPES,
  ownerOsTabContextSchema,
  type OwnerOSTabContext,
  type OwnerOSTabDescriptor,
  type OwnerOSTabType,
} from './types.js';

const registry = new Map<OwnerOSTabType, OwnerOSTabDescriptor>();

/**
 * Register a descriptor for a tab type. Idempotent — re-registering the
 * same type overwrites the previous descriptor (last-write wins).
 *
 * Throws if the descriptor's `type` is not part of the union — this
 * surfaces typos at module-load instead of mid-render.
 */
export function registerTab(descriptor: OwnerOSTabDescriptor): void {
  if (!OWNER_OS_TAB_TYPES.includes(descriptor.type)) {
    throw new Error(
      `[owner-os-tabs] Unknown tab type "${descriptor.type}". Add it to OWNER_OS_TAB_TYPES first.`,
    );
  }
  registry.set(descriptor.type, descriptor);
}

/**
 * Look up a descriptor by type. Returns `null` when not yet registered
 * (e.g. the panel module has not been imported in this bundle).
 */
export function getTab(type: OwnerOSTabType): OwnerOSTabDescriptor | null {
  return registry.get(type) ?? null;
}

/**
 * Return every registered descriptor in union-order. Useful for the
 * "+" menu and for building the default tab strip on first load.
 */
export function listTabs(): ReadonlyArray<OwnerOSTabDescriptor> {
  const out: OwnerOSTabDescriptor[] = [];
  for (const t of OWNER_OS_TAB_TYPES) {
    const d = registry.get(t);
    if (d) out.push(d);
  }
  return out;
}

/**
 * Return descriptors the "+" menu should show. Filters out hidden
 * descriptors (`hiddenFromSpawnMenu`) and any not yet registered.
 */
export function listSpawnableTabs(): ReadonlyArray<OwnerOSTabDescriptor> {
  return listTabs().filter((d) => !d.hiddenFromSpawnMenu);
}

/**
 * Default deterministic tab id. Used when a descriptor does not provide
 * its own `buildTabId`. Concatenates the scoped fields so re-spawning
 * with the same context resolves to the same tab id (idempotency).
 */
export function defaultTabId(
  type: OwnerOSTabType,
  context: OwnerOSTabContext,
): string {
  const parts: string[] = [type];
  if (context.siteId) parts.push(`site:${context.siteId}`);
  if (context.licenceId) parts.push(`licence:${context.licenceId}`);
  if (context.employeeId) parts.push(`employee:${context.employeeId}`);
  if (context.counterpartyId) parts.push(`cp:${context.counterpartyId}`);
  if (context.documentId) parts.push(`doc:${context.documentId}`);
  if (context.focus) {
    const slug = context.focus
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    if (slug) parts.push(`focus:${slug}`);
  }
  return parts.join('|');
}

/**
 * Build a tab id using the descriptor's custom builder (if any) or the
 * default. Always returns a deterministic id for the same context.
 */
export function buildTabId(
  descriptor: OwnerOSTabDescriptor,
  context: OwnerOSTabContext,
): string {
  if (typeof descriptor.buildTabId === 'function') {
    return descriptor.buildTabId(context);
  }
  return defaultTabId(descriptor.type, context);
}

/**
 * Validate a context object against the descriptor's contextSchema.
 * Returns `{ ok: true, data }` on success or `{ ok: false, error }`.
 */
export function validateContext(
  descriptor: OwnerOSTabDescriptor,
  raw: unknown,
):
  | { readonly ok: true; readonly data: OwnerOSTabContext }
  | { readonly ok: false; readonly error: string } {
  const parsed = descriptor.contextSchema.safeParse(raw);
  if (parsed.success) {
    // Re-parse through the shared schema so consumers always get the
    // canonical shape (descriptor-specific extensions are dropped at this
    // boundary; panels read raw via descriptor.contextSchema themselves
    // if they need the extension fields).
    const shared = ownerOsTabContextSchema.safeParse(parsed.data);
    if (shared.success) {
      return { ok: true, data: shared.data };
    }
  }
  return {
    ok: false,
    error: !parsed.success
      ? parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      : 'context validation failed',
  };
}

/**
 * Test-only — clear every descriptor. Never call from production code.
 */
export function __resetRegistryForTests(): void {
  registry.clear();
}
