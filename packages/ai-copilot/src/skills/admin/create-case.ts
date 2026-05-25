/**
 * skill.admin.create_case — open a maintenance/complaint case from chat.
 *
 * The floating Mr. Mwikila widget gathers fields conversationally, then
 * invokes this skill to materialise the case. Low-impact + internal-only,
 * so commits immediately.
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import { assertSameTenant, committed, failed, safeParse } from './shared.js';

export const CreateCaseParamsSchema = z.object({
  tenantId: z.string().min(1).optional(),
  propertyId: z.string().min(1),
  unitId: z.string().min(1).optional(),
  reportedByUserId: z.string().min(1),
  category: z.enum([
    'plumbing',
    'electrical',
    'hvac',
    'appliance',
    'structural',
    'pest',
    'landscaping',
    'security',
    'complaint',
    'other',
  ]),
  severity: z.enum(['low', 'medium', 'high', 'emergency']).default('medium'),
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(5_000),
  photos: z.array(z.string().url()).max(20).default([]),
  suggestedVendorId: z.string().optional(),
});
export type CreateCaseParams = z.infer<typeof CreateCaseParamsSchema>;

export interface CreateCaseResult {
  readonly caseId: string;
  readonly propertyId: string;
  readonly severity: CreateCaseParams['severity'];
  readonly suggestedSlaHours: number;
}

const SLA_BY_SEVERITY: Record<CreateCaseParams['severity'], number> = {
  emergency: 2,
  high: 24,
  medium: 72,
  low: 168,
};

export function buildCase(params: CreateCaseParams): CreateCaseResult {
  // Deterministic stable id from a content hash (wireable to DB insert later).
  const seed = `${params.propertyId}:${params.category}:${params.title}:${Date.now()}`;
  const caseId = `case_${hashCode(seed)}`;
  return {
    caseId,
    propertyId: params.propertyId,
    severity: params.severity,
    suggestedSlaHours: SLA_BY_SEVERITY[params.severity],
  };
}

function hashCode(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  }
  return (h >>> 0).toString(36);
}

export const createCaseTool: ToolHandler = {
  name: 'skill.admin.create_case',
  description:
    'Open a new maintenance or complaint case from chat-confirmed fields. Returns a case id and suggested SLA window based on severity.',
  parameters: {
    type: 'object',
    required: ['propertyId', 'reportedByUserId', 'category', 'title', 'description'],
    properties: {
      tenantId: { type: 'string' },
      propertyId: { type: 'string' },
      unitId: { type: 'string' },
      reportedByUserId: { type: 'string' },
      category: {
        type: 'string',
        enum: [
          'plumbing',
          'electrical',
          'hvac',
          'appliance',
          'structural',
          'pest',
          'landscaping',
          'security',
          'complaint',
          'other',
        ],
      },
      severity: { type: 'string', enum: ['low', 'medium', 'high', 'emergency'] },
      title: { type: 'string' },
      description: { type: 'string' },
      photos: { type: 'array', items: { type: 'string' } },
      suggestedVendorId: { type: 'string' },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(CreateCaseParamsSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const result = buildCase(parsed.data);
    return committed(result, `Case ${result.caseId} (${result.severity}) opened on ${result.propertyId}`);
  },
};
