/**
 * Adaptive Training barrel.
 *
 * Exports the public surface of the admin-driven adaptive training system:
 *  - types + errors
 *  - the mining concept catalog (single source of truth — thin re-export)
 *  - TrainingGenerator + factory
 *  - ScenarioGenerator + factory (concept-driven scenario simulation)
 *  - checkpoint-question builder (concept-driven mastery checkpoint)
 *  - TrainingRepository port + in-memory adapter
 *  - TrainingAssignmentService (event-bus + feature-flag aware)
 *  - TrainingDeliveryService (BKT-driven progression + stall detection)
 *  - Admin endpoint facade consumed by the api-gateway router
 */

export * from './training-types.js';
// Thin stable re-export of the mining concept catalog so consumers of the
// `@borjie/ai-copilot/training` subpath (api-gateway scenario/checkpoint
// routes, scenario generator, checkpoint-question builder) reach
// ESTATE_CONCEPTS / getConcept / conceptsByCategory without importing package
// internals. The catalog is the single source of truth — nothing fabricates
// concept content.
export * from './concepts-catalog.js';
export * from './scenario-generator.js';
export * from './checkpoint-questions.js';
export * from './training-generator.js';
export * from './training-repository.js';
export * from './training-assignment-service.js';
export * from './training-delivery-service.js';
export * from './admin-dashboard-endpoints.js';
