/**
 * No-op audit sink — for tests that don't care about audit rows.
 *
 * Returns synchronously to avoid pinning tests to microtask ordering.
 */
import type { ContextAuditPort } from '../types.js';

/**
 * Always-OK audit sink. Drops every record on the floor. Test code that
 * needs to assert audit behaviour should construct its own spy port.
 */
export const nullAuditSink: ContextAuditPort = {
  recordFetch(): void {
    // intentional no-op
  },
};
