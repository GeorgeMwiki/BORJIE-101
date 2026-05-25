/**
 * Harness-of-the-harness — proves the cross-tenant regression helper
 * itself fails when a route LEAKS the foreign tenant's resource, and
 * passes when the route returns 403/404 with no leaked fields.
 */

import { describe, it, expect } from 'vitest';

import {
  testTenantIsolation,
  isNoLeakStatus,
  type HarnessRunner,
} from '../regression/tenant-isolation.js';
import {
  isAllowedCrossTenant,
  patternToRegExp,
} from '../regression/cross-tenant-allowlist.js';

function recordingRunner(): {
  readonly runner: HarnessRunner;
  readonly results: Array<{
    name: string;
    failed: boolean;
    error?: unknown;
  }>;
} {
  const results: Array<{ name: string; failed: boolean; error?: unknown }> = [];
  const runner: HarnessRunner = {
    it: async (name, fn) => {
      try {
        await fn();
        results.push({ name, failed: false });
      } catch (err) {
        results.push({ name, failed: true, error: err });
      }
    },
    expect: <T>(actual: T) => {
      return {
        toBeDefined: () => {
          if (actual === undefined) throw new Error('expected defined');
        },
        toBe: (expected: unknown) => {
          if (actual !== (expected as unknown))
            throw new Error(`expected ${String(expected)} got ${String(actual)}`);
        },
        toContain: (expected: unknown) => {
          if (typeof actual === 'string' && typeof expected === 'string') {
            if (!actual.includes(expected))
              throw new Error(`expected to contain ${expected}`);
          } else {
            throw new Error('toContain only supported for strings here');
          }
        },
        toBeOneOf: (expected: ReadonlyArray<unknown>) => {
          if (!expected.includes(actual as unknown))
            throw new Error(`expected one of ${JSON.stringify(expected)}`);
        },
        toEqual: (expected: unknown) => {
          if (JSON.stringify(actual) !== JSON.stringify(expected))
            throw new Error('toEqual mismatch');
        },
        toBeTruthy: () => {
          if (!actual) throw new Error('expected truthy');
        },
        toBeFalsy: () => {
          if (actual) throw new Error('expected falsy');
        },
        not: {
          toContain: (expected: unknown) => {
            if (
              typeof actual === 'string' &&
              typeof expected === 'string' &&
              actual.includes(expected)
            ) {
              throw new Error(`expected NOT to contain ${expected}`);
            }
          },
          toBe: (expected: unknown) => {
            if (actual === (expected as unknown))
              throw new Error('expected NOT to be');
          },
        },
      };
    },
  };
  return { runner, results };
}

describe('testTenantIsolation harness', () => {
  it('passes when the route returns 404 with no leaked id', async () => {
    const { runner, results } = recordingRunner();
    await testTenantIsolation(
      {
        description: 'no leak',
        setup: async () => ({
          tenantA: 'tnt-a',
          tenantB: 'tnt-b',
          leaseId: 'lease-only-in-A',
        }),
        act: async () => ({ status: 404, body: { error: 'not found' } }),
        expect: {
          status: 404,
          forbiddenSubstrings: ['lease-only-in-A'],
        },
      },
      runner,
    );
    expect(results.length).toBe(1);
    expect(results[0]?.failed).toBe(false);
  });

  it('fails when the route returns 200 with the foreign-tenant resource', async () => {
    const { runner, results } = recordingRunner();
    await testTenantIsolation(
      {
        description: 'leak',
        setup: async () => ({ leaseId: 'lease-A-leaked' }),
        act: async () => ({
          status: 200,
          body: { id: 'lease-A-leaked', tenantId: 'tnt-a' },
        }),
        expect: {
          forbiddenSubstrings: ['lease-A-leaked'],
        },
      },
      runner,
    );
    expect(results.length).toBe(1);
    expect(results[0]?.failed).toBe(true);
  });

  it('fails when forbiddenFields appears as a JSON key', async () => {
    const { runner, results } = recordingRunner();
    await testTenantIsolation(
      {
        description: 'field leak',
        setup: async () => ({}),
        act: async () => ({
          status: 200,
          body: { gpsLat: 1.23, gpsLng: 4.56 },
        }),
        expect: {
          forbiddenFields: ['gpsLat'],
        },
      },
      runner,
    );
    expect(results[0]?.failed).toBe(true);
  });

  it('accepts 403 as a no-leak status by default', async () => {
    const { runner, results } = recordingRunner();
    await testTenantIsolation(
      {
        description: '403',
        setup: async () => ({}),
        act: async () => ({ status: 403, body: { error: 'forbidden' } }),
      },
      runner,
    );
    expect(results[0]?.failed).toBe(false);
  });
});

describe('cross-tenant allowlist matchers', () => {
  it('matches admin/** paths', () => {
    expect(patternToRegExp('/v1/admin/**').test('/v1/admin/tenants/abc')).toBe(
      true,
    );
    expect(patternToRegExp('/v1/admin/**').test('/v1/leases/xyz')).toBe(false);
  });

  it('isAllowedCrossTenant short-circuits known platform routes', () => {
    expect(isAllowedCrossTenant('GET', '/v1/admin/tenants')).toBe(true);
    expect(isAllowedCrossTenant('GET', '/v1/leases/123')).toBe(false);
    expect(isAllowedCrossTenant('GET', '/v1/health')).toBe(true);
  });
});

describe('isNoLeakStatus', () => {
  it('accepts 403 + 404 and rejects 200', () => {
    expect(isNoLeakStatus(403)).toBe(true);
    expect(isNoLeakStatus(404)).toBe(true);
    expect(isNoLeakStatus(200)).toBe(false);
  });
});
