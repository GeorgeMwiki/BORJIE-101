/**
 * Event Bus - BORJIE Platform
 * 
 * Implements publish/subscribe pattern with outbox support for reliable event delivery.
 * Supports pattern-based subscriptions and async event processing.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  DomainEvent,
  DomainEventMetadata,
  EventHandler,
  EventHandlerRegistration,
  EventHandlerOptions,
  EventEnvelope,
  EventPriority,
  OutboxStatus,
} from './types.js';

// ============================================================================
// Event Bus Configuration
// ============================================================================

export interface EventBusConfig {
  /** Service name for event metadata */
  serviceName: string;
  /** Enable outbox pattern */
  enableOutbox?: boolean;
  /** Outbox store implementation */
  outboxStore?: IOutboxStore;
  /** Default handler options */
  defaultHandlerOptions?: EventHandlerOptions;
  /** Error callback */
  onError?: (error: Error, event: DomainEvent) => void;
  /** Event published callback */
  onPublished?: (event: DomainEvent) => void;
}

// ============================================================================
// Outbox Store Interface
// ============================================================================

export interface IOutboxStore {
  /** Save event to outbox */
  save(envelope: EventEnvelope): Promise<void>;
  /** Save multiple events to outbox */
  saveBatch(envelopes: EventEnvelope[]): Promise<void>;
  /** Get pending events for processing */
  getPending(limit?: number): Promise<EventEnvelope[]>;
  /** Mark event as published */
  markPublished(id: string): Promise<void>;
  /** Mark event as failed */
  markFailed(id: string, error: string): Promise<void>;
  /** Move event to dead letter */
  moveToDeadLetter(id: string, reason: string): Promise<void>;
  /** Acquire lock on events for processing */
  acquireLock(ids: string[], lockerId: string, ttlMs: number): Promise<string[]>;
  /** Release lock on events */
  releaseLock(ids: string[], lockerId: string): Promise<void>;
}

// ============================================================================
// In-Memory Outbox Store (for development/testing)
// ============================================================================

export class MemoryOutboxStore implements IOutboxStore {
  private events = new Map<string, EventEnvelope>();
  private locks = new Map<string, { lockerId: string; expiresAt: number }>();

  async save(envelope: EventEnvelope): Promise<void> {
    this.events.set(envelope.id, envelope);
  }

  async saveBatch(envelopes: EventEnvelope[]): Promise<void> {
    for (const envelope of envelopes) {
      this.events.set(envelope.id, envelope);
    }
  }

  async getPending(limit = 100): Promise<EventEnvelope[]> {
    const now = Date.now();
    const pending: EventEnvelope[] = [];

    for (const envelope of this.events.values()) {
      if (envelope.status === 'pending' || envelope.status === 'failed') {
        const lock = this.locks.get(envelope.id);
        if (!lock || lock.expiresAt < now) {
          if (envelope.status === 'failed') {
            if (!envelope.nextRetryAt || envelope.nextRetryAt.getTime() <= now) {
              pending.push(envelope);
            }
          } else {
            pending.push(envelope);
          }
        }
      }
      if (pending.length >= limit) break;
    }

    return pending.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
  }

  async markPublished(id: string): Promise<void> {
    const envelope = this.events.get(id);
    if (envelope) {
      envelope.status = 'published';
      envelope.publishedAt = new Date();
    }
  }

  async markFailed(id: string, error: string): Promise<void> {
    const envelope = this.events.get(id);
    if (envelope) {
      envelope.status = 'failed';
      envelope.retryCount += 1;
      envelope.lastError = error;
      envelope.nextRetryAt = new Date(Date.now() + Math.pow(2, envelope.retryCount) * 1000);
    }
  }

  async moveToDeadLetter(id: string, reason: string): Promise<void> {
    const envelope = this.events.get(id);
    if (envelope) {
      envelope.status = 'dead_letter';
      envelope.lastError = reason;
    }
  }

  async acquireLock(ids: string[], lockerId: string, ttlMs: number): Promise<string[]> {
    const now = Date.now();
    const locked: string[] = [];

    for (const id of ids) {
      const existingLock = this.locks.get(id);
      if (!existingLock || existingLock.expiresAt < now) {
        this.locks.set(id, { lockerId, expiresAt: now + ttlMs });
        locked.push(id);
      }
    }

    return locked;
  }

