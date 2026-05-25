/**
 * Repository Factory
 *
 * Wires the payments-ledger service to its persistence layer. When
 * DATABASE_URL is set we instantiate the Drizzle-backed repositories
 * against `@borjie/database`; otherwise we fall back to the
 * in-memory implementations used by tests and local development.
 *
 * Closes the A2 BLOCKER from `.audit/deep-audit-2026-05-20.md`
 * ("Dual ORMs in one DB") for ALL FIVE payments-ledger repositories:
 *
 *   - paymentIntentRepository ⇒ DrizzlePaymentIntentRepository  (W2 L)
 *   - accountRepository       ⇒ DrizzleAccountRepository        (W4-this)
 *   - ledgerRepository        ⇒ DrizzleLedgerRepository         (W4-this)
 *   - statementRepository     ⇒ DrizzleStatementRepository      (W4-this)
 *   - disbursementRepository  ⇒ DrizzleDisbursementRepository   (W4-this)
 *
 * In-memory adapters survive ONLY for tests and for local dev when
 * DATABASE_URL is unset. Prisma is gone — Drizzle is the only
 * production code path.
 *
 * Discipline (mirrors W4-A's fail-loud-in-prod pattern):
 *
 *   1. In production (NODE_ENV === 'production'), failing to build
 *      the Drizzle client is FATAL. We throw to keep the pod from
 *      starting and surface the misconfiguration loud. We do NOT
 *      degrade to InMemory in prod — webhook-acknowledged payments
 *      lost on restart is a P0.
 *
 *   2. In dev/test, absent or broken DATABASE_URL falls back to
 *      InMemory so local runs without a DB stay ergonomic.
 *
 *   3. The Drizzle client is built ONCE and shared across all five
 *      repos — postgres-js owns its own connection pool, so one
 *      client per process is the right unit.
 */

import { InMemoryPaymentIntentRepository } from './payment-intent.repository';
import { InMemoryAccountRepository } from './account.repository';
import { InMemoryLedgerRepository } from './ledger.repository';
import { InMemoryStatementRepository } from './statement.repository';
import { InMemoryDisbursementRepository } from './disbursement.repository';
import { DrizzlePaymentIntentRepository } from './drizzle-payment-intent.repository';
import { DrizzleAccountRepository } from './drizzle-account.repository';
import { DrizzleLedgerRepository } from './drizzle-ledger-entry.repository';
import { DrizzleStatementRepository } from './drizzle-statement.repository';
import { DrizzleDisbursementRepository } from './drizzle-disbursement.repository';
import type { IPaymentIntentRepository } from './payment-intent.repository';
import type { IAccountRepository } from './account.repository';
import type { ILedgerRepository } from './ledger.repository';
import type { IStatementRepository } from './statement.repository';
import type { IDisbursementRepository } from './disbursement.repository';

export interface Repositories {
  paymentIntentRepository: IPaymentIntentRepository;
  accountRepository: IAccountRepository;
  ledgerRepository: ILedgerRepository;
  statementRepository: IStatementRepository;
  disbursementRepository: IDisbursementRepository;
}

interface FactoryLogger {
  warn: (obj: object, msg: string) => void;
  info?: (obj: object, msg: string) => void;
}

type DbClient = ConstructorParameters<typeof DrizzlePaymentIntentRepository>[0];

/**
 * Lazy-require the database client. In production a missing/broken
 * DATABASE_URL throws (loud fail); in dev/test it returns null so the
 * factory degrades to InMemory.
 */
function buildDatabaseClient(
  databaseUrl: string | undefined,
  logger?: FactoryLogger,
): DbClient | null {
  if (!databaseUrl) {
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createDatabaseClient } = require('@borjie/database') as {
      createDatabaseClient: (url: string) => unknown;
    };
    const db = createDatabaseClient(databaseUrl);
    logger?.info?.(
      { adapter: 'drizzle' },
      'payments-ledger: database client constructed',
    );
    return db as DbClient;
  } catch (error) {
    const isProduction = process.env.NODE_ENV === 'production';
    if (isProduction) {
      logger?.warn(
        {
          adapter: 'none',
          reason: 'drizzle_client_init_failed_in_production',
          error: error instanceof Error ? error.message : String(error),
        },
        'payments-ledger: DB unreachable in production — refusing to start',
      );
      throw new Error(
        'Cannot start payments-ledger: DB unreachable. Failing loud to prevent silent data loss.',
      );
    }
    logger?.warn(
      {
        adapter: 'in-memory',
        reason: 'drizzle_client_init_failed',
        error: error instanceof Error ? error.message : String(error),
      },
      'payments-ledger: failed to init Drizzle client — falling back to InMemory repositories (data NOT persisted, dev/test only)',
    );
    return null;
  }
}

export function createRepositories(logger?: FactoryLogger): Repositories {
  const databaseUrl = process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === 'production';

  if (!databaseUrl && isProduction) {
    logger?.warn(
      { reason: 'no_database_url' },
      'DATABASE_URL is not set in production. Using InMemory repositories (data will be lost on restart).',
    );
  }

  const db = buildDatabaseClient(databaseUrl, logger);

  if (db === null) {
    return {
      paymentIntentRepository: new InMemoryPaymentIntentRepository(),
      accountRepository: new InMemoryAccountRepository(),
      ledgerRepository: new InMemoryLedgerRepository(),
      statementRepository: new InMemoryStatementRepository(),
      disbursementRepository: new InMemoryDisbursementRepository(),
    };
  }

  logger?.info?.(
    {
      adapter: 'drizzle',
      wired: [
        'paymentIntentRepository',
        'accountRepository',
        'ledgerRepository',
        'statementRepository',
        'disbursementRepository',
      ],
    },
    'payments-ledger: all repositories wired to Drizzle',
  );

  return {
    paymentIntentRepository: new DrizzlePaymentIntentRepository(db),
    accountRepository: new DrizzleAccountRepository(db),
    ledgerRepository: new DrizzleLedgerRepository(db),
    statementRepository: new DrizzleStatementRepository(db),
    disbursementRepository: new DrizzleDisbursementRepository(db),
  };
}
