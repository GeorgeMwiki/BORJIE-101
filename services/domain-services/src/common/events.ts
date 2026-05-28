import pino from 'pino';
import { randomHex } from './id-generator.js';

/**
 * Domain Events
 *
 * Event definitions for domain-driven design patterns.
 * Events are published when significant domain actions occur.
 */

import type {
  TenantId,
  OrganizationId,
  UserId,
  RoleId,
  SessionId,
  ISOTimestamp,
} from '@borjie/domain-models';

const logger = pino({ name: 'domain-events' });

/** Base domain event */
export interface DomainEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: ISOTimestamp;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Record<string, unknown>;
}

/** Event envelope with payload */
export interface EventEnvelope<T extends DomainEvent = DomainEvent> {
  readonly event: T;
  readonly version: number;
  readonly aggregateId: string;
  readonly aggregateType: string;
}

// ==================== Tenant Events ====================

export interface TenantCreatedEvent extends DomainEvent {
  readonly eventType: 'TenantCreated';
  readonly payload: {
    readonly slug: string;
    readonly name: string;
    readonly subscriptionTier: string;
    readonly rootOrganizationId: OrganizationId;
  };
}

export interface TenantUpdatedEvent extends DomainEvent {
  readonly eventType: 'TenantUpdated';
  readonly payload: {
    readonly changes: Record<string, { old: unknown; new: unknown }>;
  };
}

export interface TenantSuspendedEvent extends DomainEvent {
  readonly eventType: 'TenantSuspended';
  readonly payload: {
    readonly reason: string;
    readonly suspendedBy: UserId;
  };
}

export interface TenantActivatedEvent extends DomainEvent {
  readonly eventType: 'TenantActivated';
  readonly payload: {
    readonly activatedBy: UserId;
  };
}

// ==================== Organization Events ====================

export interface OrganizationCreatedEvent extends DomainEvent {
  readonly eventType: 'OrganizationCreated';
  readonly payload: {
    readonly organizationId: OrganizationId;
    readonly name: string;
    readonly code: string;
    readonly type: string;
    readonly parentId: OrganizationId | null;
  };
}

export interface OrganizationUpdatedEvent extends DomainEvent {
  readonly eventType: 'OrganizationUpdated';
  readonly payload: {
    readonly organizationId: OrganizationId;
    readonly changes: Record<string, { old: unknown; new: unknown }>;
  };
}

// ==================== User Events ====================

export interface UserCreatedEvent extends DomainEvent {
  readonly eventType: 'UserCreated';
  readonly payload: {
    readonly userId: UserId;
    readonly email: string;
    readonly userType: string;
    readonly primaryOrganizationId: OrganizationId;
  };
}

export interface UserInvitedEvent extends DomainEvent {
  readonly eventType: 'UserInvited';
  readonly payload: {
    readonly userId: UserId;
    readonly email: string;
    readonly invitedBy: UserId;
    readonly expiresAt: ISOTimestamp;
  };
}

export interface UserActivatedEvent extends DomainEvent {
  readonly eventType: 'UserActivated';
  readonly payload: {
    readonly userId: UserId;
  };
}

export interface UserSuspendedEvent extends DomainEvent {
  readonly eventType: 'UserSuspended';
  readonly payload: {
    readonly userId: UserId;
    readonly reason: string;
    readonly suspendedBy: UserId;
  };
}

export interface UserLockedEvent extends DomainEvent {
  readonly eventType: 'UserLocked';
  readonly payload: {
    readonly userId: UserId;
    readonly reason: string;
    readonly lockedUntil: ISOTimestamp;
  };
}

export interface UserRoleAssignedEvent extends DomainEvent {
  readonly eventType: 'UserRoleAssigned';
  readonly payload: {
    readonly userId: UserId;
    readonly roleId: RoleId;
    readonly organizationId: OrganizationId;
    readonly assignedBy: UserId;
  };
}

export interface UserRoleRemovedEvent extends DomainEvent {
  readonly eventType: 'UserRoleRemoved';
  readonly payload: {
    readonly userId: UserId;
    readonly roleId: RoleId;
    readonly organizationId: OrganizationId;
    readonly removedBy: UserId;
  };
}

// ==================== Session Events ====================

export interface SessionCreatedEvent extends DomainEvent {
  readonly eventType: 'SessionCreated';
  readonly payload: {
    readonly sessionId: SessionId;
    readonly userId: UserId;
    readonly authMethod: string;
    readonly ipAddress: string;
  };
}

export interface SessionRevokedEvent extends DomainEvent {
  readonly eventType: 'SessionRevoked';
  readonly payload: {
    readonly sessionId: SessionId;
    readonly userId: UserId;
    readonly reason: string;
    readonly revokedBy: UserId;
  };
}

// ==================== Role Events ====================

