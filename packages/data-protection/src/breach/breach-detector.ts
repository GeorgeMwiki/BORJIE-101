/**
 * breach-detector — surface suspicious access patterns from `audit_events`.
 *
 * Detection signals (universal — see spec §6.1):
 *
 *   - actor burst:         single actor exceeding per-tenant rate-limit.
 *   - cross-tenant access: actor touching multiple tenants in < 60 s.
 *   - bulk PII/PHI export: row count over `bulkExportThreshold` per call.
 *   - geo anomaly:         access from a country never previously seen
 *                          for this actor.
 *   - direct-DB bypass:    query that hits PG without crossing the API.
 *
 * The detector is pure: it consumes a stream of normalised access events
 * and emits zero-or-more `BreachFinding` records. Persistence into
 * `breach_events` is the caller's responsibility.
 */

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

import type { BreachSeverity, Classification } from '../types.js';

export interface AccessEvent {
  readonly actorId: string;
  readonly tenantId: string;
  readonly resource: string;
  readonly classes: ReadonlyArray<Classification>;
  /** How many rows the access touched. */
  readonly rowCount: number;
  readonly geo: string;
  readonly at: Date;
  /** True if the access bypassed the API and hit PG directly. */
  readonly directDb: boolean;
}

export interface DetectorConfig {
  /** Max rows in any single call. Exceeding triggers a finding. */
  readonly bulkExportThreshold: number;
  /** Max events per actor per window (per `windowMs`). */
  readonly actorRatePerWindow: number;
  /** Window length for actor rate, in ms. */
  readonly windowMs: number;
  /** Number of distinct tenants an actor may touch in `crossTenantWindowMs` before flagging. */
  readonly crossTenantThreshold: number;
  readonly crossTenantWindowMs: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = Object.freeze({
  bulkExportThreshold: 500,
  actorRatePerWindow: 200,
  windowMs: 60_000,
  crossTenantThreshold: 2,
  crossTenantWindowMs: 60_000,
});

export interface BreachFinding {
  readonly tenantId: string;
  readonly detectedAt: Date;
  readonly severity: BreachSeverity;
  readonly signal:
    | 'actor_burst'
    | 'cross_tenant'
    | 'bulk_export'
    | 'geo_anomaly'
    | 'direct_db_bypass';
  readonly affectedClasses: ReadonlyArray<Classification>;
  readonly affectedCountEstimate: number;
  readonly evidenceHash: string;
}

function severityFor(classes: ReadonlyArray<Classification>): BreachSeverity {
  if (classes.includes('phi') || classes.includes('critical')) {
    return 'critical';
  }
  if (classes.includes('pii') || classes.includes('financial')) {
    return 'high';
  }
  if (classes.includes('restricted') || classes.includes('confidential')) {
    return 'medium';
  }
  return 'low';
}

function evidenceHashOf(input: {
  readonly signal: BreachFinding['signal'];
  readonly tenantId: string;
  readonly actorId: string;
  readonly at: Date;
}): string {
  return bytesToHex(
    sha256(
      utf8ToBytes(
        [input.signal, input.tenantId, input.actorId, input.at.toISOString()].join(
          '|',
        ),
      ),
    ),
  );
}

export function detectBreaches(input: {
  readonly events: ReadonlyArray<AccessEvent>;
  readonly knownGeosByActor: ReadonlyMap<string, ReadonlySet<string>>;
  readonly config?: DetectorConfig;
}): ReadonlyArray<BreachFinding> {
  const cfg = input.config ?? DEFAULT_DETECTOR_CONFIG;
  const findings: BreachFinding[] = [];

  // Pass 1: per-event signals (bulk_export, geo_anomaly, direct_db).
  for (const evt of input.events) {
    if (evt.directDb) {
      findings.push(
        Object.freeze({
          tenantId: evt.tenantId,
          detectedAt: evt.at,
          severity: severityFor(evt.classes),
          signal: 'direct_db_bypass',
          affectedClasses: Object.freeze([...evt.classes]),
          affectedCountEstimate: evt.rowCount,
          evidenceHash: evidenceHashOf({
            signal: 'direct_db_bypass',
            tenantId: evt.tenantId,
            actorId: evt.actorId,
            at: evt.at,
          }),
        }),
      );
    }
    if (evt.rowCount > cfg.bulkExportThreshold) {
      findings.push(
        Object.freeze({
          tenantId: evt.tenantId,
          detectedAt: evt.at,
          severity: severityFor(evt.classes),
          signal: 'bulk_export',
          affectedClasses: Object.freeze([...evt.classes]),
          affectedCountEstimate: evt.rowCount,
          evidenceHash: evidenceHashOf({
            signal: 'bulk_export',
            tenantId: evt.tenantId,
            actorId: evt.actorId,
            at: evt.at,
          }),
        }),
      );
    }
    const known = input.knownGeosByActor.get(evt.actorId);
    if (known && !known.has(evt.geo)) {
      findings.push(
        Object.freeze({
          tenantId: evt.tenantId,
          detectedAt: evt.at,
          severity: severityFor(evt.classes),
          signal: 'geo_anomaly',
          affectedClasses: Object.freeze([...evt.classes]),
          affectedCountEstimate: evt.rowCount,
          evidenceHash: evidenceHashOf({
            signal: 'geo_anomaly',
            tenantId: evt.tenantId,
            actorId: evt.actorId,
            at: evt.at,
          }),
        }),
      );
    }
  }

  // Pass 2: actor burst (sliding window per actor across all tenants).
  const byActor = new Map<string, AccessEvent[]>();
  for (const evt of input.events) {
    const list = byActor.get(evt.actorId) ?? [];
    list.push(evt);
    byActor.set(evt.actorId, list);
  }
  for (const [actorId, list] of byActor) {
    list.sort((a, b) => a.at.getTime() - b.at.getTime());
    for (let i = 0; i < list.length; i++) {
      const head = list[i];
      if (!head) {
        continue;
      }
      const windowEnd = head.at.getTime() + cfg.windowMs;
      let count = 0;
      const tenants = new Set<string>();
      const classesInBurst = new Set<Classification>();
      for (let j = i; j < list.length; j++) {
        const next = list[j];
        if (!next || next.at.getTime() > windowEnd) {
          break;
        }
        count += 1;
        tenants.add(next.tenantId);
        for (const c of next.classes) {
          classesInBurst.add(c);
        }
      }
      if (count > cfg.actorRatePerWindow) {
        findings.push(
          Object.freeze({
            tenantId: head.tenantId,
            detectedAt: head.at,
            severity: severityFor(Array.from(classesInBurst)),
            signal: 'actor_burst',
            affectedClasses: Object.freeze(Array.from(classesInBurst)),
            affectedCountEstimate: count,
            evidenceHash: evidenceHashOf({
              signal: 'actor_burst',
              tenantId: head.tenantId,
              actorId,
              at: head.at,
            }),
          }),
        );
        break; // one burst finding per actor
      }
      if (
        tenants.size >= cfg.crossTenantThreshold &&
        head.at.getTime() + cfg.crossTenantWindowMs >= (list[Math.min(list.length - 1, i + count - 1)]?.at.getTime() ?? 0)
      ) {
        findings.push(
          Object.freeze({
            tenantId: head.tenantId,
            detectedAt: head.at,
            severity: 'high',
            signal: 'cross_tenant',
            affectedClasses: Object.freeze(Array.from(classesInBurst)),
            affectedCountEstimate: count,
            evidenceHash: evidenceHashOf({
              signal: 'cross_tenant',
              tenantId: head.tenantId,
              actorId,
              at: head.at,
            }),
          }),
        );
        break;
      }
    }
  }

  return Object.freeze(findings);
}
