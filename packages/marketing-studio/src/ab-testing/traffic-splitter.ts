/**
 * Traffic splitter — deterministic visitor → variant assignment.
 *
 * Uses sha256 hash of (visitor_id + recipe_id) mod split-bucket to
 * pick a variant index. The bucket size is fixed at 10000 to allow
 * fine-grained traffic splits down to 0.0001.
 */

import { createHash } from 'node:crypto';
import type { ABTestSpec } from '../types.js';
import { MarketingError } from '../types.js';

const BUCKET_SIZE = 10_000;

export interface AssignArgs {
  readonly visitor_id: string;
  readonly recipe_id: string;
  readonly variants: ReadonlyArray<{ readonly id: string }>;
  readonly spec: ABTestSpec;
}

export interface Assignment {
  readonly variant_index: number;
  readonly variant_id: string;
}

export function assignVariant(args: AssignArgs): Assignment {
  if (args.variants.length !== args.spec.variant_count) {
    throw new MarketingError(
      'INVARIANT_VIOLATION',
      `variants.length (${args.variants.length}) != spec.variant_count (${args.spec.variant_count})`,
    );
  }
  if (args.spec.traffic_split.length !== args.spec.variant_count) {
    throw new MarketingError(
      'INVARIANT_VIOLATION',
      `traffic_split.length (${args.spec.traffic_split.length}) != variant_count (${args.spec.variant_count})`,
    );
  }
  const totalShare = args.spec.traffic_split.reduce((s, n) => s + n, 0);
  if (Math.abs(totalShare - 1) > 0.0001) {
    throw new MarketingError(
      'INVARIANT_VIOLATION',
      `traffic_split must sum to 1.0; got ${totalShare}`,
    );
  }

  const hash = createHash('sha256')
    .update(`${args.visitor_id}:${args.recipe_id}`)
    .digest();
  // Read first 4 bytes as a uint32 and mod by bucket size
  const u32 = hash.readUInt32BE(0);
  const bucket = u32 % BUCKET_SIZE;

  let cumulative = 0;
  for (let i = 0; i < args.variants.length; i++) {
    const share = args.spec.traffic_split[i];
    if (share === undefined) {
      continue;
    }
    cumulative += share * BUCKET_SIZE;
    if (bucket < cumulative) {
      const variant = args.variants[i];
      if (variant === undefined) {
        continue;
      }
      return { variant_index: i, variant_id: variant.id };
    }
  }
  // Fallback to last variant (rounding edge case).
  const last = args.variants.length - 1;
  const variant = args.variants[last];
  if (variant === undefined) {
    throw new MarketingError('INVARIANT_VIOLATION', 'no variants available');
  }
  return { variant_index: last, variant_id: variant.id };
}
