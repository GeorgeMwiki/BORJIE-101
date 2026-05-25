/**
 * HR template bundle — onboarding / offboarding / leave handlers
 * registered as stubs (Wave 24 wires the real ones; Piece B ships the
 * registration row only).
 */

import type { ModuleSpec } from '@borjie/module-spec-engine';
import type { ModuleTemplateBundle } from '../../types.js';
import specJson from './spec.json' with { type: 'json' };

const spec = specJson as unknown as ModuleSpec;

export const hrBundle: ModuleTemplateBundle = Object.freeze({
  slug: 'HR',
  titleEn: 'Human Resources',
  titleSw: 'Rasilimali Watu',
  description: 'Employees, departments, contracts, leave, payroll inputs.',
  icon: 'users',
  spec,
  acceptHandlers: Object.freeze([
    Object.freeze({
      action: 'start_onboarding_workflow',
      handlerModule: '@borjie/module-templates/hr/handlers/start_onboarding_workflow',
      allowedPersonaTiers: Object.freeze([1, 2, 3]),
      riskTier: 'MEDIUM' as const,
      emitsMoneyMutation: false,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          person_id: { kind: 'text', required: true },
        }),
      }),
    }),
    Object.freeze({
      action: 'start_offboarding_workflow',
      handlerModule: '@borjie/module-templates/hr/handlers/start_offboarding_workflow',
      allowedPersonaTiers: Object.freeze([1, 2]),
      riskTier: 'HIGH' as const,
      emitsMoneyMutation: true,
      payloadZod: Object.freeze({
        kind: 'object',
        fields: Object.freeze({
          person_id: { kind: 'text', required: true },
        }),
      }),
    }),
  ]),
});
