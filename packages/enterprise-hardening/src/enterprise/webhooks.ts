/**
 * Webhook System
 * 
 * Implements enterprise-grade webhook delivery with:
 * - Reliable delivery with retries and backoff
 * - Signature verification for security
 * - Event filtering and transformation
 * - Delivery tracking and monitoring
 */

import { z } from 'zod';

/**
 * Webhook Event Categories
 */
export const WebhookEventCategory = {
  TENANT: 'tenant',
  USER: 'user',
  PROPERTY: 'property',
  LEASE: 'lease',
  PAYMENT: 'payment',
  MAINTENANCE: 'maintenance',
  DOCUMENT: 'document',
  NOTIFICATION: 'notification',
} as const;

export type WebhookEventCategory = typeof WebhookEventCategory[keyof typeof WebhookEventCategory];

/**
 * Webhook Delivery Status
 */
export const DeliveryStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
  RETRYING: 'RETRYING',
  EXHAUSTED: 'EXHAUSTED',
} as const;

export type DeliveryStatus = typeof DeliveryStatus[keyof typeof DeliveryStatus];

/**
 * Webhook Endpoint Configuration
 */
export interface WebhookEndpoint {
  readonly id: string;
  readonly tenantId: string;
  readonly url: string;
  readonly secret: string;
  readonly description?: string;
  readonly events: readonly string[];     // Event types to subscribe to
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Webhook Event
 */
export interface WebhookEvent {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;                  // e.g., 'payment.completed', 'lease.created'
  readonly category: WebhookEventCategory;
  readonly timestamp: string;
  readonly data: Record<string, unknown>;
  readonly metadata?: {
    readonly correlationId?: string;
    readonly sourceService?: string;
    readonly version?: string;
  };
}

/**
 * Webhook Delivery Attempt
 */
export interface DeliveryAttempt {
  readonly attemptNumber: number;
  readonly timestamp: string;
  readonly statusCode?: number;
  readonly responseBody?: string;
  readonly errorMessage?: string;
  readonly latencyMs: number;
}

/**
 * Webhook Delivery Record
 */
export interface WebhookDelivery {
  readonly id: string;
  readonly endpointId: string;
  readonly eventId: string;
  readonly event: WebhookEvent;
  readonly status: DeliveryStatus;
  readonly attempts: readonly DeliveryAttempt[];
  readonly nextRetryAt?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
}

/**
 * Webhook Statistics
 */
export interface WebhookStats {
  readonly endpointId: string;
  readonly totalDeliveries: number;
  readonly successfulDeliveries: number;
  readonly failedDeliveries: number;
  readonly avgLatencyMs: number;
  readonly successRate: number;
  readonly lastDeliveryAt?: string;
  readonly lastSuccessAt?: string;
  readonly lastFailureAt?: string;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 3600000, // 1 hour
  backoffMultiplier: 2,
};

/**
 * Webhook Manager
 */
export class WebhookManager {
  private endpoints: Map<string, WebhookEndpoint> = new Map();
  private deliveries: Map<string, WebhookDelivery> = new Map();
  private pendingDeliveries: WebhookDelivery[] = [];

  constructor(private readonly retryConfig: RetryConfig = DEFAULT_RETRY_CONFIG) {}

  /**
   * Register a webhook endpoint
   */
  registerEndpoint(endpoint: WebhookEndpoint): void {
    this.endpoints.set(endpoint.id, endpoint);
  }

  /**
   * Update endpoint configuration
   */
  updateEndpoint(endpointId: string, updates: Partial<Omit<WebhookEndpoint, 'id' | 'tenantId' | 'createdAt'>>): WebhookEndpoint | null {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) return null;

    const updated: WebhookEndpoint = {
      ...endpoint,
      ...updates,
      updatedAt: new Date().toISOString(),
    };
    this.endpoints.set(endpointId, updated);
    return updated;
  }

  /**
   * Delete an endpoint
   */
  deleteEndpoint(endpointId: string): boolean {
    return this.endpoints.delete(endpointId);
  }

  /**
   * Get endpoints for a tenant
   */
  getEndpointsForTenant(tenantId: string): WebhookEndpoint[] {
    return Array.from(this.endpoints.values()).filter(e => e.tenantId === tenantId);
  }

  /**
   * Emit an event to all subscribed endpoints
   */
  async emit(event: WebhookEvent): Promise<string[]> {
    const deliveryIds: string[] = [];

    // Find all endpoints subscribed to this event
    const matchingEndpoints = Array.from(this.endpoints.values()).filter(
      e => e.tenantId === event.tenantId &&
           e.enabled &&
           this.matchesEventFilter(event.type, e.events)
    );

    for (const endpoint of matchingEndpoints) {
      const delivery = this.createDelivery(endpoint, event);
      deliveryIds.push(delivery.id);
      this.pendingDeliveries.push(delivery);
    }

    return deliveryIds;
  }

