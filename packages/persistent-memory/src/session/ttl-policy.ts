/**
 * Sliding-TTL policy for `session_memory` (Wave 18GG).
 *
 * Each turn refreshes the expiry. Once `expires_at` passes, the row
 * is treated as a *cached* short-term snapshot only — the cognitive
 * engine must re-derive from `thread_summaries` + `cognitive_turns`.
 *
 * Pure function — no I/O, deterministic, immutable.
 */

import { SESSION_MEMORY_TTL_DAYS } from '../types.js';

export interface TtlPolicyInput {
  readonly now: Date;
  readonly ttl_days?: number;
}

export function computeSessionExpiry(input: TtlPolicyInput): Date {
  const ttlDays = input.ttl_days ?? SESSION_MEMORY_TTL_DAYS;
  if (ttlDays <= 0) {
    throw new Error('ttl_days must be positive');
  }
  return new Date(input.now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
}

export function isSessionMemoryFresh(
  expires_at: string,
  now: Date,
): boolean {
  return new Date(expires_at).getTime() > now.getTime();
}
