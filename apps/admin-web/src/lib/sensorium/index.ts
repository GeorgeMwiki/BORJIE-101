/**
 * Sensorium barrel — Central Command Phase A (C4 Brain Skin).
 *
 * Re-exports the public surface for the rest of the admin-platform-
 * portal app: the bus, the snapshot helpers, the presence packet, the
 * PII redactor, and the 14 event handlers.
 */

export * from './types.js';
export * from './pii-redactor.js';
export * from './a11y-tree-snapshot.js';
export * from './presence-packet.js';
export { SensoriumBus } from './event-bus-client.js';
export * from './event-handlers/index.js';