  /**
   * Check if event type matches endpoint filter
   */
  private matchesEventFilter(eventType: string, filters: readonly string[]): boolean {
    return filters.some(filter => {
      if (filter === '*') return true;
      if (filter.endsWith('.*')) {
        const prefix = filter.slice(0, -2);
        return eventType.startsWith(prefix + '.');
      }
      return filter === eventType;
    });
  }

  /**
   * Create a delivery record
   */
  private createDelivery(endpoint: WebhookEndpoint, event: WebhookEvent): WebhookDelivery {
    const delivery: WebhookDelivery = {
      id: crypto.randomUUID(),
      endpointId: endpoint.id,
      eventId: event.id,
      event,
      status: DeliveryStatus.PENDING,
      attempts: [],
      createdAt: new Date().toISOString(),
    };
    this.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  /**
   * Process pending deliveries
   */
  async processPendingDeliveries(): Promise<{ processed: number; successful: number; failed: number }> {
    const toProcess = [...this.pendingDeliveries];
    this.pendingDeliveries = [];

    let successful = 0;
    let failed = 0;

    for (const delivery of toProcess) {
      const result = await this.attemptDelivery(delivery);
      if (result.status === DeliveryStatus.DELIVERED) {
        successful++;
      } else if (result.status === DeliveryStatus.EXHAUSTED) {
        failed++;
      } else if (result.status === DeliveryStatus.RETRYING) {
        // Schedule for retry
        if (result.nextRetryAt) {
          this.pendingDeliveries.push(result);
        }
      }
    }

    return { processed: toProcess.length, successful, failed };
  }

  /**
   * Attempt to deliver a webhook
   */
  async attemptDelivery(delivery: WebhookDelivery): Promise<WebhookDelivery> {
    const endpoint = this.endpoints.get(delivery.endpointId);
    if (!endpoint) {
      return this.updateDeliveryStatus(delivery, DeliveryStatus.FAILED, {
        errorMessage: 'Endpoint not found',
        latencyMs: 0,
      });
    }

    const attemptNumber = delivery.attempts.length + 1;
    const startTime = Date.now();

    try {
      const payload = this.buildPayload(delivery.event);
      const signature = await this.signPayload(payload, endpoint.secret);

      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Id': delivery.id,
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': new Date().toISOString(),
        },
        body: payload,
        signal: AbortSignal.timeout(30000), // 30 second timeout
      });

      const latencyMs = Date.now() - startTime;
      const responseBody = await response.text().catch(() => '');

      if (response.ok) {
        return this.updateDeliveryStatus(delivery, DeliveryStatus.DELIVERED, {
          attemptNumber,
          statusCode: response.status,
          responseBody: responseBody.slice(0, 1000),
          latencyMs,
        });
      }

      // Check if we should retry
      if (attemptNumber < this.retryConfig.maxAttempts && this.isRetryableStatus(response.status)) {
        return this.scheduleRetry(delivery, {
          attemptNumber,
          statusCode: response.status,
          responseBody: responseBody.slice(0, 1000),
          latencyMs,
        });
      }

      return this.updateDeliveryStatus(delivery, DeliveryStatus.EXHAUSTED, {
        attemptNumber,
        statusCode: response.status,
        responseBody: responseBody.slice(0, 1000),
        latencyMs,
      });
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      if (attemptNumber < this.retryConfig.maxAttempts) {
        return this.scheduleRetry(delivery, {
          attemptNumber,
          errorMessage,
          latencyMs,
        });
      }