  async releaseLock(ids: string[], lockerId: string): Promise<void> {
    for (const id of ids) {
      const lock = this.locks.get(id);
      if (lock && lock.lockerId === lockerId) {
        this.locks.delete(id);
      }
    }
  }
}

// ============================================================================
// Event Bus Implementation
// ============================================================================

export class EventBus {
  private handlers = new Map<string, EventHandlerRegistration[]>();
  private config: Required<EventBusConfig>;
  private sequenceCounters = new Map<string, number>();

  constructor(config: EventBusConfig) {
    this.config = {
      enableOutbox: false,
      outboxStore: new MemoryOutboxStore(),
      defaultHandlerOptions: {
        concurrency: 1,
        retryOnFailure: true,
        maxRetries: 3,
        retryDelayMs: 1000,
        timeoutMs: 30000,
      },
      onError: () => {},
      onPublished: () => {},
      ...config,
    };
  }

  /**
   * Publish an event to all matching subscribers
   */
  async publish<T>(event: DomainEvent<T>): Promise<void> {
    if (this.config.enableOutbox) {
      await this.publishWithOutbox(event);
    } else {
      await this.publishDirect(event);
    }
  }

  /**
   * Publish multiple events atomically (all or nothing)
   */
  async publishBatch<T>(events: DomainEvent<T>[]): Promise<void> {
    if (this.config.enableOutbox) {
      const envelopes = events.map(event => this.createEnvelope(event));
      await this.config.outboxStore.saveBatch(envelopes);
    } else {
      await Promise.all(events.map(event => this.publishDirect(event)));
    }
  }

  /**
   * Subscribe to events matching a pattern
   */
  subscribe<T>(
    pattern: string,
    handler: EventHandler<T>,
    options?: EventHandlerOptions
  ): string {
    const registration: EventHandlerRegistration<T> = {
      id: uuidv4(),
      pattern,
      handler: handler as EventHandler,
      options: { ...this.config.defaultHandlerOptions, ...options },
    };

    const existingHandlers = this.handlers.get(pattern) || [];
    existingHandlers.push(registration as EventHandlerRegistration);
    this.handlers.set(pattern, existingHandlers);

    return registration.id;
  }

