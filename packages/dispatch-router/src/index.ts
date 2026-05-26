/**
 * @borjie/dispatch-router — Piece L brain↔tab loop.
 *
 * Exports:
 *   - capture()            : post-pipeline hook (call after kernel.think())
 *   - dispatchToTabs()     : matrix-driven proposal generation
 *   - approveProposal()    : HITL approval handler
 *   - declineProposal()    : HITL decline handler
 *   - editProposal()       : HITL edit-then-approve handler
 *   - PLATFORM_ROUTING_MATRIX : 17-row default matrix
 *   - In-memory stores + stub handler registry for tests
 *   - Zod schemas for runtime validation at the kernel/api boundary
 */

export * from './types.js';
export * from './matrix-defaults.js';
export * from './audit-link.js';
export * from './store.js';
export * from './canonical-resolver.js';
export * from './entity-extractor.js';
export * from './handler-registry.js';
export * from './intent-classifier.js';
export * from './capture.js';
export * from './dispatch.js';
export * from './dispatcher.js';
export * from './routing-rules-port.js';
