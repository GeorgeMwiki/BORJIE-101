import type { EntityType } from './queue'

/**
 * Explicit overrides for entity types whose path doesn't follow the default
 * `<entityType>s` plural rule. Kept tiny on purpose — anything not listed
 * here flows through `endpointFor` and gets the default pluralisation.
 *
 * `weighbridge` lands on `/samples` because the api-gateway treats
 * weighbridge captures as sample submissions in the mining surface.
 */
const ENDPOINT_OVERRIDES: Readonly<Partial<Record<EntityType, string>>> = {
  shift_report: 'shift-reports',
  drill_hole: 'drill-holes',
  fuel_log: 'fuel-logs',
  attendance: 'attendance',
  weighbridge_capture: 'samples'
}

/**
 * Resolve the api-gateway path segment for a queued entity. Returns the
 * relative path (no leading slash) so callers can compose against
 * `${API_BASE_URL}/api/v1/mining/<path>`.
 *
 * Default rule: convert snake_case → kebab-case and append 's' unless the
 * type is in ENDPOINT_OVERRIDES.
 */
export function endpointFor(entityType: EntityType): string {
  const override = ENDPOINT_OVERRIDES[entityType]
  if (override) {
    return override
  }
  const kebab = entityType.replace(/_/gu, '-')
  return `${kebab}s`
}

/**
 * Backwards-compatible map for callers that prefer a static lookup. New
 * code should call `endpointFor()` so override behaviour stays in one
 * place. Each value is a relative path (no leading slash) under the
 * mining prefix.
 */
export const ENTITY_ENDPOINTS: Readonly<Record<EntityType, string>> = {
  shift_report: 'shift-reports',
  incident: endpointFor('incident'),
  attendance: 'attendance',
  fingerprint_sign: endpointFor('fingerprint_sign'),
  sample: 'samples',
  fuel_log: 'fuel-logs',
  machine_hour: endpointFor('machine_hour'),
  photo_upload: endpointFor('photo_upload'),
  inventory_move: endpointFor('inventory_move'),
  sic_ping: endpointFor('sic_ping'),
  voice_query: endpointFor('voice_query'),
  driver_letter_ack: endpointFor('driver_letter_ack'),
  toolbox_ack: endpointFor('toolbox_ack'),
  ppe_receipt: endpointFor('ppe_receipt'),
  excavator_count: endpointFor('excavator_count'),
  drill_hole: 'drill-holes',
  weighbridge_capture: 'samples'
}
