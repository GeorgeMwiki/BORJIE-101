/**
 * Shared in-memory DatabaseClient stub for the platform.* adapter tests.
 *
 * Strategy: record each Drizzle call as a normalised `{op, values, set}`
 * entry so test bodies can assert on the shapes the adapter handed to
 * drizzle. The stub also lets a test seed `selectRows` (returned by the
 * next select-chain terminal) or force the next op to throw.
 *
 * NOT a full Drizzle re-implementation — just the surface our adapters
 * touch (insert, update, delete, select.from.where[.orderBy][.limit],
 * transaction(cb)).
 */
import type { DatabaseClient } from '../../../client.js';

export interface RecordedOp {
  readonly op:
    | 'insert'
    | 'update'
    | 'delete'
    | 'select'
    | 'transaction-begin'
    | 'transaction-end';
  readonly values?: Record<string, unknown>;
  readonly set?: Record<string, unknown>;
}

export interface StubDb {
  readonly client: DatabaseClient;
  readonly ops: ReadonlyArray<RecordedOp>;
  /** Seed: the rows the next select-chain terminal will return. */
  setSelectRows(rows: ReadonlyArray<Record<string, unknown>>): void;
  /** Force the very next op to throw the supplied error (one-shot). */
  setNextThrow(err: Error): void;
}

export function makeStubDb(): StubDb {
  const ops: RecordedOp[] = [];
  let selectRows: ReadonlyArray<Record<string, unknown>> = [];
  let nextThrow: Error | null = null;

  function consumeThrow(): Error | null {
    if (nextThrow) {
      const e = nextThrow;
      nextThrow = null;
      return e;
    }
    return null;
  }

  const thenify = <T>(value: T) => ({
    then: (resolve: (v: T) => unknown) => resolve(value),
  });

  function selectChain(): unknown {
    const terminal = () => {
      const err = consumeThrow();
      if (err) {
        return {
          then: (
            _resolve: (v: unknown) => unknown,
            reject?: (e: unknown) => void,
          ) => {
            if (reject) reject(err);
            else throw err;
          },
        };
      }
      ops.push({ op: 'select' });
      return thenify(selectRows);
    };
    const chain: Record<string, unknown> = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => terminal(),
      for: () => chain,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => void) => {
        const t = terminal() as { then: (r: any, j?: any) => void };
        return t.then(resolve, reject);
      },
    };
    return chain;
  }

  const db: Record<string, unknown> = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        const err = consumeThrow();
        if (err) {
          return {
            then: (
              _r: (v: unknown) => unknown,
              j?: (e: unknown) => void,
            ) => (j ? j(err) : (() => { throw err; })()),
          };
        }
        ops.push({ op: 'insert', values: v });
        return thenify(undefined);
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: (_: unknown) => {
          const err = consumeThrow();
          if (err) {
            return {
              then: (
                _r: (v: unknown) => unknown,
                j?: (e: unknown) => void,
              ) => (j ? j(err) : (() => { throw err; })()),
            };
          }
          ops.push({ op: 'update', set: s });
          return thenify(undefined);
        },
      }),
    }),
    delete: () => ({
      where: (_: unknown) => {
        const err = consumeThrow();
        if (err) {
          return {
            then: (
              _r: (v: unknown) => unknown,
              j?: (e: unknown) => void,
            ) => (j ? j(err) : (() => { throw err; })()),
          };
        }
        ops.push({ op: 'delete' });
        return thenify(undefined);
      },
    }),
    select: () => ({
      from: () => selectChain(),
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      const err = consumeThrow();
      if (err) throw err;
      ops.push({ op: 'transaction-begin' });
      const result = await cb(db as unknown);
      ops.push({ op: 'transaction-end' });
      return result;
    },
  };

  const stub: StubDb = {
    client: db as unknown as DatabaseClient,
    get ops() {
      return ops;
    },
    setSelectRows(rows) {
      selectRows = rows;
    },
    setNextThrow(err) {
      nextThrow = err;
    },
  };
  return stub;
}
