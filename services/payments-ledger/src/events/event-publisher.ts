/**
 * Event Publisher
 * Publishes domain events to the message bus (outbox pattern)
 */
import { v4 as uuidv4 } from 'uuid';
import { TenantId } from '@borjie/domain-models';
import { DomainEvent, PaymentDomainEvent } from './payment-events';
import { logger } from '../logger.js';

/**
 * Outbox entry for transactional event publishing
 */
export interface OutboxEntry {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: string;
  tenantId: TenantId;
  createdAt: Date;
  publishedAt?: Date;
  retryCount: number;
  lastError?: string;
}

/**
 * Event handler type
 */
export type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => Promise<void>;

/**
 * Event Publisher Interface
 */
export interface IEventPublisher {
  /**
   * Publish an event (adds to outbox for reliable delivery)
   */
  publish(event: PaymentDomainEvent): Promise<void>;

  /**
   * Publish multiple events atomically
   */
  publishBatch(events: PaymentDomainEvent[]): Promise<void>;

  /**
   * Subscribe to events (for in-process handling)
   */
  subscribe<T extends PaymentDomainEvent>(
    eventType: T['eventType'],
    handler: EventHandler<T>
  ): void;

  /**
   * Unsubscribe from events
   */
  unsubscribe(eventType: string, handler: EventHandler): void;
}

/**
 * Outbox Repository Interface
 */
export interface IOutboxRepository {
  /**
   * Add events to outbox
   */
  addToOutbox(entries: OutboxEntry[]): Promise<void>;

  /**
   * Get unpublished events
   */
  getUnpublished(limit: number): Promise<OutboxEntry[]>;

  /**
   * Mark event as published
   */
  markPublished(id: string): Promise<void>;

  /**
   * Record publish failure
   */
  recordFailure(id: string, error: string): Promise<void>;

  /**
   * Delete old published events
   */
  cleanup(olderThan: Date): Promise<number>;
}

/**
 * In-memory Event Publisher for testing and local development
 */
export class InMemoryEventPublisher implements IEventPublisher {
  private handlers: Map<string, Set<EventHandler>> = new Map();
  private outbox: OutboxEntry[] = [];

  async publish(event: PaymentDomainEvent): Promise<void> {
    // Add to outbox
    const entry: OutboxEntry = {
      id: uuidv4(),
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      eventType: event.eventType,
      payload: JSON.stringify(event),
      tenantId: event.tenantId,
      createdAt: new Date(),
      retryCount: 0
    };
    this.outbox.push(entry);

    // Notify in-process handlers
    await this.notifyHandlers(event);
  }

  async publishBatch(events: PaymentDomainEvent[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  subscribe<T extends PaymentDomainEvent>(
    eventType: T['eventType'],
    handler: EventHandler<T>
  ): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler as EventHandler);
  }

  unsubscribe(eventType: string, handler: EventHandler): void {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  private async notifyHandlers(event: PaymentDomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.eventType);
    if (handlers) {
      for (const handler of handlers) {
        try {
          await handler(event);
        } catch (error) {
          logger.error(`Error in event handler for ${event.eventType}`, { error: error });
        }
      }
    }
  }

  // Test helpers
  getOutbox(): OutboxEntry[] {
    return [...this.outbox];
  }

  clearOutbox(): void {
    this.outbox = [];
  }
}

/**
 * Create a domain event helper
 */
export function createEvent<T extends PaymentDomainEvent>(
  eventType: T['eventType'],
  aggregateType: T['aggregateType'],
  aggregateId: string,
  tenantId: TenantId,
  payload: T['payload'],
  options?: {
    correlationId?: string;
    causationId?: string;
    metadata?: Record<string, unknown>;
  }
): T {
  return {
    eventId: uuidv4(),
    eventType,
    aggregateType,
    aggregateId,
    tenantId,
    timestamp: new Date(),
    version: 1,
    payload,
    correlationId: options?.correlationId,
    causationId: options?.causationId,
    metadata: options?.metadata
  } as T;
}
