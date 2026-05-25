/**
 * Internal — deterministic ID generator.
 *
 * Workflow IDs and assignment IDs need to be unique and stable. In
 * production we'd inject a real `randomUUID()` but for tests we want
 * deterministic IDs so snapshot diffs stay readable. The factory
 * accepts a counter source (defaults to the wall clock + a monotonic
 * counter) so consumers can override in tests.
 */

export interface IdGen {
  next(prefix: string): string;
}

export function createIdGen(seed?: () => string): IdGen {
  let counter = 0;
  return {
    next(prefix: string): string {
      counter += 1;
      const base = seed ? seed() : `${Date.now()}-${counter}`;
      return `${prefix}_${base}_${counter}`;
    },
  };
}
