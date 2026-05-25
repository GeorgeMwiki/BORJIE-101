import type { ModuleSpec } from '@borjie/module-spec-engine';
import type { ModuleTemplateBundle } from '../../types.js';
import specJson from './spec.json' with { type: 'json' };

const spec = specJson as unknown as ModuleSpec;

export const complianceBundle: ModuleTemplateBundle = Object.freeze({
  slug: 'COMPLIANCE',
  titleEn: 'Compliance',
  titleSw: 'Utii',
  description: 'Permits, audits, regulatory deadlines, gap remediation.',
  icon: 'shield-check',
  spec,
  acceptHandlers: Object.freeze([
    Object.freeze({
      action: 'open_compliance_task',
      handlerModule:
        '@borjie/module-templates/compliance/handlers/open_compliance_task',
      allowedPersonaTiers: Object.freeze([1, 2, 3]),
      riskTier: 'MEDIUM' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          property_id: { kind: 'text', required: true },
          gap: { kind: 'text', required: true },
        }),
      }),
    }),
  ]),
});
