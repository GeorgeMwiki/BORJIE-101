/**
 * Metrics Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlatformMetrics, initMetrics, shutdownMetrics, getMeter } from './metrics.js';
import type { TelemetryConfig } from '../types/telemetry.types.js';

describe('PlatformMetrics', () => {
  let metrics: PlatformMetrics;

  const testConfig: TelemetryConfig = {
    service: {
      name: 'test-service',
      version: '1.0.0',
      environment: 'development',
    },
    enabled: true,
    logLevel: 'info',
    traceSampleRatio: 0.1,
    metricsIntervalMs: 60000,
  };

  beforeEach(() => {
    initMetrics(testConfig);
    metrics = new PlatformMetrics('test-service', '1.0.0');
  });

  afterEach(async () => {
    await shutdownMetrics();
  });

  describe('HTTP metrics', () => {
    it('should record HTTP requests without throwing', () => {
      expect(() =>
        metrics.recordHttpRequest('GET', '/api/users', 200, 150, 'tenant-1')
      ).not.toThrow();
    });

    it('should record HTTP requests without tenant', () => {
      expect(() =>
        metrics.recordHttpRequest('POST', '/api/properties', 201, 250)
      ).not.toThrow();
    });

    it('should record error responses', () => {
      expect(() =>
        metrics.recordHttpRequest('GET', '/api/users/999', 404, 10)
      ).not.toThrow();
      expect(() =>
        metrics.recordHttpRequest('POST', '/api/payments', 500, 5000)
      ).not.toThrow();
    });
  });

  describe('Payment metrics', () => {
    it('should record payment transactions', () => {
      expect(() =>
        metrics.recordPayment('rent', 'success', 50000, 'KES', 'tenant-1')
      ).not.toThrow();
    });

    it('should record failed payments', () => {
      expect(() =>
        metrics.recordPayment('rent', 'failed', 50000, 'KES', 'tenant-1')
      ).not.toThrow();
    });

    it('should record payments without tenant', () => {
      expect(() =>
        metrics.recordPayment('deposit', 'success', 100000, 'KES')
      ).not.toThrow();
    });
  });

  describe('Maintenance metrics', () => {
    it('should record maintenance requests', () => {
      expect(() =>
        metrics.recordMaintenanceRequest('high', 'open', 'tenant-1')
      ).not.toThrow();
    });

    it('should record maintenance resolution time', () => {
      expect(() =>
        metrics.recordMaintenanceResolution('high', 3600000, 'tenant-1')
      ).not.toThrow();
    });
  });

  describe('Auth metrics', () => {
    it('should record successful auth attempts', () => {
      expect(() =>
        metrics.recordAuthAttempt('password', 'success', 'tenant-1')
      ).not.toThrow();
    });

    it('should record failed auth attempts', () => {
      expect(() =>
        metrics.recordAuthAttempt('password', 'failure', 'tenant-1')
      ).not.toThrow();
    });

    it('should record blocked auth attempts', () => {
      expect(() =>
        metrics.recordAuthAttempt('password', 'blocked', 'tenant-1')
      ).not.toThrow();
    });

    it('should set active sessions', () => {
      expect(() => metrics.setActiveSessions(150, 'tenant-1')).not.toThrow();
    });
  });

  describe('Audit metrics', () => {
    it('should record audit events', () => {
      expect(() =>
        metrics.recordAuditEvent('AUTH', 'SUCCESS', 'tenant-1')
      ).not.toThrow();
    });
  });

  describe('Error metrics', () => {
    it('should record errors', () => {
      expect(() =>
        metrics.recordError('DatabaseError', 'api-gateway', 'tenant-1')
      ).not.toThrow();
    });
  });

  describe('Custom metrics', () => {
    it('should create custom counter', () => {
      const counter = metrics.createCounter(
        'custom_operations_total',
        'Custom operation count'
      );
      expect(counter).toBeDefined();
      expect(() => counter.add(1)).not.toThrow();
    });

    it('should create custom histogram', () => {
      const histogram = metrics.createHistogram(
        'custom_duration_ms',
        'Custom operation duration',
        'ms'
      );
      expect(histogram).toBeDefined();
      expect(() => histogram.record(100)).not.toThrow();
    });
  });

  describe('getMeter', () => {
    it('should return a meter', () => {
      const meter = metrics.getMeter();
      expect(meter).toBeDefined();
    });
  });
});

describe('Metrics initialization', () => {
  afterEach(async () => {
    await shutdownMetrics();
  });

  it('should initialize metrics SDK', () => {
    const config: TelemetryConfig = {
      service: {
        name: 'test-service',
        version: '1.0.0',
        environment: 'development',
      },
      enabled: true,
      logLevel: 'info',
      traceSampleRatio: 0.1,
      metricsIntervalMs: 60000,
    };

    const provider = initMetrics(config);
    expect(provider).toBeDefined();
  });

  it('should return same provider on multiple init calls', () => {
    const config: TelemetryConfig = {
      service: {
        name: 'test-service',
        version: '1.0.0',
        environment: 'development',
      },
      enabled: true,
      logLevel: 'info',
      traceSampleRatio: 0.1,
      metricsIntervalMs: 60000,
    };

    const provider1 = initMetrics(config);
    const provider2 = initMetrics(config);
    expect(provider1).toBe(provider2);
  });

  it('should get global meter', () => {
    const config: TelemetryConfig = {
      service: {
        name: 'test-service',
        version: '1.0.0',
        environment: 'development',
      },
      enabled: true,
      logLevel: 'info',
      traceSampleRatio: 0.1,
      metricsIntervalMs: 60000,
    };

    initMetrics(config);
    const meter = getMeter('test-meter');
    expect(meter).toBeDefined();
  });
});
