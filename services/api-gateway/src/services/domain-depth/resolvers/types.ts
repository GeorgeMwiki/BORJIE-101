/**
 * Domain-depth resolvers — typed shapes shared across resolver modules.
 *
 * Every resolver returns a `SubAreaStatus` (see `../types.ts`) plus an
 * optional structured summary the brain tools surface as
 * `compliance.pccb_summary()` / `compliance.pdpa_summary()` etc.
 *
 * Resolvers NEVER throw. Failure paths return
 * `{ status: 'unknown', note: '<reason>' }`. The brain treats unknown
 * sub-areas as "no signal yet" instead of pretending health.
 */

import type { SubAreaScope, SubAreaStatus } from '../types';

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Composed dependency bundle every resolver receives so we can wire
 * stubs in tests without faking the full Drizzle surface.
 */
export interface ResolverDeps {
  readonly db: DbLike | null;
}

export type ResolverFn = (
  deps: ResolverDeps,
  scope: SubAreaScope,
) => Promise<SubAreaStatus>;
