/**
 * Version-column helper.
 *
 * The tenant tables in Borjie already have a `version` column
 * (added in 0182 batch) but no code currently uses it. This helper
 * gives the canonical retry loop:
 *
 *   1. Read row -> get current version V
 *   2. Mutate locally
 *   3. UPDATE ... WHERE id = $1 AND version = $V SET version = V + 1
 *   4. If 0 rows affected, retry with backoff (up to maxAttempts)
 *
 * The helper is driver-agnostic — pass in the `read` and `attemptWrite`
 * closures from your Drizzle layer.
 */

import { VersionConflictExhaustedError } from "./errors.js";

export interface VersionedRow {
  readonly version: number;
}

export interface WithVersionColumnArgs<T extends VersionedRow, R> {
  /** Reads the current row; returns null if deleted. */
  readonly read: () => Promise<T | null>;
  /**
   * Attempts the conditional UPDATE. MUST include
   * `WHERE version = $expectedVersion` and return `true` iff
   * exactly one row was affected.
   */
  readonly attemptWrite: (
    next: T,
    expectedVersion: number
  ) => Promise<{ success: boolean; result?: R }>;
  /** Computes the next row from the current one. */
  readonly mutate: (current: T) => Promise<T>;
  /** Default 3. */
  readonly maxAttempts?: number;
  /** Default exponential 5/10/20ms; pass `() => 0` for tests. */
  readonly delayMs?: (attempt: number) => number;
}

export async function withVersionColumn<T extends VersionedRow, R>(
  args: WithVersionColumnArgs<T, R>
): Promise<R> {
  const maxAttempts = args.maxAttempts ?? 3;
  const delayFn = args.delayMs ?? defaultDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const current = await args.read();
    if (current === null) {
      throw new VersionConflictExhaustedError(attempt);
    }
    const proposed = await args.mutate(current);
    const next = bumpVersion(proposed);
    const { success, result } = await args.attemptWrite(
      next,
      current.version
    );
    if (success) {
      if (result === undefined) {
        throw new Error(
          "attemptWrite returned success without a result — implementation bug"
        );
      }
      return result;
    }
    if (attempt < maxAttempts) {
      await sleep(delayFn(attempt));
    }
  }
  throw new VersionConflictExhaustedError(maxAttempts);
}

function bumpVersion<T extends VersionedRow>(row: T): T {
  return { ...row, version: row.version + 1 };
}

function defaultDelay(attempt: number): number {
  return Math.min(20, 5 * 2 ** (attempt - 1));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
