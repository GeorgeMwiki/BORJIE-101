/**
 * Hash-chain audit log for conversation-feel interventions.
 *
 * Every guard intervention writes one record. Each record's hash_self =
 * sha256(hash_prev || record_body). The chain is regulator-readable and
 * tamper-evident.
 *
 * References:
 *  - Haber + Stornetta, "How to time-stamp a digital document" (1991).
 *  - Bitcoin whitepaper (2008) — hash chain pattern.
 *
 * Ported verbatim from sibling-port src/core/conversation-feel/audit-log.ts.
 */

import { createHash } from "node:crypto";
import type { GuardIntervention, SessionStats } from "./types";

const GENESIS_HASH = "0".repeat(64);

interface InMemoryStore {
  readonly records: GuardIntervention[];
  readonly head_by_session: Record<string, string>;
  readonly stats_by_session: Record<string, SessionStats>;
}

let store: InMemoryStore = {
  records: [],
  head_by_session: {},
  stats_by_session: {},
};

export function _resetAuditLog(): void {
  store = { records: [], head_by_session: {}, stats_by_session: {} };
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function bodyOf(
  rec: Omit<GuardIntervention, "hash_self" | "hash_prev">,
): string {
  return JSON.stringify({
    id: rec.id,
    guard: rec.guard,
    outcome: rec.outcome,
    reason: rec.reason,
    before: rec.before,
    after: rec.after,
    removed: rec.removed ?? [],
    metadata: rec.metadata ?? {},
    created_at: rec.created_at,
    session_id: rec.session_id,
  });
}

export function appendIntervention(
  rec: Omit<GuardIntervention, "hash_self" | "hash_prev">,
): GuardIntervention {
  const hashPrev = store.head_by_session[rec.session_id] ?? GENESIS_HASH;
  const body = bodyOf(rec);
  const hashSelf = sha256(hashPrev + "|" + body);
  const full: GuardIntervention = {
    ...rec,
    hash_prev: hashPrev,
    hash_self: hashSelf,
  };
  store = {
    records: [...store.records, full],
    head_by_session: { ...store.head_by_session, [rec.session_id]: hashSelf },
    stats_by_session: store.stats_by_session,
  };
  return full;
}

export function listInterventions(
  sessionId?: string,
  limit: number = 100,
): ReadonlyArray<GuardIntervention> {
  const filtered = sessionId
    ? store.records.filter((r) => r.session_id === sessionId)
    : store.records;
  return filtered.slice(-limit);
}

export function verifyChain(sessionId: string): {
  ok: boolean;
  broken_at?: string;
} {
  const records = store.records.filter((r) => r.session_id === sessionId);
  let prev = GENESIS_HASH;
  for (const r of records) {
    if (r.hash_prev !== prev) return { ok: false, broken_at: r.id };
    const expected = sha256(prev + "|" + bodyOf(r));
    if (expected !== r.hash_self) return { ok: false, broken_at: r.id };
    prev = r.hash_self;
  }
  return { ok: true };
}

export function setSessionStats(stats: SessionStats): void {
  store = {
    ...store,
    stats_by_session: { ...store.stats_by_session, [stats.session_id]: stats },
  };
}

export function getSessionStats(sessionId: string): SessionStats | null {
  return store.stats_by_session[sessionId] ?? null;
}

export function getAllSessionStats(): ReadonlyArray<SessionStats> {
  return Object.values(store.stats_by_session);
}

export function aggregateChatbotFeelScore(): number {
  const all = Object.values(store.stats_by_session);
  if (all.length === 0) return 0;
  const sum = all.reduce((n, s) => n + s.chatbot_feel_score, 0);
  return Math.round((sum / all.length) * 100) / 100;
}
