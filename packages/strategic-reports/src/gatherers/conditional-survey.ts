/**
 * Conditional survey of assets gatherer.
 *
 * Section 13 of the questionnaire memo calls this out as the
 * "Hardest report today" — evidence-driven, comparative to prior
 * surveys, with action plans. We assemble the current + prior
 * SurveySnapshot, compute the deflation / improvement delta per
 * building element, and surface a prioritised capex table.
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts, SurveySnapshot } from './ports.js';
import { buildEvidenceFragment, formatMoney, sourceHealth } from './ports.js';

const SEVERITY_ORDER: Readonly<Record<SurveySnapshot['defects'][number]['severity'], number>> = Object.freeze({
  critical: 4,
  major: 3,
  moderate: 2,
  minor: 1,
});

export interface ConditionalSurveyGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createConditionalSurveyGatherer(deps: ConditionalSurveyGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const fragments: EvidencePack['fragments'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const charts: EvidencePack['charts'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];
    const port = deps.ports.conditionalSurvey;

    if (!port) {
      health.push(sourceHealth('conditional-survey', 'unavailable', 'conditionalSurvey port not wired'));
      return Object.freeze({
        type: spec.type,
        spec,
        fragments: Object.freeze(fragments),
        charts: Object.freeze(charts),
        tables: Object.freeze(tables),
        sourceHealth: Object.freeze(health),
      });
    }

    const propertyId = scopePropertyId(spec.scope);
    if (!propertyId) {
      health.push(sourceHealth('conditional-survey', 'unavailable', 'conditional survey requires a property-scoped spec'));
      return Object.freeze({
        type: spec.type,
        spec,
        fragments: Object.freeze(fragments),
        charts: Object.freeze(charts),
        tables: Object.freeze(tables),
        sourceHealth: Object.freeze(health),
      });
    }

    let latest: SurveySnapshot | null = null;
    let prior: SurveySnapshot | null = null;
    try {
      latest = await port.fetchLatestSurvey({ propertyId });
      health.push(sourceHealth('latest-survey', latest ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('latest-survey', 'unavailable', stringifyErr(e)));
    }
    try {
      prior = await port.fetchPriorSurvey({ propertyId });
      health.push(sourceHealth('prior-survey', prior ? 'ok' : 'partial'));
    } catch (e) {
      health.push(sourceHealth('prior-survey', 'unavailable', stringifyErr(e)));
    }

    if (latest) {
      fragments.push(
        buildEvidenceFragment({
          id: 'cs-latest-overall',
          summary: `Latest survey ${latest.surveyDateIso}: overall grade ${latest.overallGrade}, ${latest.defects.length} defects logged.`,
          source: { kind: 'survey', ref: `survey:${propertyId}:${latest.surveyDateIso}` },
          data: { latest: { ...latest } },
        }),
      );

      const sortedDefects = [...latest.defects].sort(
        (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity],
      );

      sortedDefects.forEach((defect, i) => {
        fragments.push(
          buildEvidenceFragment({
            id: `cs-defect-${i + 1}`,
            summary: `Defect ${defect.defectId} (${defect.element}, ${defect.severity}) — remediation estimate ${formatMoney(defect.costEstimate)}.`,
            source: { kind: 'survey', ref: `defect:${defect.defectId}` },
            data: { defect: { ...defect } },
          }),
        );
      });

      tables.push({
        id: 'cs-defect-table',
        title: 'Defects by severity (prioritised)',
        headers: ['Element', 'Defect id', 'Severity', 'Cost estimate', 'Noted'],
        rows: sortedDefects.map((d) => [
          d.element,
          d.defectId,
          d.severity,
          formatMoney(d.costEstimate),
          d.notedAtIso.slice(0, 10),
        ]),
        citationIds: sortedDefects.map((_, i) => `cs-defect-${i + 1}`),
      });

      if (sortedDefects.length > 0) {
        const byElement = new Map<string, number>();
        for (const d of sortedDefects) {
          byElement.set(d.element, (byElement.get(d.element) ?? 0) + d.costEstimate.value);
        }
        const labels = Array.from(byElement.keys());
        charts.push({
          id: 'cs-capex-by-element',
          title: 'Capex by element',
          kind: 'bar',
          xLabels: labels,
          series: [{ name: 'Cost', values: labels.map((l) => byElement.get(l) ?? 0) }],
          yUnit: sortedDefects[0]!.costEstimate.currency,
          citationIds: sortedDefects.map((_, i) => `cs-defect-${i + 1}`),
        });
      }
    }

    if (prior && latest) {
      const delta = prior.defects.length - latest.defects.length;
      fragments.push(
        buildEvidenceFragment({
          id: 'cs-prior-comparison',
          summary: `Versus prior survey ${prior.surveyDateIso}: defect count change ${delta >= 0 ? '+' : ''}${delta}, grade ${prior.overallGrade} → ${latest.overallGrade}.`,
          source: { kind: 'survey', ref: `survey:${propertyId}:${prior.surveyDateIso}` },
          data: { prior: { ...prior } },
        }),
      );
    }

    return Object.freeze({
      type: spec.type,
      spec,
      fragments: Object.freeze(fragments),
      charts: Object.freeze(charts),
      tables: Object.freeze(tables),
      sourceHealth: Object.freeze(health),
    });
  };
}

function scopePropertyId(scope: GathererContext['spec']['scope']): string | null {
  switch (scope.kind) {
    case 'property':
      return scope.propertyId;
    case 'deal':
      return scope.propertyId ?? null;
    case 'tenant':
    case 'portfolio':
      return null;
  }
}

function stringifyErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
