import type { ModuleSpec } from '@borjie/module-spec-engine';
import type { ModuleTemplateBundle } from '../../types.js';
import specJson from './spec.json' with { type: 'json' };

const spec = specJson as unknown as ModuleSpec;

export const crmBundle: ModuleTemplateBundle = Object.freeze({
  slug: 'CRM',
  titleEn: 'CRM',
  titleSw: 'Mahusiano',
  description: 'Leads, complaints, prospects, customer-touch timeline.',
  icon: 'message-circle',
  spec,
  acceptHandlers: Object.freeze([
    Object.freeze({
      action: 'create_lead',
      handlerModule: '@borjie/module-templates/crm/handlers/create_lead',
      allowedPersonaTiers: Object.freeze([1, 2, 3, 4]),
      riskTier: 'LOW' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          person_id: { kind: 'text', required: true },
        }),
      }),
    }),
    Object.freeze({
      action: 'open_complaint_ticket',
      handlerModule: '@borjie/module-templates/crm/handlers/open_complaint_ticket',
      allowedPersonaTiers: Object.freeze([1, 2, 3, 4]),
      riskTier: 'MEDIUM' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          person_id: { kind: 'text', required: true },
          subject: { kind: 'text', required: true },
        }),
      }),
    }),
  ]),
});
