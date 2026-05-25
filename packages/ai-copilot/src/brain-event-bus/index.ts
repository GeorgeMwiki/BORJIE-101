/**
 * Brain Event Bus — barrel export.
 *
 * Public surface used by:
 *   - Connectors emitting events (publish-side):
 *       `services/notifications/src/whatsapp/brain/whatsapp-brain-emitter.ts`
 *   - Consumers subscribing (subscribe-side):
 *       `services/consolidation-worker/src/consumers/whatsapp-brain.ts`
 *
 * Research report: `.audit/litfin-sota-2026-05-23/11-company-brain-primitive.md`
 * Roadmap task: Wave-2 #10 in `00-EXECUTION-ROADMAP.md`.
 */

export type {
  BrainEvent,
  BrainEventACL,
  BrainEventBus,
  BrainEventHandler,
  BrainEventPublisher,
  BrainEventSource,
  BrainEventSubscriber,
  BrainEventSubscription,
} from './types.js';

export {
  InMemoryBrainEventBus,
  createInMemoryBrainEventBus,
  type InMemoryBrainBusLogger,
  type InMemoryBrainEventBusOptions,
} from './in-memory-bus.js';
