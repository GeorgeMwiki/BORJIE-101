/**
 * FLEET template bundle — vehicle assignment + service handlers.
 */

import type { ModuleSpec } from '@borjie/module-spec-engine';
import type { ModuleTemplateBundle } from '../../types.js';
import specJson from './spec.json' with { type: 'json' };

const spec = specJson as unknown as ModuleSpec;

export const fleetBundle: ModuleTemplateBundle = Object.freeze({
  slug: 'FLEET',
  titleEn: 'Fleet Management',
  titleSw: 'Usimamizi wa Magari',
  description: 'Vehicles, drivers, routes, fuel, service intervals.',
  icon: 'truck',
  spec,
  acceptHandlers: Object.freeze([
    Object.freeze({
      action: 'create_assignment',
      handlerModule: '@borjie/module-templates/fleet/handlers/create_assignment',
      allowedPersonaTiers: Object.freeze([1, 2, 3]),
      riskTier: 'MEDIUM' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          vehicle_id: { kind: 'text', required: true },
          driver_id: { kind: 'text', required: false },
        }),
      }),
    }),
  ]),
});
