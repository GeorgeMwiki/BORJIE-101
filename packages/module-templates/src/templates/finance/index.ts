import type { ModuleSpec } from '@borjie/module-spec-engine';
import type { ModuleTemplateBundle } from '../../types.js';
import specJson from './spec.json' with { type: 'json' };

const spec = specJson as unknown as ModuleSpec;

export const financeBundle: ModuleTemplateBundle = Object.freeze({
  slug: 'FINANCE',
  titleEn: 'Finance',
  titleSw: 'Fedha',
  description: 'Receipts, invoices, ledger, statements, variance.',
  icon: 'banknote',
  spec,
  acceptHandlers: Object.freeze([
    Object.freeze({
      action: 'post_receipt_draft',
      handlerModule: '@borjie/module-templates/finance/handlers/post_receipt_draft',
      allowedPersonaTiers: Object.freeze([1, 2, 3]),
      riskTier: 'HIGH' as const,
      emitsMoneyMutation: true,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          payer_id: { kind: 'text', required: true },
          amount: { kind: 'numeric', required: true },
        }),
      }),
    }),
    Object.freeze({
      action: 'flag_variance_alert',
      handlerModule: '@borjie/module-templates/finance/handlers/flag_variance_alert',
      allowedPersonaTiers: Object.freeze([1, 2]),
      riskTier: 'MEDIUM' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          variance_amount: { kind: 'numeric', required: true },
          period: { kind: 'text', required: true },
        }),
      }),
    }),
  ]),
});
