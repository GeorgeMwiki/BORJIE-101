/**
 * Adaptive Training barrel.
 *
 * Exports the public surface of the admin-driven adaptive training system:
 *  - types + errors
 *  - TrainingGenerator + factory
 *  - TrainingRepository port + in-memory adapter
 *  - TrainingAssignmentService (event-bus + feature-flag aware)
 *  - TrainingDeliveryService (BKT-driven progression + stall detection)
 *  - Admin endpoint facade consumed by the api-gateway router
 */

export * from './training-types.js';
export * from './training-generator.js';
export * from './training-repository.js';
export * from './training-assignment-service.js';
export * from './training-delivery-service.js';
export * from './admin-dashboard-endpoints.js';
