/**
 * Barrel export for the mining sub-API OpenAPI schemas.
 *
 * Co-located with the routes (vs. living under
 * `services/api-gateway/src/openapi/`) because these schemas are
 * tightly coupled to the route handlers — they are the wire contract.
 */
export * from './envelopes';
export * from './site-schemas';
export * from './licence-schemas';
export * from './cockpit-schemas';
export * from './chat-schemas';
export * from './marketplace-schemas';
export * from './bid-schemas';
export * from './route-defs';
