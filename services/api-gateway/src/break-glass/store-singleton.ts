/**
 * Process-singleton break-glass store accessor (INV-A / FIRE-1).
 *
 * Binds the break-glass operator-access store to the gateway's database
 * client. When no live DB is configured (dev/test without Postgres) it falls
 * back to the in-memory store so the deny-by-default gate still functions
 * (it simply has no grants, so every platform access is refused — the safe
 * default). Tests may inject their own store via `__setOperatorAccessStore`.
 */

import { getDatabaseClient } from '../middleware/database';
import {
  createInMemoryOperatorAccessStore,
  createOperatorAccessStore,
  type OperatorAccessStore,
} from './operator-access-store';

let override: OperatorAccessStore | null = null;
let cached: OperatorAccessStore | null = null;

export function getOperatorAccessStore(): OperatorAccessStore {
  if (override) return override;
  if (cached) return cached;
  const db = getDatabaseClient();
  cached = db
    ? createOperatorAccessStore(db)
    : createInMemoryOperatorAccessStore();
  return cached;
}

/** Test seam — inject a deterministic store. */
export function __setOperatorAccessStore(
  store: OperatorAccessStore | null,
): void {
  override = store;
  cached = null;
}
