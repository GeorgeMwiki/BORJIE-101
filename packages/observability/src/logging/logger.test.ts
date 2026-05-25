/**
 * Logger Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Logger } from './logger.js';
import type { ServiceIdentity } from '../types/telemetry.types.js';

describe('Logger', () => {
  const testService: ServiceIdentity = {
    name: 'test-service',
    version: '1.0.0',
    environment: 'development',
  };

  let logger: Logger;

  beforeEach(() => {
    logger = new Logger({
      service: testService,
      level: 'trace',
      pretty: false,
    });
  });

  describe('log levels', () => {
    it('should have all log methods', () => {
      expect(typeof logger.trace).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.fatal).toBe('function');
    });

    it('should log at each level without throwing', () => {
      expect(() => logger.trace('trace message')).not.toThrow();
      expect(() => logger.debug('debug message')).not.toThrow();
      expect(() => logger.info('info message')).not.toThrow();
      expect(() => logger.warn('warn message')).not.toThrow();
      expect(() => logger.error('error message')).not.toThrow();
      expect(() => logger.fatal('fatal message')).not.toThrow();
    });
  });

  describe('child loggers', () => {
    it('should create child logger with tenant context', () => {
      const childLogger = logger.forTenant('tenant-123');
      expect(childLogger).toBeInstanceOf(Logger);
    });

    it('should create child logger with user context', () => {
      const childLogger = logger.forUser('user-456');
      expect(childLogger).toBeInstanceOf(Logger);
    });

    it('should create child logger with request context', () => {
      const childLogger = logger.forRequest('req-789', 'session-abc');
      expect(childLogger).toBeInstanceOf(Logger);
    });

    it('should chain context creation', () => {
      const childLogger = logger
        .forTenant('tenant-123')
        .forUser('user-456')
        .forRequest('req-789');
      expect(childLogger).toBeInstanceOf(Logger);
    });

    it('should merge context in child loggers', () => {
      const child1 = logger.child({ tenantId: 'tenant-1' });
      const child2 = child1.child({ userId: 'user-1' });
      // Both should work without throwing
      expect(() => child2.info('test')).not.toThrow();
    });
  });

  describe('error logging', () => {
    it('should handle Error objects', () => {
      const error = new Error('Test error');
      expect(() => logger.error('An error occurred', error)).not.toThrow();
    });

    it('should handle error data objects', () => {
      const errorData = { code: 'ERR_001', details: 'Something went wrong' };
      expect(() => logger.error('An error occurred', errorData)).not.toThrow();
    });

    it('should handle error with additional data', () => {
      const error = new Error('Test error');
      const additionalData = { requestId: 'req-123' };
      expect(() =>
        logger.error('An error occurred', error, additionalData)
      ).not.toThrow();
    });
  });

  describe('data logging', () => {
    it('should accept additional data', () => {
      expect(() =>
        logger.info('User action', { action: 'click', target: 'button' })
      ).not.toThrow();
    });

    it('should accept nested data', () => {
      expect(() =>
        logger.info('Complex data', {
          user: { id: '123', name: 'Test' },
          metadata: { source: 'api', version: 2 },
        })
      ).not.toThrow();
    });
  });

  describe('getPino', () => {
    it('should return the underlying Pino logger', () => {
      const pino = logger.getPino();
      expect(pino).toBeDefined();
      expect(typeof pino.info).toBe('function');
    });
  });

  describe('configuration', () => {
    it('should create logger with different log levels', () => {
      const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
      for (const level of levels) {
        const testLogger = new Logger({
          service: testService,
          level,
        });
        expect(testLogger).toBeInstanceOf(Logger);
      }
    });

    it('should create logger with custom redact fields', () => {
      const customLogger = new Logger({
        service: testService,
        level: 'info',
        redactFields: ['customSecret', 'myApiKey'],
      });
      expect(customLogger).toBeInstanceOf(Logger);
    });

    it('should create logger with base context', () => {
      const contextLogger = new Logger({
        service: testService,
        level: 'info',
        baseContext: {
          tenantId: 'default-tenant',
          attributes: { region: 'us-east-1' },
        },
      });
      expect(contextLogger).toBeInstanceOf(Logger);
    });
  });
});