export interface RoleCreatedEvent extends DomainEvent {
  readonly eventType: 'RoleCreated';
  readonly payload: {
    readonly roleId: RoleId;
    readonly name: string;
    readonly permissions: readonly string[];
  };
}

export interface RoleUpdatedEvent extends DomainEvent {
  readonly eventType: 'RoleUpdated';
  readonly payload: {
    readonly roleId: RoleId;
    readonly changes: Record<string, { old: unknown; new: unknown }>;
  };
}

// ==================== Event Bus ====================

/** Event handler function */
export type EventHandler<T extends DomainEvent = DomainEvent> = (
  envelope: EventEnvelope<T>
) => Promise<void>;

/** Event bus interface */
export interface EventBus {
  publish<T extends DomainEvent>(envelope: EventEnvelope<T>): Promise<void>;
  subscribe<T extends DomainEvent>(eventType: string, handler: EventHandler<T>): () => void;
}

/**
 * Wildcard event-type. Subscribers registered on `*` receive every
 * published envelope regardless of its concrete `eventType`. Used by
 * the composition root to bridge the domain bus onto the observability
 * bus so api-gateway subscribers (registered on the observability side)
 * actually see domain events.
 */
export const ALL_EVENTS: '*' = '*';

/**
 * External forwarder used to bridge domain events to a platform-level
 * bus (e.g. the observability `EventBus` the api-gateway subscribers
 * attach to). Returning a promise is honoured so the publisher waits
 * for the bridge to acknowledge before returning.
 */
export type EventForwarder = (envelope: EventEnvelope) => Promise<void> | void;

/** In-memory event bus implementation */
export class InMemoryEventBus implements EventBus {
  private handlers = new Map<string, Set<EventHandler>>();
  private eventLog: EventEnvelope[] = [];
  private forwarders: EventForwarder[] = [];

  async publish<T extends DomainEvent>(envelope: EventEnvelope<T>): Promise<void> {
    this.eventLog.push(envelope);

    const eventType = envelope.event.eventType;
    const directHandlers = this.handlers.get(eventType);
    const wildcardHandlers = this.handlers.get(ALL_EVENTS);

    // Run both exact-match and wildcard handlers. Each handler is isolated
    // so a throwing subscriber cannot block the others (at-least-once
    // delivery semantics — callers must be idempotent).
    const runHandler = async (handler: EventHandler): Promise<void> => {
      try {
        await handler(envelope);
      } catch (error) {
        // Swallow — domain events must never tear down the publishing
        // transaction. A DLQ / outbox retry is the caller's concern.
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, eventType }, `Event handler error: ${message}`);
      }
    };

    if (directHandlers) {
      for (const handler of directHandlers) {
        await runHandler(handler);
      }
    }
    if (wildcardHandlers) {
      for (const handler of wildcardHandlers) {
        await runHandler(handler);
      }
    }

    // Forward to every registered external bus (e.g. observability bus
    // backing the api-gateway subscribers). Forwarder failures are
    // absorbed per-forwarder so a flaky bridge cannot crash the
    // publisher's transaction.
    for (const forwarder of this.forwarders) {
      try {
        await forwarder(envelope);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error({ err: error, eventType }, `Event forwarder failed: ${message}`);
      }
    }
  }

  /**
   * Register an external forwarder. Called once at composition time to
   * bridge this in-process bus onto a platform bus (e.g. the
   * observability `EventBus` whose outbox drives the webhook workers).
   * Returns an unsubscribe function.
   */
  addForwarder(forwarder: EventForwarder): () => void {
    this.forwarders.push(forwarder);
    return () => {
      const idx = this.forwarders.indexOf(forwarder);
      if (idx >= 0) {
        this.forwarders = [
          ...this.forwarders.slice(0, idx),
          ...this.forwarders.slice(idx + 1),
        ];
      }
    };
  }

  subscribe<T extends DomainEvent>(eventType: string, handler: EventHandler<T>): () => void {
    let handlerSet = this.handlers.get(eventType);
    if (!handlerSet) {
      handlerSet = new Set();
      this.handlers.set(eventType, handlerSet);
    }
    handlerSet.add(handler as EventHandler);

    return () => {
      handlerSet?.delete(handler as EventHandler);
    };
  }

  getEventLog(): readonly EventEnvelope[] {
    return this.eventLog;
  }

  clear(): void {
    this.eventLog = [];
  }
}

/** Create event envelope helper */
export function createEventEnvelope<T extends DomainEvent>(
  event: T,
  aggregateId: string,
  aggregateType: string,
  version = 1
): EventEnvelope<T> {
  return {
    event,
    version,
    aggregateId,
    aggregateType,
  };
}

/** Generate event ID */
export function generateEventId(): string {
  return `evt_${Date.now()}_${randomHex(4)}`;
}
