/**
 * Audit Logger
 * 
 * Central service for creating and recording audit events across the platform.
 * Provides a fluent API for building audit events with proper context propagation.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AuditEvent,
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
  AuditActor,
  AuditTarget,
  AuditTenantContext,
  AuditRequestContext,
  AuditChangeRecord,
  CreateAuditEventOptions,
} from '../types/audit.types.js';
import { AuditSeverity as AuditSeverityEnum } from '../types/audit.types.js';
import type { IAuditStore } from './audit-store.interface.js';

/** Current schema version for audit events */
const AUDIT_SCHEMA_VERSION = '1.0.0';

/**
 * Audit Logger configuration
 */
export interface AuditLoggerConfig {
  /** Audit store implementation */
  store: IAuditStore;
  /** Enable buffered writes for performance */
  buffered?: boolean;
  /** Buffer size before auto-flush */
  bufferSize?: number;
  /** Auto-flush interval (ms) */
  flushIntervalMs?: number;
  /** Fields to always redact from change records */
  sensitiveFields?: string[];
  /** Callback on audit errors */
  onError?: (error: Error, event: AuditEvent) => void;
}

const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'apiKey',
  'privateKey',
  'creditCard',
  'cardNumber',
  'cvv',
  'ssn',
  'socialSecurityNumber',
  'bankAccount',
  'routingNumber',
];

/**
 * Builder for creating audit events with a fluent API
 */
export class AuditEventBuilder {
  private options: Partial<CreateAuditEventOptions> = {};

  constructor(
    private readonly logger: AuditLogger,
    category: AuditCategory,
    action: string
  ) {
    this.options.category = category;
    this.options.action = action;
    this.options.severity = AuditSeverityEnum.INFO;
  }

  /** Set event description */
  describe(description: string): this {
    this.options.description = description;
    return this;
  }

  /** Set event outcome */
  outcome(outcome: AuditOutcome): this {
    this.options.outcome = outcome;
    return this;
  }

  /** Mark as successful */
  success(): this {
    this.options.outcome = 'SUCCESS';
    return this;
  }

  /** Mark as failed */
  failure(reason?: string): this {
    this.options.outcome = 'FAILURE';
    if (reason) {
      this.options.reason = reason;
    }
    return this;
  }

  /** Mark as denied */
  denied(reason?: string): this {
    this.options.outcome = 'DENIED';
    this.options.severity = AuditSeverityEnum.WARNING;
    if (reason) {
      this.options.reason = reason;
    }
    return this;
  }

  /** Mark as error */
  error(reason?: string): this {
    this.options.outcome = 'ERROR';
    this.options.severity = AuditSeverityEnum.WARNING;
    if (reason) {
      this.options.reason = reason;
    }
    return this;
  }

  /** Set severity level */
  severity(severity: AuditSeverity): this {
    this.options.severity = severity;
    return this;
  }

  /** Mark as critical */
  critical(): this {
    this.options.severity = AuditSeverityEnum.CRITICAL;
    return this;
  }

  /** Set the actor */
  actor(actor: AuditActor): this {
    this.options.actor = actor;
    return this;
  }

  /** Set actor as a user */
  byUser(id: string, name?: string, email?: string, roles?: string[]): this {
    this.options.actor = { type: 'user', id, name, email, roles };
    return this;
  }

  /** Set actor as a service */
  byService(name: string, id?: string): this {
    this.options.actor = { type: 'service', id: id ?? name, name };
    return this;
  }

  /** Set actor as the system */
  bySystem(reason?: string): this {
    this.options.actor = { type: 'system', id: 'system', name: 'System' };
    if (reason) {
      this.options.reason = reason;
    }
    return this;
  }

  /** Add actor IP address */
  fromIP(ipAddress: string): this {
    if (this.options.actor) {
      this.options.actor.ipAddress = ipAddress;
    }
    return this;
  }

  /** Add actor user agent */
  withUserAgent(userAgent: string): this {
    if (this.options.actor) {
      this.options.actor.userAgent = userAgent;
    }
    return this;
  }

  /** Add a target resource */
  target(target: AuditTarget): this {
    this.options.targets = this.options.targets ?? [];
    this.options.targets.push(target);
    return this;
  }

  /** Add a target by type and ID */
  on(type: string, id: string, name?: string): this {
    return this.target({ type, id, name });
  }

  /** Set tenant context */
  tenant(context: AuditTenantContext): this {
    this.options.tenant = context;
    return this;
  }

  /** Set tenant by ID */
  inTenant(tenantId: string, tenantName?: string): this {
    this.options.tenant = { tenantId, tenantName };
    return this;
  }

  /** Set request context */
  request(context: AuditRequestContext): this {
    this.options.request = context;
    return this;
  }

