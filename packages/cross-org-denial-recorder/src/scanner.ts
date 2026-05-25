/**
 * Cross-tenant denial scanner.
 *
 * Pure aggregation + pattern detection over a set of recorded
 * DenialRow entries. Caller supplies the row stream (typically from
 * a sink query); these functions never touch a DB.
 */

import type {
  AggregateStats,
  BruteForceFinding,
  DenialRow,
} from "./types.js";

const ANONYMOUS_BUCKET = "__anonymous__";

/**
 * Aggregate denial rows into per-reason + per-actor counts plus a
 * total. Pure function — caller supplies the window.
 */
export function aggregate(
  rows: ReadonlyArray<DenialRow>,
  windowMs: number,
): AggregateStats {
  const byReason: Record<string, number> = {};
  const byActor: Record<string, number> = {};
  let total = 0;
  for (const row of rows) {
    total += 1;
    const reasonKey = String(row.reason || "UNKNOWN");
    byReason[reasonKey] = (byReason[reasonKey] ?? 0) + 1;
    const actorKey = row.actorUserId || ANONYMOUS_BUCKET;
    byActor[actorKey] = (byActor[actorKey] ?? 0) + 1;
  }
  return { total, byReason, byActor, windowMs };
}

export interface ScanThresholds {
  /** Minimum attempts before flagging as brute-force. Default 20. */
  readonly minAttempts?: number;
  /** Minimum distinct routes before flagging. Default 3. */
  readonly minDistinctRoutes?: number;
}

/**
 * Find brute-force patterns: same actor hitting the same target
 * tenant N times across M distinct routes. Defaults follow the OWASP
 * "anomalous access" rubric: 20 attempts, 3 routes.
 */
export function findBruteForcePatterns(
  rows: ReadonlyArray<DenialRow>,
  thresholds: ScanThresholds = {},
): ReadonlyArray<BruteForceFinding> {
  const minAttempts = thresholds.minAttempts ?? 20;
  const minDistinctRoutes = thresholds.minDistinctRoutes ?? 3;

  const groups = new Map<
    string,
    {
      actorUserId: string;
      targetTenantId: string;
      attempts: number;
      routes: Set<string>;
      firstSeenIso: string;
      lastSeenIso: string;
    }
  >();

  for (const r of rows) {
    if (!r.actorUserId) continue;
    const key = `${r.actorUserId}::${r.targetTenantId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.attempts += 1;
      existing.routes.add(r.route);
      if (r.deniedAtIso < existing.firstSeenIso) {
        existing.firstSeenIso = r.deniedAtIso;
      }
      if (r.deniedAtIso > existing.lastSeenIso) {
        existing.lastSeenIso = r.deniedAtIso;
      }
    } else {
      groups.set(key, {
        actorUserId: r.actorUserId,
        targetTenantId: r.targetTenantId,
        attempts: 1,
        routes: new Set([r.route]),
        firstSeenIso: r.deniedAtIso,
        lastSeenIso: r.deniedAtIso,
      });
    }
  }

  const findings: BruteForceFinding[] = [];
  for (const g of groups.values()) {
    if (g.attempts >= minAttempts && g.routes.size >= minDistinctRoutes) {
      findings.push({
        actorUserId: g.actorUserId,
        targetTenantId: g.targetTenantId,
        attempts: g.attempts,
        distinctRoutes: g.routes.size,
        firstSeenIso: g.firstSeenIso,
        lastSeenIso: g.lastSeenIso,
      });
    }
  }
  return findings;
}