  /**
   * Unsubscribe a handler
   */
  unsubscribe(handlerId: string): boolean {
    for (const [pattern, handlers] of this.handlers) {
      const index = handlers.findIndex(h => h.id === handlerId);
      if (index !== -1) {
        handlers.splice(index, 1);
        if (handlers.length === 0) {
          this.handlers.delete(pattern);
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Process pending outbox events
   */
  async processOutbox(batchSize = 100): Promise<number> {
    if (!this.config.enableOutbox) {
      throw new Error('Outbox is not enabled');
    }

    const lockerId = uuidv4();
    const pending = await this.config.outboxStore.getPending(batchSize);
    
    if (pending.length === 0) {
      return 0;
    }

    const lockedIds = await this.config.outboxStore.acquireLock(
      pending.map(e => e.id),
      lockerId,
      60000 // 1 minute lock TTL
    );

    let processed = 0;

    for (const envelope of pending.filter(e => lockedIds.includes(e.id))) {
      try {
        await this.publishDirect(envelope.event);
        await this.config.outboxStore.markPublished(envelope.id);
        processed++;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        if (envelope.retryCount >= envelope.maxRetries - 1) {
          await this.config.outboxStore.moveToDeadLetter(envelope.id, errorMessage);
        } else {
          await this.config.outboxStore.markFailed(envelope.id, errorMessage);
        }
      }
    }

    await this.config.outboxStore.releaseLock(lockedIds, lockerId);

    return processed;
  }

  /**
   * Create a domain event
   */
  createEvent<T>(
    type: string,
    aggregateType: string,
    aggregateId: string,
    payload: T,
    metadata?: Partial<DomainEventMetadata>
  ): DomainEvent<T> {
    const now = new Date();
    return {
      id: uuidv4(),
      type,
      aggregateType,
      aggregateId,
      timestamp: now,
      timestampMs: now.getTime(),
      version: 1,
      payload,
      metadata: {
        sourceService: this.config.serviceName,
        ...metadata,
      },
    };
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async publishWithOutbox<T>(event: DomainEvent<T>): Promise<void> {
    const envelope = this.createEnvelope(event);
    await this.config.outboxStore.save(envelope);
  }

  private async publishDirect<T>(event: DomainEvent<T>): Promise<void> {
    const matchingHandlers = this.getMatchingHandlers(event.type, event.aggregateType);

    const results = await Promise.allSettled(
      matchingHandlers.map(async registration => {
        if (registration.options?.filter && !registration.options.filter(event)) {
          return;
        }

        await this.executeHandler(registration, event);
      })
    );

    // Handle errors
    for (const result of results) {
      if (result.status === 'rejected') {
        this.config.onError(
          result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
          event
        );
      }
    }

    this.config.onPublished(event);
  }

  private async executeHandler<T>(
    registration: EventHandlerRegistration,
    event: DomainEvent<T>
  ): Promise<void> {
    const options = registration.options || {};
    const maxRetries = options.maxRetries || 0;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const timeoutPromise = options.timeoutMs
          ? new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Handler timeout')), options.timeoutMs)
            )
          : null;

        const handlerPromise = registration.handler(event);

        if (timeoutPromise) {
          await Promise.race([handlerPromise, timeoutPromise]);
        } else {
          await handlerPromise;
        }

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (attempt < maxRetries && options.retryOnFailure) {
          const delay = (options.retryDelayMs || 1000) * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    if (lastError) {
      throw lastError;
    }
  }

  private getMatchingHandlers(eventType: string, aggregateType: string): EventHandlerRegistration[] {
    const matching: EventHandlerRegistration[] = [];

    for (const [pattern, handlers] of this.handlers) {
      if (this.matchPattern(pattern, eventType, aggregateType)) {
        matching.push(...handlers);
      }
    }

    return matching;
  }

  private matchPattern(pattern: string, eventType: string, aggregateType: string): boolean {
    // Support patterns like:
    // - 'PaymentReceived' - exact match
    // - 'Payment*' - prefix match
    // - '*' - match all
    // - 'Payment:*' - match all Payment aggregate events
    // - '*:PaymentReceived' - match PaymentReceived from any aggregate

    if (pattern === '*') return true;

    if (pattern.includes(':')) {
      const [aggPattern, typePattern] = pattern.split(':');
      const aggMatch = (aggPattern ?? '*') === '*' || this.wildcardMatch(aggPattern ?? '', aggregateType);
      const typeMatch = (typePattern ?? '*') === '*' || this.wildcardMatch(typePattern ?? '', eventType);
      return aggMatch && typeMatch;
    }

    return this.wildcardMatch(pattern, eventType);
  }

  private wildcardMatch(pattern: string, value: string): boolean {
    if (!pattern.includes('*')) {
      return pattern === value;
    }

    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(value);
  }

  private createEnvelope<T>(event: DomainEvent<T>): EventEnvelope<T> {
    const key = `${event.aggregateType}:${event.aggregateId}`;
    const sequence = (this.sequenceCounters.get(key) || 0) + 1;
    this.sequenceCounters.set(key, sequence);

    return {
      id: uuidv4(),
      event,
      sequenceNumber: sequence,
      priority: this.determinePriority(event),
      status: 'pending',
      retryCount: 0,
      maxRetries: 5,
      createdAt: new Date(),
    };
  }

  private determinePriority<T>(event: DomainEvent<T>): EventPriority {
    // Determine priority based on event type
    const criticalTypes = ['PaymentFailed', 'SecurityBreach', 'SystemFailure'];
    const highTypes = ['PaymentReceived', 'LeaseTerminated', 'MaintenanceUrgent'];
    const lowTypes = ['MetricRecorded', 'LogEntry'];

    if (criticalTypes.some(t => event.type.includes(t))) return 'critical';
    if (highTypes.some(t => event.type.includes(t))) return 'high';
    if (lowTypes.some(t => event.type.includes(t))) return 'low';
    return 'normal';
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let defaultEventBus: EventBus | null = null;

/**
 * Get or create the default event bus instance
 */
export function getEventBus(config?: EventBusConfig): EventBus {
  if (!defaultEventBus && config) {
    defaultEventBus = new EventBus(config);
  }
  if (!defaultEventBus) {
    throw new Error('Event bus not initialized. Call getEventBus with config first.');
  }
  return defaultEventBus;
}

/**
 * Convenience function to publish an event
 */
export async function publish<T>(event: DomainEvent<T>): Promise<void> {
  return getEventBus().publish(event);
}

/**
 * Convenience function to subscribe to events
 */
export function subscribe<T>(
  pattern: string,
  handler: EventHandler<T>,
  options?: EventHandlerOptions
): string {
  return getEventBus().subscribe(pattern, handler, options);
}
