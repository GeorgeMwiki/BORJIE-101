/**
 * Royalty-roll + outstanding-royalties ledger gatherer.
 *
 * Section 6 of the questionnaire memo ("areas calculation pain point")
 * makes this a high-leverage deliverable. We pull the entire royalty-roll
 * as-of a date, apply the ageing-bucket waterfall, and surface the
 * top outstanding-royalty drivers.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, RoyaltyRollEntry } from './ports.js';
import { buildEvidenceFragment, formatMoney, sourceHealth } from './ports.js';

const AGEING_BUCKETS = ['0-30 days', '31-60 days', '61-90 days', '91+ days'] as const;

function bucketFor(days: number): (typeof AGEING_BUCKETS)[number] {
  if (days <= 30) return '0-30 days';
  if (days <= 60) return '31-60 days';
  if (days <= 90) return '61-90 days';
  return '91+ days';
}

export interface RoyaltyRollGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createRoyaltyRollGatherer(deps: RoyaltyRollGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const fragments: EvidencePack['fragments'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const charts: EvidencePack['charts'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];
    const port = deps.ports.royaltyRoll;

    if (!port) {
      health.push(sourceHealth('royalty-roll', 'unavailable', 'royaltyRoll port not wired'));
      return packed(spec, fragments, charts, tables, health);
    }

    const orgId =
      spec.scope.kind === 'portfolio' || spec.scope.kind === 'buyer' ||
      spec.scope.kind === 'site' || spec.scope.kind === 'deal'
        ? spec.scope.orgId
        : null;
    if (!orgId) {
      health.push(sourceHealth('royalty-roll', 'unavailable', 'royalty-roll requires an orgId'));
      return packed(spec, fragments, charts, tables, health);
    }
    const siteId =
      spec.scope.kind === 'site'
        ? spec.scope.siteId
        : spec.scope.kind === 'deal'
          ? (spec.scope.siteId ?? undefined)
          : undefined;

    let entries: ReadonlyArray<RoyaltyRollEntry> = [];
    try {
      entries = await port.fetchRoyaltyRoll({
        orgId,
        ...(siteId !== undefined ? { siteId } : {}),
        asOfIso: spec.period.periodEnd,
      });
      health.push(sourceHealth('royalty-roll', entries.length > 0 ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('royalty-roll', 'unavailable', e instanceof Error ? e.message : String(e)));
      return packed(spec, fragments, charts, tables, health);
    }

    if (entries.length === 0) return packed(spec, fragments, charts, tables, health);

    entries.forEach((entry, i) => {
      fragments.push(
        buildEvidenceFragment({
          id: `rr-${i + 1}`,
          summary: `Site ${entry.siteId} (${entry.buyerName}): royalty ${formatMoney(entry.monthlyRoyalty)}, outstanding ${formatMoney(entry.outstanding)} (${entry.outstandingAgeingDays} days).`,
          source: { kind: 'supply_agreement', ref: `supply:${entry.siteId}` },
        }),
      );
    });

    tables.push({
      id: 'rr-table',
      title: 'Royalty-roll as of period-end',
      headers: ['Site', 'Buyer', 'Monthly royalty', 'Supply end', 'Outstanding', 'Ageing'],
      rows: entries.map((e) => [
        e.siteId,
        e.buyerName,
        formatMoney(e.monthlyRoyalty),
        e.supplyEndIso.slice(0, 10),
        formatMoney(e.outstanding),
        bucketFor(e.outstandingAgeingDays),
      ]),
      citationIds: entries.map((_, i) => `rr-${i + 1}`),
    });

    const bucketTotals = new Map<(typeof AGEING_BUCKETS)[number], number>();
    for (const b of AGEING_BUCKETS) bucketTotals.set(b, 0);
    for (const e of entries) {
      const b = bucketFor(e.outstandingAgeingDays);
      bucketTotals.set(b, (bucketTotals.get(b) ?? 0) + e.outstanding.value);
    }

    tables.push({
      id: 'rr-ageing-table',
      title: 'Outstanding-royalties ageing-bucket waterfall',
      headers: ['Bucket', 'Total outstanding'],
      rows: AGEING_BUCKETS.map((b) => [b, (bucketTotals.get(b) ?? 0).toFixed(2)]),
      citationIds: entries.map((_, i) => `rr-${i + 1}`),
      totalRow: ['Total', entries.reduce((sum, e) => sum + e.outstanding.value, 0).toFixed(2)],
    });

    charts.push({
      id: 'rr-ageing-chart',
      title: 'Outstanding royalties by ageing bucket',
      kind: 'bar',
      xLabels: AGEING_BUCKETS as unknown as string[],
      series: [
        {
          name: 'Total outstanding',
          values: AGEING_BUCKETS.map((b) => bucketTotals.get(b) ?? 0),
        },
      ],
      yUnit: entries[0]!.outstanding.currency,
      citationIds: entries.map((_, i) => `rr-${i + 1}`),
    });

    // Top outstanding-royalty drivers
    const topOutstanding = [...entries].sort((a, b) => b.outstanding.value - a.outstanding.value).slice(0, 10);
    tables.push({
      id: 'rr-top-drivers',
      title: 'Top outstanding-royalty drivers',
      headers: ['Site', 'Buyer', 'Outstanding', 'Ageing'],
      rows: topOutstanding.map((e) => [
        e.siteId,
        e.buyerName,
        formatMoney(e.outstanding),
        bucketFor(e.outstandingAgeingDays),
      ]),
      citationIds: topOutstanding.map((e) => `rr-${entries.indexOf(e) + 1}`),
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
