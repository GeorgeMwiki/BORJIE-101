/**
 * Annual estate operating review (AOR) gatherer.
 *
 * The AOR is the one-document-for-the-Board: it composes every other
 * advisor port (leasing financial + sustainability + rent-roll + survey
 * + expansion + lifecycle disposition/refi) into a single EvidencePack
 * for a fiscal-year operating verdict.
 *
 * The composer + persona slice this differently for board vs internal
 * audiences (board gets scenario tables; internal gets action grids).
 */

import type { EvidencePack, Gatherer, GathererContext } from '../types.js';
import type { AdvisorPorts } from './ports.js';
import { createLeasingFinancialGatherer } from './leasing-financial.js';
import { createSustainabilityGatherer } from './sustainability.js';
import { createRentRollGatherer } from './rent-roll.js';
import { createConditionalSurveyGatherer } from './conditional-survey.js';
import { createExpansionStrategyGatherer } from './expansion-strategy.js';
import { sourceHealth } from './ports.js';

export interface AnnualOperatingReviewGathererDeps {
  readonly ports: AdvisorPorts;
}

export function createAnnualOperatingReviewGatherer(deps: AnnualOperatingReviewGathererDeps): Gatherer {
  return async function gather(ctx: GathererContext): Promise<EvidencePack> {
    const { spec } = ctx;
    const fragments: EvidencePack['fragments'][number][] = [];
    const tables: EvidencePack['tables'][number][] = [];
    const charts: EvidencePack['charts'][number][] = [];
    const health: EvidencePack['sourceHealth'][number][] = [];

    // Each sub-gatherer runs independently; we prefix their fragment/table/chart
    // ids with the sub-gatherer name so duplicates from cross-report runs cannot
    // collide in the synthesizer's prompt or the renderer's citation table.

    const subGatherers: ReadonlyArray<{ name: string; gatherer: ReturnType<typeof createLeasingFinancialGatherer> }> = [
      { name: 'lf', gatherer: createLeasingFinancialGatherer({ ports: deps.ports }) },
      { name: 'sus', gatherer: createSustainabilityGatherer({ ports: deps.ports }) },
      { name: 'rr', gatherer: createRentRollGatherer({ ports: deps.ports }) },
      { name: 'cs', gatherer: createConditionalSurveyGatherer({ ports: deps.ports }) },
      { name: 'ex', gatherer: createExpansionStrategyGatherer({ ports: deps.ports }) },
    ];

    const subPacks = await Promise.all(
      subGatherers.map(async ({ name, gatherer }) => {
        try {
          const pack = await gatherer(ctx);
          return { name, pack, error: null as string | null };
        } catch (e) {
          return { name, pack: null as EvidencePack | null, error: e instanceof Error ? e.message : String(e) };
        }
      }),
    );

    for (const sub of subPacks) {
      if (sub.error || sub.pack === null) {
        health.push(sourceHealth(`aor-${sub.name}`, 'unavailable', sub.error ?? 'unknown'));
        continue;
      }
      health.push(sourceHealth(`aor-${sub.name}`, 'ok'));
      for (const fragment of sub.pack.fragments) {
        fragments.push({ ...fragment, id: `${sub.name}-${fragment.id}` });
      }
      for (const chart of sub.pack.charts) {
        charts.push({
          ...chart,
          id: `${sub.name}-${chart.id}`,
          citationIds: chart.citationIds.map((c) => `${sub.name}-${c}`),
        });
      }
      for (const table of sub.pack.tables) {
        tables.push({
          ...table,
          id: `${sub.name}-${table.id}`,
          citationIds: table.citationIds.map((c) => `${sub.name}-${c}`),
        });
      }
      for (const h of sub.pack.sourceHealth) {
        health.push({ ...h, sourceId: `${sub.name}-${h.sourceId}` });
      }
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
