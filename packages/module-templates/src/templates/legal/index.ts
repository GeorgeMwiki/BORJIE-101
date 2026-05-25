import type { ModuleSpec } from '@borjie/module-spec-engine';
import type { ModuleTemplateBundle } from '../../types.js';
import specJson from './spec.json' with { type: 'json' };

const spec = specJson as unknown as ModuleSpec;

export const legalBundle: ModuleTemplateBundle = Object.freeze({
  slug: 'LEGAL',
  titleEn: 'Legal',
  titleSw: 'Sheria',
  description: 'Cases, contracts, counsel routing, jurisdictional filings.',
  icon: 'scale',
  spec,
  acceptHandlers: Object.freeze([
    Object.freeze({
      action: 'route_to_counsel',
      handlerModule: '@borjie/module-templates/legal/handlers/route_to_counsel',
      allowedPersonaTiers: Object.freeze([1, 2, 3]),
      riskTier: 'HIGH' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          document_id: { kind: 'text', required: true },
        }),
      }),
    }),
    Object.freeze({
      action: 'open_breach_case',
      handlerModule: '@borjie/module-templates/legal/handlers/open_breach_case',
      allowedPersonaTiers: Object.freeze([1, 2]),
      riskTier: 'SOVEREIGN' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          lease_id: { kind: 'text', required: true },
          details: { kind: 'text', required: true },
        }),
      }),
    }),
  ]),
});
