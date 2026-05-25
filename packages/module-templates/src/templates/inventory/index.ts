import type { ModuleSpec } from '@borjie/module-spec-engine';
import type { ModuleTemplateBundle } from '../../types.js';
import specJson from './spec.json' with { type: 'json' };

const spec = specJson as unknown as ModuleSpec;

export const inventoryBundle: ModuleTemplateBundle = Object.freeze({
  slug: 'INVENTORY',
  titleEn: 'Inventory',
  titleSw: 'Ghala',
  description: 'Stock, movements, reorder triggers, warehouse locations.',
  icon: 'package',
  spec,
  acceptHandlers: Object.freeze([
    Object.freeze({
      action: 'create_reorder_proposal',
      handlerModule:
        '@borjie/module-templates/inventory/handlers/create_reorder_proposal',
      allowedPersonaTiers: Object.freeze([1, 2, 3]),
      riskTier: 'MEDIUM' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          sku_id: { kind: 'text', required: true },
        }),
      }),
    }),
  ]),
});
