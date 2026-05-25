import type { ModuleSpec } from '@borjie/module-spec-engine';
import type { ModuleTemplateBundle } from '../../types.js';
import specJson from './spec.json' with { type: 'json' };

const spec = specJson as unknown as ModuleSpec;

export const strategyBundle: ModuleTemplateBundle = Object.freeze({
  slug: 'STRATEGY',
  titleEn: 'Strategy',
  titleSw: 'Mkakati',
  description: 'KPIs, forecasts, executive calendar, scenario planning.',
  icon: 'target',
  spec,
  acceptHandlers: Object.freeze([
    Object.freeze({
      action: 'request_valuation_run',
      handlerModule: '@borjie/module-templates/strategy/handlers/request_valuation_run',
      allowedPersonaTiers: Object.freeze([1, 2]),
      riskTier: 'MEDIUM' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          building_id: { kind: 'text', required: true },
        }),
      }),
    }),
    Object.freeze({
      action: 'add_executive_calendar_item',
      handlerModule:
        '@borjie/module-templates/strategy/handlers/add_executive_calendar_item',
      allowedPersonaTiers: Object.freeze([1, 2]),
      riskTier: 'LOW' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          due_date: { kind: 'text', required: true },
          title: { kind: 'text', required: true },
        }),
      }),
    }),
  ]),
});
