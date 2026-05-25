import type { EntityType } from './queue'

/**
 * Map each queued entity type to the field API path it flushes to. Centralised
 * so we never have to grep across screens to know where a write lands. New
 * entity types must be added here AND in queue.ts EntityType union.
 */
export const ENTITY_ENDPOINTS: Readonly<Record<EntityType, string>> = {
  shift_report: '/shift-reports',
  incident: '/incidents',
  attendance: '/attendance',
  fingerprint_sign: '/fingerprint-signs',
  sample: '/samples',
  fuel_log: '/fuel-logs',
  machine_hour: '/machine-hours',
  photo_upload: '/photo-uploads',
  inventory_move: '/inventory-moves',
  sic_ping: '/sic-pings',
  voice_query: '/voice-queries',
  driver_letter_ack: '/driver-letter-acks',
  toolbox_ack: '/toolbox-acks',
  ppe_receipt: '/ppe-receipts',
  excavator_count: '/excavator-counts',
  drill_hole: '/drill-holes',
  weighbridge_capture: '/weighbridge-captures'
}
