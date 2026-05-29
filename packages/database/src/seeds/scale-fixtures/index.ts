/**
 * Scale-fixtures — public barrel.
 *
 * 5 tier-representative tenant fixtures used by tests + dev seeds:
 *   T1 artisanal     — 1 worker, 1 pit
 *   T2 cooperative   — 22 workers, 3 pits
 *   T3 midtier       — 180 workers, 5 sites
 *   T4 industrial    — 1,200 workers, 8 sites, multi-region
 *   T5 multi_country — 3,400 workers, 4 jurisdictions, cross-border
 *
 * Each fixture is pure data — no DB I/O. A future `seed-fixture.ts`
 * walker may upsert these into a dev DB; for now the test surface uses
 * them to verify auto-detect, tier tab counts, and brain persona
 * register without bringing up Postgres.
 */

export type {
  FixtureSite,
  FixtureEmployee,
  FixtureSale,
  ScaleFixture,
  ScaleTier,
} from './types.js';

export { T1_ARTISANAL_FIXTURE } from './t1-artisanal.js';
export { T2_COOPERATIVE_FIXTURE } from './t2-coop.js';
export { T3_MIDTIER_FIXTURE } from './t3-midtier.js';
export { T4_INDUSTRIAL_FIXTURE } from './t4-industrial.js';
export { T5_GROUP_FIXTURE } from './t5-group.js';

import { T1_ARTISANAL_FIXTURE } from './t1-artisanal.js';
import { T2_COOPERATIVE_FIXTURE } from './t2-coop.js';
import { T3_MIDTIER_FIXTURE } from './t3-midtier.js';
import { T4_INDUSTRIAL_FIXTURE } from './t4-industrial.js';
import { T5_GROUP_FIXTURE } from './t5-group.js';
import type { ScaleFixture } from './types.js';

/**
 * The full ordered list of fixtures (T1 → T5). Useful for parametric
 * tests that walk every tier.
 */
export const ALL_SCALE_FIXTURES: ReadonlyArray<ScaleFixture> = Object.freeze([
  T1_ARTISANAL_FIXTURE,
  T2_COOPERATIVE_FIXTURE,
  T3_MIDTIER_FIXTURE,
  T4_INDUSTRIAL_FIXTURE,
  T5_GROUP_FIXTURE,
]);
