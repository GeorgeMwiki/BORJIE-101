/**
 * Audit Logger Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AuditLogger } from './audit-logger.js';
import { MemoryAuditStore } from './memory-audit-store.js';
import { AuditCategory, AuditOutcome, AuditSeverity } from '../types/audit.types.js';

describe('AuditLogger', () => {
  let store: MemoryAuditStore;
  let logger: AuditLogger;

  beforeEach(() => {
    store = new MemoryAuditStore();
    logger = new AuditLogger({ store });
  });

  afterEach(async () => {
    await logger.close();
  });

  describe('event creation', () => {
    it('should create an audit event with required fields', async () => {
      const event = await logger
        .event(AuditCategory.AUTH, 'LOGIN')
        .describe('User logged in successfully')
        .success()
        .byUser('user-123', 'John Doe', 'john@example.com')
        .record();

      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.timestampMs).toBeGreaterThan(0);
      expect(event.category).toBe(AuditCategory.AUTH);
      expect(event.action).toBe('LOGIN');
      expect(event.description).toBe('User logged in successfully');
      expect(event.outcome).toBe(AuditOutcome.SUCCESS);
      expect(event.severity).toBe(AuditSeverity.INFO);
      expect(event.actor).toEqual({
        type: 'user',
        id: 'user-123',
        name: 'John Doe',
        email: 'john@example.com',
      });
      expect(event.schemaVersion).toBe('1.0.0');
    });

    it('should store the event in the audit store', async () => {
      await logger
        .event(AuditCategory.USER, 'CREATE')
        .describe('New user created')
        .success()
        .byService('user-service')
        .on('User', 'user-456')
        .record();

      expect(store.getCount()).toBe(1);
      const result = await store.query({});
      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.action).toBe('CREATE');
    });
  });

  describe('outcome methods', () => {
    it('should set failure outcome with reason', async () => {
      const event = await logger
        .event(AuditCategory.AUTH, 'LOGIN')
        .describe('Login attempt failed')
        .failure('Invalid credentials')
        .byUser('user-123')
        .record();

      expect(event.outcome).toBe(AuditOutcome.FAILURE);
      expect(event.reason).toBe('Invalid credentials');
    });

    it('should set denied outcome with warning severity', async () => {
      const event = await logger
        .event(AuditCategory.AUTHZ, 'ACCESS')
        .describe('Access denied to resource')
        .denied('Insufficient permissions')
        .byUser('user-123')
        .on('Property', 'prop-789')
        .record();

      expect(event.outcome).toBe(AuditOutcome.DENIED);
      expect(event.severity).toBe(AuditSeverity.WARNING);
      expect(event.reason).toBe('Insufficient permissions');
    });

    it('should set error outcome', async () => {
      const event = await logger
        .event(AuditCategory.SYSTEM, 'PROCESS')
        .describe('Background job failed')
        .error('Database connection timeout')
        .bySystem()
        .record();

      expect(event.outcome).toBe(AuditOutcome.ERROR);
      expect(event.reason).toBe('Database connection timeout');
    });
  });

  describe('actor types', () => {
    it('should set service actor', async () => {
      const event = await logger
        .event(AuditCategory.PAYMENT, 'PROCESS')
        .describe('Payment processed')
        .success()
        .byService('payments-service', 'svc-001')
        .record();

      expect(event.actor.type).toBe('service');
      expect(event.actor.name).toBe('payments-service');
      expect(event.actor.id).toBe('svc-001');
    });

    it('should set system actor', async () => {
      const event = await logger
        .event(AuditCategory.SYSTEM, 'CLEANUP')
        .describe('Old records purged')
        .success()
        .bySystem('Scheduled maintenance')
        .record();

      expect(event.actor.type).toBe('system');
      expect(event.actor.id).toBe('system');
      expect(event.reason).toBe('Scheduled maintenance');
    });

    it('should add IP address and user agent', async () => {
      const event = await logger
        .event(AuditCategory.AUTH, 'LOGIN')
        .describe('User logged in')
        .success()
        .byUser('user-123')
        .fromIP('192.168.1.100')
        .withUserAgent('Mozilla/5.0...')
        .record();

      expect(event.actor.ipAddress).toBe('192.168.1.100');
      expect(event.actor.userAgent).toBe('Mozilla/5.0...');
    });
  });

  describe('target resources', () => {
    it('should add multiple targets', async () => {
      const event = await logger
        .event(AuditCategory.LEASE, 'SIGN')
        .describe('Lease agreement signed')
        .success()
        .byUser('user-123')
        .on('Lease', 'lease-001', 'Apartment 4B Lease')
        .on('Property', 'prop-001')
        .on('Unit', 'unit-4b')
        .record();

      expect(event.targets).toHaveLength(3);
      expect(event.targets?.[0]).toEqual({
        type: 'Lease',
        id: 'lease-001',
        name: 'Apartment 4B Lease',
      });
    });
  });

  describe('tenant context', () => {
    it('should set tenant context', async () => {
      const event = await logger
        .event(AuditCategory.PROPERTY, 'CREATE')
        .describe('Property added to portfolio')
        .success()
        .byUser('user-123')
        .inTenant('tenant-abc', 'Acme Properties')
        .on('Property', 'prop-new')
        .record();

      expect(event.tenant).toEqual({
        tenantId: 'tenant-abc',
        tenantName: 'Acme Properties',
      });
    });
  });

  describe('request context', () => {
    it('should set trace context', async () => {
      const event = await logger
        .event(AuditCategory.USER, 'UPDATE')
        .describe('User profile updated')
        .success()
        .byUser('user-123')
        .withTrace('trace-abc-123', 'span-def-456')
        .withRequestId('req-xyz')
        .record();

      expect(event.request?.traceId).toBe('trace-abc-123');
      expect(event.request?.spanId).toBe('span-def-456');
      expect(event.request?.requestId).toBe('req-xyz');
    });
  });

  describe('change records', () => {
    it('should record field changes', async () => {
      const event = await logger
        .event(AuditCategory.USER, 'UPDATE')
        .describe('User email updated')
        .success()
        .byUser('user-123')
        .on('User', 'user-456')
        .changed('email', 'old@example.com', 'new@example.com')
        .changed('updatedAt', '2024-01-01', '2024-01-02')
        .record();

      expect(event.changes).toHaveLength(2);
      expect(event.changes?.[0]).toEqual({
        field: 'email',
        previousValue: 'old@example.com',
        newValue: 'new@example.com',
      });
    });

    it('should redact sensitive fields', async () => {
      const event = await logger
        .event(AuditCategory.USER, 'UPDATE')
        .describe('User password changed')
        .success()
        .byUser('user-123')
        .on('User', 'user-123')
        .changed('password', 'old-secret', 'new-secret')
        .record();

      expect(event.changes?.[0]?.previousValue).toBe('[REDACTED]');
      expect(event.changes?.[0]?.newValue).toBe('[REDACTED]');
      expect(event.changes?.[0]?.redacted).toBe(true);
    });
  });

  describe('severity levels', () => {
    it('should set critical severity', async () => {
      const event = await logger
        .event(AuditCategory.AUTHZ, 'PRIVILEGE_ESCALATION')
        .describe('Attempted privilege escalation detected')
        .denied('Unauthorized role assignment attempt')
        .critical()
        .byUser('user-malicious')
        .record();

      expect(event.severity).toBe(AuditSeverity.CRITICAL);
    });
  });

  describe('metadata', () => {
    it('should add custom metadata', async () => {
      const event = await logger
        .event(AuditCategory.PAYMENT, 'REFUND')
        .describe('Payment refunded')
        .success()
        .byUser('admin-001')
        .on('Payment', 'pay-123')
        .metadata({
          originalAmount: 15000,
          refundAmount: 15000,
          currency: 'KES',
          refundReason: 'duplicate_payment',
        })
        .record();

      expect(event.metadata).toEqual({
        originalAmount: 15000,
        refundAmount: 15000,
        currency: 'KES',
        refundReason: 'duplicate_payment',
      });
    });
  });

  describe('validation', () => {
    it('should throw if description is missing', async () => {
      await expect(
        logger
          .event(AuditCategory.AUTH, 'LOGIN')
          .success()
          .byUser('user-123')
          .record()
      ).rejects.toThrow('Audit event requires description');
    });

    it('should throw if outcome is missing', async () => {
      await expect(
        logger
          .event(AuditCategory.AUTH, 'LOGIN')
          .describe('Login attempt')
          .byUser('user-123')
          .record()
      ).rejects.toThrow('Audit event requires outcome');
    });

    it('should throw if actor is missing', async () => {
      await expect(
        logger
          .event(AuditCategory.AUTH, 'LOGIN')
          .describe('Login attempt')
          .success()
          .record()
      ).rejects.toThrow('Audit event requires actor');
    });
  });
});

describe('MemoryAuditStore', () => {
  let store: MemoryAuditStore;

  beforeEach(() => {
    store = new MemoryAuditStore();
  });

  afterEach(async () => {
    await store.close();
  });

  describe('query filtering', () => {
    beforeEach(async () => {
      const logger = new AuditLogger({ store });
      
      // Create test events
      await logger
        .event(AuditCategory.AUTH, 'LOGIN')
        .describe('User 1 login')
        .success()
        .byUser('user-1')
        .inTenant('tenant-a')
        .record();
      // 1ms gap so each record has a distinct timestampMs — the sort
      // test below needs strictly-increasing timestamps, and these
      // synchronous awaits otherwise complete within the same ms tick.
      await new Promise((r) => setTimeout(r, 2));

      await logger
        .event(AuditCategory.AUTH, 'LOGIN')
        .describe('User 2 login')
        .failure()
        .byUser('user-2')
        .inTenant('tenant-b')
        .record();
      await new Promise((r) => setTimeout(r, 2));

      await logger
        .event(AuditCategory.PROPERTY, 'CREATE')
        .describe('Property created')
        .success()
        .byUser('user-1')
        .inTenant('tenant-a')
        .on('Property', 'prop-1')
        .record();

      // Flush pending writes without closing the shared store — close()
      // cascades to MemoryAuditStore.close() which clears every event,
      // defeating the query tests that run next.
      await logger.flush();
    });

    it('should filter by tenant', async () => {
      const result = await store.query({ tenantId: 'tenant-a' });
      expect(result.events).toHaveLength(2);
    });

    it('should filter by actor', async () => {
      const result = await store.query({ actorId: 'user-1' });
      expect(result.events).toHaveLength(2);
    });

    it('should filter by category', async () => {
      const result = await store.query({ category: AuditCategory.AUTH });
      expect(result.events).toHaveLength(2);
    });

    it('should filter by outcome', async () => {
      const result = await store.query({ outcome: AuditOutcome.SUCCESS });
      expect(result.events).toHaveLength(2);
    });

    it('should filter by target', async () => {
      const result = await store.query({
        targetType: 'Property',
        targetId: 'prop-1',
      });
      expect(result.events).toHaveLength(1);
    });

    it('should paginate results', async () => {
      const page1 = await store.query({ limit: 2, offset: 0 });
      expect(page1.events).toHaveLength(2);
      expect(page1.hasMore).toBe(true);

      const page2 = await store.query({ limit: 2, offset: 2 });
      expect(page2.events).toHaveLength(1);
      expect(page2.hasMore).toBe(false);
    });

    it('should sort by timestamp', async () => {
      const asc = await store.query({ sortOrder: 'asc' });
      const desc = await store.query({ sortOrder: 'desc' });

      expect(asc.events[0]?.timestampMs).toBeLessThan(
        asc.events[asc.events.length - 1]?.timestampMs ?? 0
      );
      expect(desc.events[0]?.timestampMs).toBeGreaterThan(
        desc.events[desc.events.length - 1]?.timestampMs ?? 0
      );
    });
  });

  describe('getById', () => {
    it('should return event by ID', async () => {
      const logger = new AuditLogger({ store });
      const created = await logger
        .event(AuditCategory.AUTH, 'LOGIN')
        .describe('Test')
        .success()
        .byUser('user-1')
        .record();
      // flush but do NOT close — close() cascades to the shared store
      // and clears all events, which would defeat getById below.
      await logger.flush();

      const retrieved = await store.getById(created.id);
      expect(retrieved).toEqual(created);
    });

    it('should return null for non-existent ID', async () => {
      const result = await store.getById('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('healthCheck', () => {
    it('should return true', async () => {
      const healthy = await store.healthCheck();
      expect(healthy).toBe(true);
    });
  });
});
