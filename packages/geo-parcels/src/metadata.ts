/**
 * Piece N — parcel typed-EAV metadata.
 *
 * The DB enforces UNIQUE(parcel_id, key) and a CHECK on value_kind.
 * This module enforces shape-of-value matches value_kind BEFORE the
 * round-trip — saves a wasted DB call on the obvious failures and
 * gives the application a clean error.
 */

import { GeoParcelsError, ParcelMetadataSchema } from './types.js';
import type {
  MetadataValueKind,
  ParcelMetadata,
} from './types.js';
import type { GeoParcelsPort } from './persistence-port.js';
import { appendActivity } from './activity-log.js';

export interface SetMetadataArgs {
  id: string;
  tenant_id: string;
  parcel_id: string;
  key: string;
  value_kind: MetadataValueKind;
  value: unknown;
  created_by_user_id?: string | null;
  /** Whether to emit an activity-log event. Defaults true. */
  log_activity?: boolean;
  actor_user_id?: string;
  actor_persona_id?: string | null;
}

/**
 * Validate `value` matches `value_kind`. The DB stores the value in
 * `value_jsonb`; we wrap primitives in `{ value: ... }`.
 */
function validateValueShape(
  value_kind: MetadataValueKind,
  value: unknown,
): Record<string, unknown> {
  switch (value_kind) {
    case 'text':
      if (typeof value !== 'string') {
        throw new GeoParcelsError(
          'INVALID_METADATA_VALUE',
          `value_kind=text but value is ${typeof value}`,
        );
      }
      return { value };
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new GeoParcelsError(
          'INVALID_METADATA_VALUE',
          `value_kind=number but value is not a finite number`,
        );
      }
      return { value };
    case 'boolean':
      if (typeof value !== 'boolean') {
        throw new GeoParcelsError(
          'INVALID_METADATA_VALUE',
          `value_kind=boolean but value is ${typeof value}`,
        );
      }
      return { value };
    case 'date': {
      if (typeof value !== 'string' || isNaN(Date.parse(value))) {
        throw new GeoParcelsError(
          'INVALID_METADATA_VALUE',
          `value_kind=date but value is not an ISO date string`,
        );
      }
      return { value };
    }
    case 'enum': {
      // For enum: value must be an object with { value: string, options: string[] }.
      if (
        typeof value !== 'object' ||
        value === null ||
        !('value' in value) ||
        !('options' in value)
      ) {
        throw new GeoParcelsError(
          'INVALID_METADATA_VALUE',
          'value_kind=enum but value is not { value, options }',
        );
      }
      const v = value as { value: unknown; options: unknown };
      if (typeof v.value !== 'string') {
        throw new GeoParcelsError(
          'INVALID_METADATA_VALUE',
          'enum.value must be a string',
        );
      }
      if (!Array.isArray(v.options) || !v.options.every((o) => typeof o === 'string')) {
        throw new GeoParcelsError(
          'INVALID_METADATA_VALUE',
          'enum.options must be an array of strings',
        );
      }
      if (!v.options.includes(v.value)) {
        throw new GeoParcelsError(
          'INVALID_METADATA_VALUE',
          `enum value "${v.value}" not in options [${v.options.join(',')}]`,
        );
      }
      return { value: v.value, options: v.options };
    }
    case 'jsonb':
      if (typeof value !== 'object' || value === null) {
        throw new GeoParcelsError(
          'INVALID_METADATA_VALUE',
          'value_kind=jsonb requires a non-null object',
        );
      }
      return value as Record<string, unknown>;
  }
}

export async function setParcelMetadata(
  port: GeoParcelsPort,
  args: SetMetadataArgs,
): Promise<ParcelMetadata> {
  const value_jsonb = validateValueShape(args.value_kind, args.value);

  const row: ParcelMetadata = {
    id: args.id,
    tenant_id: args.tenant_id,
    parcel_id: args.parcel_id,
    key: args.key,
    value_kind: args.value_kind,
    value_jsonb,
    created_by_user_id: args.created_by_user_id ?? null,
  };

  const result = ParcelMetadataSchema.safeParse(row);
  if (!result.success) {
    throw new GeoParcelsError(
      'INVALID_METADATA_VALUE',
      `metadata failed validation: ${result.error.message}`,
    );
  }

  const persisted = await port.upsertParcelMetadata(row);

  if (args.log_activity !== false) {
    await appendActivity(port, {
      id: `${args.parcel_id}_meta_${args.key}_${Date.now()}`,
      tenant_id: args.tenant_id,
      parcel_id: args.parcel_id,
      event_kind: 'metadata_changed',
      event_payload_jsonb: {
        key: args.key,
        value_kind: args.value_kind,
      },
      actor_user_id: args.actor_user_id ?? args.created_by_user_id ?? null,
      actor_persona_id: args.actor_persona_id ?? null,
    });
  }

  return persisted;
}

export async function listParcelMetadata(
  port: GeoParcelsPort,
  parcelId: string,
  tenantId: string,
): Promise<ParcelMetadata[]> {
  return port.listParcelMetadata(parcelId, tenantId);
}