      return this.updateDeliveryStatus(delivery, DeliveryStatus.EXHAUSTED, {
        attemptNumber,
        errorMessage,
        latencyMs,
      });
    }
  }

  /**
   * Build webhook payload
   */
  private buildPayload(event: WebhookEvent): string {
    return JSON.stringify({
      id: event.id,
      type: event.type,
      timestamp: event.timestamp,
      data: event.data,
      metadata: event.metadata,
    });
  }

  /**
   * Sign payload with HMAC-SHA256
   */
  private async signPayload(payload: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const payloadData = encoder.encode(payload);
    
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    const signature = await crypto.subtle.sign('HMAC', key, payloadData);
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  /**
   * Verify webhook signature
   */
  async verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
    const expectedSignature = await this.signPayload(payload, secret);
    return signature === expectedSignature;
  }

  /**
   * Check if status code is retryable
   */
  private isRetryableStatus(status: number): boolean {
    return status >= 500 || status === 429 || status === 408;
  }

  /**
   * Schedule a retry
   */
  private scheduleRetry(
    delivery: WebhookDelivery,
    attempt: Omit<DeliveryAttempt, 'timestamp'>
  ): WebhookDelivery {
    const attemptNumber = attempt.attemptNumber;
    const delay = Math.min(
      this.retryConfig.initialDelayMs * Math.pow(this.retryConfig.backoffMultiplier, attemptNumber - 1),
      this.retryConfig.maxDelayMs
    );
    const nextRetryAt = new Date(Date.now() + delay).toISOString();

    const updated: WebhookDelivery = {
      ...delivery,
      status: DeliveryStatus.RETRYING,
      attempts: [...delivery.attempts, { ...attempt, timestamp: new Date().toISOString() }],
      nextRetryAt,
    };
    this.deliveries.set(delivery.id, updated);
    return updated;
  }

  /**
   * Update delivery status
   */
  private updateDeliveryStatus(
    delivery: WebhookDelivery,
    status: DeliveryStatus,
    attempt: Omit<DeliveryAttempt, 'timestamp' | 'attemptNumber'> & { attemptNumber?: number }
  ): WebhookDelivery {
    const updated: WebhookDelivery = {
      ...delivery,
      status,
      attempts: [...delivery.attempts, { 
        attemptNumber: attempt.attemptNumber ?? delivery.attempts.length + 1,
        timestamp: new Date().toISOString(),
        statusCode: attempt.statusCode,
        responseBody: attempt.responseBody,
        errorMessage: attempt.errorMessage,
        latencyMs: attempt.latencyMs,
      }],
      completedAt: (
        [DeliveryStatus.DELIVERED, DeliveryStatus.EXHAUSTED] as DeliveryStatus[]
      ).includes(status)
        ? new Date().toISOString()
        : undefined,
    };
    this.deliveries.set(delivery.id, updated);
    return updated;
  }

  /**
   * Get delivery by ID
   */
  getDelivery(deliveryId: string): WebhookDelivery | null {
    return this.deliveries.get(deliveryId) ?? null;
  }

  /**
   * Get deliveries for an endpoint
   */
  getDeliveriesForEndpoint(endpointId: string, limit: number = 100): WebhookDelivery[] {
    return Array.from(this.deliveries.values())
      .filter(d => d.endpointId === endpointId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  /**
   * Get endpoint statistics
   */
  getEndpointStats(endpointId: string): WebhookStats {
    const deliveries = Array.from(this.deliveries.values())
      .filter(d => d.endpointId === endpointId);

    const successful = deliveries.filter(d => d.status === DeliveryStatus.DELIVERED);
    const failed = deliveries.filter(d => d.status === DeliveryStatus.EXHAUSTED || d.status === DeliveryStatus.FAILED);

    const latencies = deliveries
      .flatMap(d => d.attempts)
      .map(a => a.latencyMs)
      .filter(l => l > 0);

    const avgLatency = latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;

    const sortedByTime = [...deliveries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const lastSuccess = successful.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];
    const lastFailure = failed.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))[0];

    return {
      endpointId,
      totalDeliveries: deliveries.length,
      successfulDeliveries: successful.length,
      failedDeliveries: failed.length,
      avgLatencyMs: avgLatency,
      successRate: deliveries.length > 0 ? Math.round((successful.length / deliveries.length) * 100) / 100 : 0,
      lastDeliveryAt: sortedByTime[0]?.createdAt,
      lastSuccessAt: lastSuccess?.completedAt,
      lastFailureAt: lastFailure?.completedAt,
    };
  }
}

/**
 * Zod schemas for API validation
 */
export const WebhookEndpointSchema = z.object({
  url: z.string().url(),
  description: z.string().max(500).optional(),
  events: z.array(z.string()).min(1),
  enabled: z.boolean().default(true),
  metadata: z.record(z.unknown()).optional(),
});

export const WebhookEventSchema = z.object({
  type: z.string().regex(/^[a-z]+\.[a-z_]+$/),
  data: z.record(z.unknown()),
  metadata: z.object({
    correlationId: z.string().optional(),
    sourceService: z.string().optional(),
    version: z.string().optional(),
  }).optional(),
});

/**
 * Standard webhook event types
 */
export const WebhookEventTypes = {
  // Tenant events
  TENANT_CREATED: 'tenant.created',
  TENANT_UPDATED: 'tenant.updated',
  TENANT_SUSPENDED: 'tenant.suspended',

  // User events
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',

  // Property events
  PROPERTY_CREATED: 'property.created',
  PROPERTY_UPDATED: 'property.updated',
  UNIT_AVAILABLE: 'property.unit_available',
  UNIT_OCCUPIED: 'property.unit_occupied',

  // Lease events
  LEASE_CREATED: 'lease.created',
  LEASE_SIGNED: 'lease.signed',
  LEASE_RENEWED: 'lease.renewed',
  LEASE_TERMINATED: 'lease.terminated',
  LEASE_EXPIRING: 'lease.expiring',

  // Payment events
  PAYMENT_RECEIVED: 'payment.received',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',
  INVOICE_CREATED: 'payment.invoice_created',
  INVOICE_OVERDUE: 'payment.invoice_overdue',

  // Maintenance events
  WORK_ORDER_CREATED: 'maintenance.work_order_created',
  WORK_ORDER_ASSIGNED: 'maintenance.work_order_assigned',
  WORK_ORDER_COMPLETED: 'maintenance.work_order_completed',
  INSPECTION_SCHEDULED: 'maintenance.inspection_scheduled',
  INSPECTION_COMPLETED: 'maintenance.inspection_completed',

  // Document events
  DOCUMENT_UPLOADED: 'document.uploaded',
  DOCUMENT_SIGNED: 'document.signed',
  DOCUMENT_EXPIRED: 'document.expired',
} as const;
