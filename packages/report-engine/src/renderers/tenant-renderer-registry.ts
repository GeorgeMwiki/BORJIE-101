/**
 * R22 — per-tenant renderer registry.
 *
 * The orchestrator already accepts a `renderers` override slot for
 * each format (pdf / docx / pptx). The hand-rolled default renderers
 * are valid for 100 % of tenants; high-tier tenants who require
 * pixel-perfect Word output (e.g. signed letterhead for regulator
 * filings) inject `docxtemplater` (or any other renderer) into this
 * registry, and the orchestrator picks it up per tenant at render time.
 *
 * The registry is intentionally simple: a map of `tenantId → Partial<RendererOverrides>`,
 * with a sane "platform default" that falls through to the hand-rolled
 * renderers. No new runtime dep — tenants who want docxtemplater install
 * it in their composition root and register their adapter here.
 *
 * Usage from a composition root:
 *
 *   registerTenantRenderer('tenant-mwikila-llc', {
 *     docx: async (input) => {
 *       // tenant ships its docxtemplater adapter; we type-check the
 *       // returned object satisfies RenderedReportFile and we're done.
 *       return runDocxtemplater(input);
 *     },
 *   });
 *
 * The orchestrator then asks `getTenantRenderer(tenantId)` and merges
 * the per-tenant slot over the platform default. Tenants that don't
 * register anything get the platform default unchanged.
 */

import type { RendererOverrides } from '../orchestrator.js';

const registry = new Map<string, RendererOverrides>();

/**
 * Replace the renderer overrides for a tenant. Setting `null` clears
 * the entry; the orchestrator falls back to platform defaults.
 */
export function registerTenantRenderer(
  tenantId: string,
  overrides: RendererOverrides | null,
): void {
  if (overrides === null) {
    registry.delete(tenantId);
    return;
  }
  registry.set(tenantId, overrides);
}

/**
 * Read the per-tenant renderer overrides. Returns `undefined` when no
 * overrides are registered (caller falls through to the platform default).
 */
export function getTenantRenderer(
  tenantId: string,
): RendererOverrides | undefined {
  return registry.get(tenantId);
}

/**
 * Resolve the effective renderer override stack — caller's explicit
 * `renderers` arg WINS over the per-tenant registry which WINS over
 * the platform default.
 *
 * Pure function, no side effects.
 */
export function resolveRendererStack(
  tenantId: string,
  explicit: RendererOverrides | undefined,
): RendererOverrides | undefined {
  const tenant = registry.get(tenantId);
  if (!tenant && !explicit) return undefined;
  return {
    ...(tenant ?? {}),
    ...(explicit ?? {}),
  };
}

/**
 * Clear the entire registry — provided for test isolation. Production
 * callers should not need this.
 */
export function clearTenantRendererRegistry(): void {
  registry.clear();
}

/**
 * Snapshot of the registry contents — read-only view useful for ops
 * dashboards / audit. Returns an array of `tenantId`s currently using
 * custom renderers.
 */
export function listTenantsWithCustomRenderers(): readonly string[] {
  return Object.freeze([...registry.keys()].sort());
}
