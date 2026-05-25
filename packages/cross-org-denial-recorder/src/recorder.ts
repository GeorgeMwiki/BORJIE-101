/**
 * Cross-tenant denial recorder — fire-and-forget writer.
 *
 * Ported from LITFIN `core/security/cross-org-denials/denial-recorder.ts`
 * with the tenancy unit renamed and the Supabase coupling replaced by
 * a `DenialSink` port. Tests use the in-memory sink; production wires
 * Supabase.
 *
 * Design contract:
 *   1. NEVER throw — security plumbing must not break a response path.
 *   2. Per-actor rate-limit (1 write / 1s / actor+target). Subsequent
 *      denials in the window increment a drop counter flushed on the
 *      next admit.
 *   3. Required-field validation drops junk rows silently.
 *   4. Bounded actor map (LRU-trim at 5000 keys) so a million distinct
 *      actors cannot OOM the process.
 */

import type { DenialInput, DenialRow, DenialSink } from "./types.js";

const RATE_LIMIT_WINDOW_MS = 1_000;
const MAX_BUCKETS = 5_000;

export interface RecorderState {
  readonly lastAdmitAt: Map<string, number>;
  droppedSinceLastAdmit: number;
}

export function createRecorderState(): RecorderState {
  return {
    lastAdmitAt: new Map(),
    droppedSinceLastAdmit: 0,
  };
}

function bucketKey(input: DenialInput): string {
  // P84 audit BUG-ME-4: include actorTenantId so a user with the same
  // userId across multiple source tenants (rare on BORJIE but
  // possible with platform-admin or shared-SSO scenarios) does NOT
  // share a rate-limit slot. Full isolation key:
  // actorTenantId :: actorUserId :: targetTenantId
  return `${input.actorTenantId ?? "_"}::${input.actorUserId ?? "anon"}::${input.targetTenantId}`;
}

function trimBuckets(state: RecorderState): void {
  if (state.lastAdmitAt.size <= MAX_BUCKETS) return;
  const toEvict = state.lastAdmitAt.size - Math.floor(MAX_BUCKETS * 0.9);
  let evicted = 0;
  for (const key of state.lastAdmitAt.keys()) {
    if (evicted >= toEvict) break;
    state.lastAdmitAt.delete(key);
    evicted += 1;
  }
}

function admit(
  state: RecorderState,
  input: DenialInput,
  now: number,
): boolean {
  const key = bucketKey(input);
  const existing = state.lastAdmitAt.get(key);
  // If the bucket has never seen a write, admit unconditionally. Using
  // 0 as the sentinel would drop the very first call at now=0 (test
  // harness uses synthetic clocks starting at 0).
  if (existing !== undefined && now - existing < RATE_LIMIT_WINDOW_MS) {
    state.droppedSinceLastAdmit += 1;
    return false;
  }
  state.lastAdmitAt.set(key, now);
  trimBuckets(state);
  return true;
}

function isValid(input: DenialInput): boolean {
  const reasonStr = typeof input.reason === "string" ? input.reason : "";
  return Boolean(
    input.targetTenantId && input.route && input.httpMethod && reasonStr,
  );
}

export interface RecorderOptions {
  readonly state?: RecorderState;
  readonly nowMs?: () => number;
}

/**
 * Record a denial via the supplied sink. Returns the promise so tests
 * can await it; production callsites should not await — fire and
 * forget is the point.
 */
export async function recordDenial(
  sink: DenialSink,
  input: DenialInput,
  options: RecorderOptions = {},
): Promise<{ readonly admitted: boolean; readonly droppedRollup: number }> {
  const state = options.state ?? createRecorderState();
  const now = options.nowMs ? options.nowMs() : Date.now();

  if (!isValid(input)) {
    state.droppedSinceLastAdmit += 1;
    return { admitted: false, droppedRollup: 0 };
  }

  if (!admit(state, input, now)) {
    return { admitted: false, droppedRollup: 0 };
  }

  const droppedRollup = state.droppedSinceLastAdmit;
  state.droppedSinceLastAdmit = 0;
  const metadata = {
    ...(input.metadata ?? {}),
    ...(droppedRollup > 0 ? { droppedSincePreviousAdmit: droppedRollup } : {}),
  };
  const row: DenialRow = {
    ...input,
    metadata,
    deniedAtIso: new Date(now).toISOString(),
  };
  try {
    await sink.write(row);
    return { admitted: true, droppedRollup };
  } catch {
    // Swallow — the contract is fire-and-forget.
    return { admitted: false, droppedRollup };
  }
}
