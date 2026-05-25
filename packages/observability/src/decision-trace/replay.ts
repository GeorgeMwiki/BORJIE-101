/**
 * DecisionTrace replay — read a finalised trace back from the
 * configured store so a human auditor UI can render its branches,
 * chosen path, and output side-by-side.
 *
 * Returns `null` for unknown ids — the auditor UI treats that as a
 * 404; replay MUST NOT throw on missing traces.
 *
 * @module packages/observability/src/decision-trace/replay
 */

import {
  getDefaultDecisionTraceStore,
  type DecisionTraceStore,
} from './persistence-port.js';
import type { DecisionTraceFinalised } from './types.js';

/**
 * Look up a finalised trace by id.
 *
 * @param traceId - The UUID returned from `finalize()`.
 * @param store - Optional store override; defaults to the configured
 *   global store (typically Postgres in prod, in-memory in dev).
 */
export async function replayDecisionTrace(
  traceId: string,
  store: DecisionTraceStore = getDefaultDecisionTraceStore(),
): Promise<DecisionTraceFinalised | null> {
  if (typeof traceId !== 'string' || traceId.length === 0) return null;
  try {
    return await store.load(traceId);
  } catch {
    // Replay is a read-only operation invoked from auditor UIs — never
    // surface a storage failure to the caller; treat it as "not found"
    // and let the operator investigate via logs.
    return null;
  }
}
