/**
 * Research Triggers — decide when to call the Research Service.
 *
 * Listens for accumulator change events. When a trigger matches, invokes
 * the research service and folds results back into the accumulator.
 *
 * Triggers are declarative (data) so new enrichment lines slot in.
 *
 * @module progressive-intelligence/research-triggers
 */

import type { ContextChangeEvent, AccumulatedEstateContext } from './types.js';
import type { ContextAccumulatorService } from './context-accumulator.js';
import type { ResearchService } from './research-service.js';

export type TriggerId =
  | 'rent_benchmark_on_district'
  | 'vacancy_on_district'
  | 'rent_benchmark_on_rent_entered';

export interface ResearchTrigger {
  readonly id: TriggerId;
  readonly shouldFire: (event: ContextChangeEvent, ctx: AccumulatedEstateContext) => boolean;
  readonly fire: (args: {
    event: ContextChangeEvent;
    ctx: AccumulatedEstateContext;
    research: ResearchService;
    accumulator: ContextAccumulatorService;
  }) => Promise<void>;
}

export const DEFAULT_TRIGGERS: readonly ResearchTrigger[] = [
  {
    id: 'rent_benchmark_on_district',
    shouldFire: (event) => event.fieldPath === 'property.district',
    fire: async ({ event, ctx, research, accumulator }) => {
      const district = ctx.property.district;
      if (!district) return;
      const benchmark = await research.lookupMarketRent(
        event.tenantId,
        event.sessionId,
        district,
        'residential',
      );
      if (!benchmark) return;
      accumulator.updateField({
        sessionId: event.sessionId,
        tenantId: event.tenantId,
        path: 'renewalProposal.existingRentCents',
        value: ctx.leaseTerms.monthlyRentCents ?? benchmark.medianRentCents,
        source: 'inferred',
        confidence: 0.6,
      });
    },
  },
  {
    id: 'vacancy_on_district',
    shouldFire: (event) => event.fieldPath === 'property.district',
    fire: async ({ event, ctx, research }) => {
      const district = ctx.property.district;
      if (!district) return;
      await research.lookupDistrictVacancy(event.tenantId, event.sessionId, district);
    },
  },
  {
    id: 'rent_benchmark_on_rent_entered',
    shouldFire: (event) => event.fieldPath === 'leaseTerms.monthlyRentCents',
    fire: async ({ event, ctx, research }) => {
      const district = ctx.property.district;
      if (!district) return;
      await research.lookupMarketRent(event.tenantId, event.sessionId, district, 'residential');
    },
  },
];

export class ResearchTriggerHub {
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly accumulator: ContextAccumulatorService,
    private readonly research: ResearchService,
    private readonly triggers: readonly ResearchTrigger[] = DEFAULT_TRIGGERS,
  ) {}

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.accumulator.onChange((event) => {
      const ctx = this.accumulator.getContext(event.sessionId, event.tenantId);
      if (!ctx) return;
      for (const trig of this.triggers) {
        if (trig.shouldFire(event, ctx)) {
          void trig
            .fire({
              event,
              ctx,
              research: this.research,
              accumulator: this.accumulator,
            })
            .catch(() => {
              /* triggers are best-effort */
            });
        }
      }
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}

export function createResearchTriggerHub(
  accumulator: ContextAccumulatorService,
  research: ResearchService,
  triggers?: readonly ResearchTrigger[],
): ResearchTriggerHub {
  return new ResearchTriggerHub(accumulator, research, triggers);
}
