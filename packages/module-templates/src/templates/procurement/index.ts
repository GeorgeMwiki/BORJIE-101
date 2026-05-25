import type { ModuleSpec } from '@borjie/module-spec-engine';
import type { ModuleTemplateBundle } from '../../types.js';
import specJson from './spec.json' with { type: 'json' };

const spec = specJson as unknown as ModuleSpec;

export const procurementBundle: ModuleTemplateBundle = Object.freeze({
  slug: 'PROCUREMENT',
  titleEn: 'Procurement',
  titleSw: 'Manunuzi',
  description: 'Vendors, RFPs, purchase orders, goods-received notes.',
  icon: 'shopping-cart',
  spec,
  acceptHandlers: Object.freeze([
    Object.freeze({
      action: 'create_invoice_draft',
      handlerModule:
        '@borjie/module-templates/procurement/handlers/create_invoice_draft',
      allowedPersonaTiers: Object.freeze([1, 2, 3]),
      riskTier: 'HIGH' as const,
      emitsMoneyMutation: true,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          vendor_id: { kind: 'text', required: true },
          amount: { kind: 'numeric', required: true },
        }),
      }),
    }),
  ]),
});
