/**
 * AsyncLocalStorage-based per-request tenant context.
 *
 * Bound by `honoTenantMiddleware` (or any equivalent per-request
 * entry point) and read by every downstream layer. The store is
 * `undefined` at process start; any layer that tries to read it
 * without it being bound throws an `IsolationViolation`.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  IsolationViolation,
  type TenantContext,
} from '../types.js';

const storage = new AsyncLocalStorage<TenantContext>();

/**
 * Run `fn` inside a freshly-bound tenant context. Always prefer
 * this over `enterTenantContext()` — it cleans up automatically
 * when the callback returns / throws.
 */
export function runInTenantContext<T>(
  ctx: TenantContext,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return storage.run(ctx, fn);
}

/**
 * Read the current tenant context. Throws if none is bound — the
 * absence of a context is itself a leak signal.
 */
export function getTenantContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new IsolationViolation({
      layer: 'app-middleware',
      kind: 'missing-tenant-context',
      message:
        'no tenant context bound — every tenant-scoped code path must run inside runInTenantContext()',
    });
  }
  return ctx;
}

/**
 * Read the current tenant context if bound, else return `null`.
 * Used by the log scrubber, which must operate even outside a
 * request (e.g. background jobs).
 */
export function tryGetTenantContext(): TenantContext | null {
  return storage.getStore() ?? null;
}

/**
 * Assert that a value matches the bound tenant. Used by every
 * layer's runtime check.
 */
export function assertSameTenant(
  observed: string | undefined,
  meta: Record<string, unknown> = {},
): void {
  const ctx = getTenantContext();
  if (observed === undefined || observed === null) {
    throw new IsolationViolation({
      layer: 'app-middleware',
      kind: 'missing-tenant-context',
      tenantId: ctx.tenantId,
      message: 'observed value carries no tenant id',
      meta,
    });
  }
  if (observed !== ctx.tenantId) {
    throw new IsolationViolation({
      layer: 'app-middleware',
      kind: 'cross-tenant-access',
      tenantId: ctx.tenantId,
      observedTenantId: observed as TenantContext['tenantId'],
      message: `cross-tenant access blocked: context tenant ${ctx.tenantId} ≠ observed ${observed}`,
      meta,
    });
  }
}

/**
 * Test-only escape hatch — clear the AsyncLocalStorage store.
 * Used by Vitest to prevent leakage between tests.
 */
export function __resetTenantContextForTests(): void {
  storage.disable();
  storage.enterWith(undefined as unknown as TenantContext);
  storage.disable();
}
