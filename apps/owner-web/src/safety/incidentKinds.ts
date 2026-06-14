/**
 * Incident kinds the owner-web "log new incident" form offers.
 *
 * MUST stay byte-for-byte aligned with the gateway `IncidentKindEnum`
 * (services/api-gateway/src/routes/mining/_openapi/sales-incidents-schemas.ts).
 * A drift here re-introduces the contract-422 bug: the form previously
 * offered a 'security' kind the gateway rejected and omitted near_miss /
 * equipment_failure / fatality.
 *
 * Kept as a standalone module so the value can be unit-tested without
 * importing the client page (and its React/Next dependencies).
 */
export const INCIDENT_KINDS = [
  'safety',
  'environmental',
  'community',
  'near_miss',
  'equipment_failure',
  'fatality',
] as const;

export type IncidentKind = (typeof INCIDENT_KINDS)[number];
