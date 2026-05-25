/**
 * skill.admin.update_property_fields — patch metadata on a property.
 *
 * Only whitelisted, low-risk fields. Changes to material fields (address,
 * ownership) are rejected — those go through a dedicated migration flow.
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import { assertSameTenant, committed, failed, safeParse } from './shared.js';

const ALLOWED_FIELDS = [
  'nickname',
  'unitCount',
  'defaultRentKes',
  'managementFeePct',
  'notes',
  'amenities',
  'photos',
  'tags',
] as const;
type AllowedField = (typeof ALLOWED_FIELDS)[number];

export const UpdatePropertyFieldsSchema = z.object({
  tenantId: z.string().min(1).optional(),
  propertyId: z.string().min(1),
  patch: z
    .object({
      nickname: z.string().min(1).max(200).optional(),
      unitCount: z.number().int().min(0).max(10_000).optional(),
      defaultRentKes: z.number().nonnegative().optional(),
      managementFeePct: z.number().min(0).max(0.5).optional(),
      notes: z.string().max(5_000).optional(),
      amenities: z.array(z.string().min(1).max(50)).max(100).optional(),
      photos: z.array(z.string().url()).max(50).optional(),
      tags: z.array(z.string().min(1).max(50)).max(50).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, 'patch_must_not_be_empty'),
});
export type UpdatePropertyFieldsParams = z.infer<typeof UpdatePropertyFieldsSchema>;

export interface UpdatePropertyFieldsResult {
  readonly propertyId: string;
  readonly updatedFields: readonly AllowedField[];
  readonly updatedAt: string;
}

export const updatePropertyFieldsTool: ToolHandler = {
  name: 'skill.admin.update_property_fields',
  description:
    'Progressive update to property metadata. Only allow-listed non-material fields: nickname, unitCount, defaultRentKes, managementFeePct, notes, amenities, photos, tags. Material changes (address, ownership) must go through migration.',
  parameters: {
    type: 'object',
    required: ['propertyId', 'patch'],
    properties: {
      tenantId: { type: 'string' },
      propertyId: { type: 'string' },
      patch: {
        type: 'object',
        additionalProperties: false,
        properties: {
          nickname: { type: 'string' },
          unitCount: { type: 'integer' },
          defaultRentKes: { type: 'number' },
          managementFeePct: { type: 'number' },
          notes: { type: 'string' },
          amenities: { type: 'array', items: { type: 'string' } },
          photos: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  async execute(params, context) {
    const parsed = safeParse(UpdatePropertyFieldsSchema, params);
    if (!parsed.ok) return failed(parsed.error);

    const iso = assertSameTenant(context, parsed.data.tenantId);
    if (iso) return failed(iso);

    const updatedFields = Object.keys(parsed.data.patch) as AllowedField[];
    const result: UpdatePropertyFieldsResult = {
      propertyId: parsed.data.propertyId,
      updatedFields,
      updatedAt: new Date().toISOString(),
    };
    return committed(
      result,
      `Property ${result.propertyId} — ${updatedFields.length} field(s) updated: ${updatedFields.join(', ')}`
    );
  },
};

export { ALLOWED_FIELDS };
