/**
 * Async-local tenant context.
 *
 * Every server-entry path (Next.js middleware, route handler, queue
 * worker, cron) wraps the request body in `runInTenantContext(ctx,
 * fn)`. Downstream code calls `getTenantContext()` to read the
 * current tenant — no parameter threading, no globals, just an
 * AsyncLocalStorage scope.
 *
 * `tryGetTenantContext()` is the nullable variant used by background
 * jobs and logging hooks that may run without a request scope. Most
 * application code should call `getTenantContext()` directly so a
 * missing context fails loudly.
 *
 * Ported verbatim from @litfin/tenant-guard.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { IsolationViolation, type TenantContext } from "./types";

const storage = new AsyncLocalStorage<TenantContext>();

export function runInTenantContext<T>(
  ctx: TenantContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  return Promise.resolve(storage.run(ctx, fn));
}

export function runInTenantContextSync<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getTenantContext(): TenantContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new IsolationViolation({
      layer: "context",
      kind: "missing-context",
      hint: "getTenantContext called outside a runInTenantContext scope",
    });
  }
  return ctx;
}

export function tryGetTenantContext(): TenantContext | null {
  return storage.getStore() ?? null;
}

/**
 * Test-only helper to swap the underlying AsyncLocalStorage so unit
 * tests can isolate state across imports. Production code MUST NOT
 * call this. Marked with a deliberately long, ugly name to keep
 * accidental usage out of the autocomplete cone of attention.
 */
export function __unstable__resetTenantStorageForTestsOnly(): void {
  (storage as unknown as { disable(): void }).disable?.();
}
