/**
 * Rent-roll + arrears ledger gatherer.
 *
 * Section 6 of the questionnaire memo ("areas calculation pain point")
 * makes this a high-leverage deliverable. We pull the entire rent-roll
 * as-of a date, apply the ageing-bucket waterfall, and surface the
 * top arrears drivers.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, RentRollEntry } from './ports.js';
import { buildEvidenceFragment, formatMoney, sourceHealth } from './ports.js';

const AGEING_BUCKETS = ['0-30 days', '31-60 days', '61-90 days', '91+ days'] as const;

function bucketFor(days: number): (typeof AGEING_BUCKETS)[number] {
  if (days <= 30) return '0-30 days';
  if (days <= 60) return '31-60 days';
  if (days <= 90) return '61-90 days';
  return '91+ days';
}

export interface RentRollGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createRentRollGatherer(deps: RentRollGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const fragments: EvidencePack['fragments'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const charts: EvidencePack['charts'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];
    const port = deps.ports.rentRoll;

    if (!port) {
      health.push(sourceHealth('rent-roll', 'unavailable', 'rentRoll port not wired'));
      return packed(spec, fragments, charts, tables, health);
    }

    const orgId =
      spec.scope.kind === 'portfolio' || spec.scope.kind === 'tenant' ||
      spec.scope.kind === 'property' || spec.scope.kind === 'deal'
        ? spec.scope.orgId
        : null;
    if (!orgId) {
      health.push(sourceHealth('rent-roll', 'unavailable', 'rent-roll requires an orgId'));
      return packed(spec, fragments, charts, tables, health);
    }
    const propertyId =
      spec.scope.kind === 'property'
        ? spec.scope.propertyId
        : spec.scope.kind === 'deal'
          ? (spec.scope.propertyId ?? undefined)
          : undefined;

    let entries: ReadonlyArray<RentRollEntry> = [];
    try {
      entries = await port.fetchRentRoll({
        orgId,
        ...(propertyId !== undefined ? { propertyId } : {}),
        asOfIso: spec.period.periodEnd,
      });
      health.push(sourceHealth('rent-roll', entries.length > 0 ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('rent-roll', 'unavailable', e instanceof Error ? e.message : String(e)));
      return packed(spec, fragments, charts, tables, health);
    }

    if (entries.length === 0) return packed(spec, fragments, charts, tables, health);

    entries.forEach((entry, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `rr-${i + 1}`,
          summary: `Unit ${entry.unitId} (${entry.tenantName}): rent ${formatMoney(entry.monthlyRent)}, arrears ${formatMoney(entry.arrears)} (${entry.arrearsAgeingDays} days).`,
          source: { kind: 'lease', ref: `lease:${entry.unitId}` },
        }),
      );
    });

    tables.push({
      id: 'rr-table',
      title: 'Rent-roll as of period-end',
      headers: ['Unit', 'Tenant', 'Monthly rent', 'Lease end', 'Arrears', 'Ageing'],
      rows: entries.map((e) => [
        e.unitId,
        e.tenantName,
        formatMoney(e.monthlyRent),
        e.leaseEndIso.slice(0, 10),
        formatMoney(e.arrears),
        bucketFor(e.arrearsAgeingDays),
      ]),
      citationIds: entries.map((_, i) => `rr-${i + 1}`),
    });

    const bucketTotals = new Map<(typeof AGEING_BUCKETS)[number], number>();
    for (const b of AGEING_BUCKETS) bucketTotals.set(b, 0);
    for (const e of entries) {
      const b = bucketFor(e.arrearsAgeingDays);
      bucketTotals.set(b, (bucketTotals.get(b) ?? 0) + e.arrears.value);
    }

    tables.push({
      id: 'rr-ageing-table',
      title: 'Arrears ageing-bucket waterfall',
      headers: ['Bucket', 'Total arrears'],
      rows: AGEING_BUCKETS.map((b) => [b, (bucketTotals.get(b) ?? 0).toFixed(2)]),
      citationIds: entries.map((_, i) => `rr-${i + 1}`),
      totalRow: ['Total', entries.reduce((sum, e) => sum + e.arrears.value, 0).toFixed(2)],
    });

    charts.push({
      id: 'rr-ageing-chart',
      title: 'Arrears by ageing bucket',
      kind: 'bar',
      xLabels: AGEING_BUCKETS as unknown as string[],
      series: [
        {
          name: 'Total arrears',
          values: AGEING_BUCKETS.map((b) => bucketTotals.get(b) ?? 0),
        },
      ],
      yUnit: entries[0]!.arrears.currency,
      citationIds: entries.map((_, i) => `rr-${i + 1}`),
    });

    // Top arrears drivers
    const topArrears = [...entries].sort((a, b) => b.arrears.value - a.arrears.value).slice(0, 10);
    tables.push({
      id: 'rr-top-drivers',
      title: 'Top arrears drivers',
      headers: ['Unit', 'Tenant', 'Arrears', 'Ageing'],
      rows: topArrears.map((e) => [
        e.unitId,
        e.tenantName,
        formatMoney(e.arrears),
        bucketFor(e.arrearsAgeingDays),
      ]),
      citationIds: topArrears.map((e) => `rr-${entries.indexOf(e) + 1}`),
    });

    return packed(spec, fragments, charts, tables, health);
  };
}

function packed(
  spec: GathererContext['spec'],
  fragments: EvidencePack['fragments'][number][],
  charts: EvidencePack['charts'][number][],
  tables: EvidencePack['tables'][number][],
  health: EvidencePack['sourceHealth'][number][],
): EvidencePack {
  return Object.freeze({
    type: spec.type,
    spec,
    fragments: Object.freeze(fragments),
    charts: Object.freeze(charts),
    tables: Object.freeze(tables),
    sourceHealth: Object.freeze(health),
  });
}