  /** Set trace context */
  withTrace(traceId: string, spanId?: string): this {
    this.options.request = {
      ...this.options.request,
      traceId,
      spanId,
    };
    return this;
  }

  /** Set request ID */
  withRequestId(requestId: string): this {
    this.options.request = {
      ...this.options.request,
      requestId,
    };
    return this;
  }

  /** Add change records */
  changes(changes: AuditChangeRecord[]): this {
    this.options.changes = changes;
    return this;
  }

  /** Add a single change record */
  changed(field: string, previousValue?: unknown, newValue?: unknown): this {
    this.options.changes = this.options.changes ?? [];
    this.options.changes.push({ field, previousValue, newValue });
    return this;
  }

  /** Set reason */
  because(reason: string): this {
    this.options.reason = reason;
    return this;
  }

  /** Add metadata */
  metadata(metadata: Record<string, unknown>): this {
    this.options.metadata = { ...this.options.metadata, ...metadata };
    return this;
  }

  /** Record the audit event */
  async record(): Promise<AuditEvent> {
    if (!this.options.category || !this.options.action) {
      throw new Error('Audit event requires category and action');
    }
    if (!this.options.description) {
      throw new Error('Audit event requires description');
    }
    if (!this.options.outcome) {
      throw new Error('Audit event requires outcome');
    }
    if (!this.options.actor) {
      throw new Error('Audit event requires actor');
    }

    return this.logger.record(this.options as CreateAuditEventOptions);
  }
}

/**
 * Audit Logger service
 */
export class AuditLogger {
  private buffer: AuditEvent[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly sensitiveFields: Set<string>;
  private readonly config: Required<
    Pick<AuditLoggerConfig, 'buffered' | 'bufferSize' | 'flushIntervalMs'>
  > &
    AuditLoggerConfig;

  constructor(config: AuditLoggerConfig) {
    this.config = {
      buffered: false,
      bufferSize: 50,
      flushIntervalMs: 5000,
      ...config,
    };
    this.sensitiveFields = new Set([
      ...DEFAULT_SENSITIVE_FIELDS,
      ...(config.sensitiveFields ?? []),
    ]);

    if (this.config.buffered) {
      this.startFlushTimer();
    }
  }

  /**
   * Create an audit event builder
   */
  event(category: AuditCategory, action: string): AuditEventBuilder {
    return new AuditEventBuilder(this, category, action);
  }

  /**
   * Record an audit event directly
   */
  async record(options: CreateAuditEventOptions): Promise<AuditEvent> {
    const now = new Date();
    const event: AuditEvent = {
      id: uuidv4(),
      timestamp: now.toISOString(),
      timestampMs: now.getTime(),
      category: options.category,
      action: options.action,
      description: options.description,
      outcome: options.outcome,
      severity: options.severity ?? AuditSeverityEnum.INFO,
      actor: options.actor,
      targets: options.targets,
      tenant: options.tenant,
      request: options.request,
      changes: this.redactChanges(options.changes),
      reason: options.reason,
      metadata: options.metadata,
      schemaVersion: AUDIT_SCHEMA_VERSION,
    };

    if (this.config.buffered) {
      this.buffer.push(event);
      if (this.buffer.length >= this.config.bufferSize) {
        await this.flush();
      }
    } else {
      await this.storeEvent(event);
    }

    return event;
  }

  /**
   * Flush buffered events to store
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const events = [...this.buffer];
    this.buffer = [];

    try {
      await this.config.store.storeBatch(events);
    } catch (error) {
      // Re-add events to buffer on failure
      this.buffer = [...events, ...this.buffer];
      if (this.config.onError && error instanceof Error) {
        for (const event of events) {
          this.config.onError(error, event);
        }
      }
      throw error;
    }
  }

  /**
   * Close the audit logger
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    await this.config.store.close();
  }

  private async storeEvent(event: AuditEvent): Promise<void> {
    try {
      await this.config.store.store(event);
    } catch (error) {
      if (this.config.onError && error instanceof Error) {
        this.config.onError(error, event);
      }
      throw error;
    }
  }

  private redactChanges(
    changes?: AuditChangeRecord[]
  ): AuditChangeRecord[] | undefined {
    if (!changes) {
      return undefined;
    }

    return changes.map(change => {
      if (this.sensitiveFields.has(change.field.toLowerCase())) {
        return {
          field: change.field,
          previousValue: '[REDACTED]',
          newValue: '[REDACTED]',
          redacted: true,
        };
      }
      return change;
    });
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Error handling is done in flush()
      });
    }, this.config.flushIntervalMs);
    this.flushTimer.unref(); // Don't keep process alive
  }
}
