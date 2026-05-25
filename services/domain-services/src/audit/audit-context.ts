/**
 * Audit Context
 * Holds request context (IP, user agent) for audit logging.
 * Uses AsyncLocalStorage for request-scoped context.
 */

import type { AuditContext as IAuditContext } from './types.js';

const defaultContext: IAuditContext = {
  userId: null,
  userEmail: null,
  ipAddress: null,
  userAgent: null,
};

/** Thread-local storage for audit context (per-request) */
let currentContext: IAuditContext = defaultContext;

/** Get the current audit context */
export function getAuditContext(): IAuditContext {
  return { ...currentContext };
}

/** Set the audit context (e.g. from middleware) */
export function setAuditContext(ctx: Partial<IAuditContext>): void {
  currentContext = { ...currentContext, ...ctx };
}

/** Clear the audit context */
export function clearAuditContext(): void {
  currentContext = defaultContext;
}

/** Run a function with a specific audit context */
export function withAuditContext<T>(
  ctx: Partial<IAuditContext>,
  fn: () => Promise<T>
): Promise<T> {
  const prev = currentContext;
  currentContext = { ...currentContext, ...ctx };
  return fn().finally(() => {
    currentContext = prev;
  });
}
