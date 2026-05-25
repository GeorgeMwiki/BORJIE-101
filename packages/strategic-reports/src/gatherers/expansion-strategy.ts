/**
 * Expansion strategy memo gatherer.
 *
 * Composes the expansion-advisor (HBU, absorption, capital stack) +
 * the green-angle advisor (sustainability angles + green financing)
 * into a single EvidencePack.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, ExpansionRecommendation, GreenAngleSummary } from './ports.js';
import { buildEvidenceFragment, formatMoney, sourceHealth } from './ports.js';

export interface ExpansionStrategyGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createExpansionStrategyGatherer(deps: ExpansionStrategyGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const fragments: EvidencePack['fragments'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const charts: EvidencePack['charts'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];
    const orgId =
      spec.scope.kind === 'portfolio' || spec.scope.kind === 'tenant' ||
      spec.scope.kind === 'property' || spec.scope.kind === 'deal'
        ? spec.scope.orgId
        : null;

    if (!orgId) {
      health.push(sourceHealth('expansion-advisor', 'unavailable', 'expansion memo requires an orgId'));
      return packed(spec, fragments, charts, tables, health);
    }

    const ePort = deps.ports.expansion;
    const gPort = deps.ports.greenAngle;

    if (!ePort) {
      health.push(sourceHealth('expansion-advisor', 'unavailable', 'expansion port not wired'));
    } else {
      let rec: ExpansionRecommendation | null = null;
      try {
        rec = await ePort.fetchExpansionRecommendation({ orgId });
        health.push(sourceHealth('expansion-advisor', rec ? 'ok' : 'partial'));
      } catch (e) {
        health.push(sourceHealth('expansion-advisor', 'unavailable', e instanceof Error ? e.message : String(e)));
      }
      if (rec) {
        rec.markets.forEach((m, i) => {
          fragments.push(
            buildEvidenceFragment({
              id: `ex-mkt-${i + 1}`,
              summary: `Market ${m.market}: risk-adjusted YoC ${m.riskAdjYoCPct.toFixed(2)}%, absorption ${m.absorption_mo} mo, verdict ${m.verdict.toUpperCase()}.`,
              source: { kind: 'advisor_output', ref: `expansion:market:${m.market}` },
            }),
          );
        });
        if (rec.markets.length > 0) {
          tables.push({
            id: 'ex-mkt-table',
            title: 'Market ranking',
            headers: ['Market', 'Risk-adj YoC %', 'Absorption (mo)', 'Verdict'],
            rows: rec.markets.map((m) => [m.market, m.riskAdjYoCPct.toFixed(2), m.absorption_mo, m.verdict]),
            citationIds: rec.markets.map((_, i) => `ex-mkt-${i + 1}`),
          });
        }
        fragments.push(
          buildEvidenceFragment({
            id: 'ex-capital-stack',
            summary: `Recommended capital stack: ${rec.capitalStack.debtPct.toFixed(1)}% debt / ${rec.capitalStack.prefEquityPct.toFixed(1)}% pref equity / ${rec.capitalStack.commonEquityPct.toFixed(1)}% common.`,
            source: { kind: 'advisor_output', ref: `expansion:capital-stack:${orgId}` },
          }),
        );
        fragments.push(
          buildEvidenceFragment({
            id: 'ex-hbu',
            summary: `Preferred HBU: ${rec.preferredHbu}.`,
            source: { kind: 'advisor_output', ref: `expansion:hbu:${orgId}` },
          }),
        );
      }
    }

    if (!gPort) {
      health.push(sourceHealth('green-angle-advisor', 'unavailable', 'green-angle port not wired'));
    } else {
      let green: GreenAngleSummary | null = null;
      try {
        green = await gPort.fetchGreenAngleSummary({ orgId });
        health.push(sourceHealth('green-angle-advisor', green ? 'ok' : 'partial'));
      } catch (e) {
        health.push(sourceHealth('green-angle-advisor', 'unavailable', e instanceof Error ? e.message : String(e)));
      }
      if (green) {
        green.topAngles.forEach((a, i) => {
          fragments.push(
            buildEvidenceFragment({
              id: `ex-grn-${i + 1}`,
              summary: `Green angle ${a.title}: impact ${a.impactScore.toFixed(2)}, capex ${formatMoney(a.capexEstimate)}.`,
              source: { kind: 'advisor_output', ref: `green-angle:${a.id}` },
            }),
          );
        });
        if (green.topAngles.length > 0) {
          tables.push({
            id: 'ex-grn-table',
            title: 'Top green angles',
            headers: ['Title', 'Impact', 'Capex'],
            rows: green.topAngles.map((a) => [a.title, a.impactScore.toFixed(2), formatMoney(a.capexEstimate)]),
            citationIds: green.topAngles.map((_, i) => `ex-grn-${i + 1}`),
          });
        }
      }
    }

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
