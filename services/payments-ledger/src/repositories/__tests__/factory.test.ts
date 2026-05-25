/**
 * Tests for the security-critical contract of `createRepositories` —
 * specifically the fail-loud-in-production behaviour added to close the
 * silent-fallback CRITICAL.
 *
 * The factory uses a lazy `require('@borjie/database')` (so prod
 * paths don't pay the import cost in DB-less local runs). To intercept
 * that require call we stub `require.cache` directly — `vi.mock` on its
 * own does not work for CommonJS `require()` inside the factory.
 *
 * Pair with `payment-intent-tenant-scope.test.ts` which exercises
 * the tenant-scoping predicate on `findByExternalId`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import Module from 'node:module';

type LogEntry = { level: 'warn' | 'info'; obj: object; msg: string };

function makeLogger(): { logger: { warn: (o: object, m: string) => void; info: (o: object, m: string) => void }; captured: LogEntry[] } {
  const captured: LogEntry[] = [];
  return {
    captured,
    logger: {
      warn: (obj, msg) => captured.push({ level: 'warn', obj, msg }),
      info: (obj, msg) => captured.push({ level: 'info', obj, msg }),
    },
  };
}

// Hoist the dynamic `import('../factory')` into `beforeAll` so the cold-load
// cost is paid ONCE per suite, not per-test. Under CI parallel-test pressure
// (`pnpm -r test` across ~50 packages concurrently) the cold ESM import was
// exceeding even a 15-second per-test timeout. With the import hoisted, all
// three tests share a single module-load and run well under default budget.
let createRepositories: typeof import('../factory').createRepositories;

describe('createRepositories', () => {
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    ({ createRepositories } = await import('../factory'));
  }, 60_000);
  // Patch require so the lazy `require('@borjie/database')` inside
  // factory.ts hits our stub instead of the real package.
  const moduleProto = Module.prototype as unknown as {
    require: NodeJS.Require;
  };
  const originalRequire = moduleProto.require;
  let throwOnDatabaseRequire = false;

  beforeEach(() => {
    throwOnDatabaseRequire = false;
    moduleProto.require = function patchedRequire(this: unknown, id: string) {
      if (id === '@borjie/database') {
        if (throwOnDatabaseRequire) {
          throw new Error('simulated_db_init_failure');
        }
        return {
          createDatabaseClient: () => {
            throw new Error('simulated_db_init_failure_lazy');
          },
        };
      }
      return originalRequire.call(this, id);
    } as NodeJS.Require;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    moduleProto.require = originalRequire;
  });

  it('returns in-memory repos when DATABASE_URL is unset (dev path)', () => {
    delete process.env.DATABASE_URL;
    process.env.NODE_ENV = 'development';
    const { logger } = makeLogger();
    const repos = createRepositories(logger);

    expect(repos.paymentIntentRepository.constructor.name).toBe(
      'InMemoryPaymentIntentRepository',
    );
  });

  it('throws in production when DATABASE_URL is set but driver init fails', () => {
    process.env.DATABASE_URL = 'postgres://does-not-exist:5432/none';
    process.env.NODE_ENV = 'production';
    throwOnDatabaseRequire = true;

    const { logger, captured } = makeLogger();
    expect(() => createRepositories(logger)).toThrow(
      /Cannot start payments-ledger: DB unreachable/i,
    );
    expect(
      captured.some(
        (c) =>
          c.level === 'warn' &&
          /DB unreachable in production/i.test(c.msg),
      ),
    ).toBe(true);
  });

  it('degrades to in-memory in dev/test when driver init fails', () => {
    process.env.DATABASE_URL = 'postgres://does-not-exist:5432/none';
    process.env.NODE_ENV = 'test';
    throwOnDatabaseRequire = true;

    const { logger, captured } = makeLogger();
    const repos = createRepositories(logger);
    expect(repos.paymentIntentRepository.constructor.name).toBe(
      'InMemoryPaymentIntentRepository',
    );
    expect(
      captured.some(
        (c) =>
          c.level === 'warn' &&
          /falling back to InMemory/i.test(c.msg),
      ),
    ).toBe(true);
  });
});
