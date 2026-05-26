/**
 * ESTATE template bundle — ships the 2 surviving Piece-B handlers
 * (`create_lease_application` + `post_receipt_draft`). The 3
 * BossNyumba-era handlers (open_maintenance_case,
 * schedule_renewal_negotiation, bulk_mark_for_renewal_prep) were ported
 * to mining-domain equivalents under `templates/mining/`. Closed
 * TODO(#34).
 */

import type { ModuleSpec } from '@borjie/module-spec-engine';
import type { ModuleTemplateBundle } from '../../types.js';
import specJson from './spec.json' with { type: 'json' };

const spec = specJson as unknown as ModuleSpec;

export const estateBundle: ModuleTemplateBundle = Object.freeze({
  slug: 'ESTATE',
  titleEn: 'Estate Management',
  titleSw: 'Usimamizi wa Mali',
  description:
    'Land, buildings, units, leases, maintenance — the property core.',
  icon: 'building',
  spec,
  acceptHandlers: Object.freeze([
    Object.freeze({
      action: 'create_lease_application',
      handlerModule:
        '@borjie/module-templates/estate/handlers/create_lease_application',
      allowedPersonaTiers: Object.freeze([1, 2, 3]),
      riskTier: 'HIGH' as const,
      emitsMoneyMutation: true,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          prospective_tenant: { kind: 'object', required: true },
          unit_id: { kind: 'text', required: true },
          desired_start_date: { kind: 'date', required: true },
          monthly_rent: { kind: 'object', required: true },
          proposed_term_months: {
            kind: 'int',
            required: true,
            min: 1,
            max: 120,
          },
          source: { kind: 'object', required: true },
        }),
      }),
    }),
    Object.freeze({
      action: 'post_receipt_draft',
      handlerModule:
        '@borjie/module-templates/estate/handlers/post_receipt_draft',
      allowedPersonaTiers: Object.freeze([1, 2, 3]),
      // Money mutation but DRAFT only — managers approve final post.
      riskTier: 'HIGH' as const,
      emitsMoneyMutation: true,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          amount: { kind: 'object', required: true },
          customer_entity_id: { kind: 'text', required: true },
        }),
      }),
    }),
  ]),
});

export {
  createLeaseApplicationHandler,
  CreateLeaseApplicationPayloadSchema,
  type CreateLeaseApplicationPayload,
  type CreateLeaseApplicationDeps,
  type CreateLeaseApplicationContext,
  type AcceptResult as CreateLeaseApplicationResult,
} from './handlers/create-lease-application.js';
