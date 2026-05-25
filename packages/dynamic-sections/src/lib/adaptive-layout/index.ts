/**
 * @borjie/dynamic-sections — adaptive-layout barrel.
 *
 * The dashboard a frustrated tenant sees should NOT be the same as
 * the dashboard a happy tenant sees. This module ships the pure-
 * function engine + four production policies (frustration, role-
 * mastery, recency, intent) + the type contracts a downstream
 * SectionRegistry hook can adopt.
 *
 * The persistence-layer mirror lives in
 * `packages/database/src/schemas/section-layouts.schema.ts`
 * (migration 0182). The engine itself is stateless and pure — it
 * runs in the render path, never touches the network.
 */

export type {
  SectionId,
  MasteryLevel,
  ViewportBreakpoint,
  AffectiveProfile,
  UserBehaviorPattern,
  DetectedIntent,
  LayoutContext,
  LayoutDecision,
  LayoutPreference,
  LayoutPolicy,
} from './types.js';

export { ABSTAIN } from './types.js';

export { decideLayout } from './engine.js';

export { frustrationPolicy } from './policies/frustration-policy.js';
export { roleMasteryPolicy } from './policies/role-mastery-policy.js';
export { recencyPolicy } from './policies/recency-policy.js';
export { intentPolicy } from './policies/intent-policy.js';

import { frustrationPolicy } from './policies/frustration-policy.js';
import { roleMasteryPolicy } from './policies/role-mastery-policy.js';
import { recencyPolicy } from './policies/recency-policy.js';
import { intentPolicy } from './policies/intent-policy.js';
import type { LayoutPolicy } from './types.js';

/**
 * The default-shipped policy bundle, applied in dependency order.
 *
 * Order is cosmetic (engine respects per-policy weight for conflict
 * resolution) but is preserved in the rationale string for debug.
 *
 * Consumers may construct a custom bundle if they need to exclude
 * a policy in a specific surface — e.g. the platform-admin portal
 * should never run the frustration policy because the operator is
 * not the user being observed.
 */
export const defaultPolicies: readonly LayoutPolicy[] = Object.freeze([
  intentPolicy,
  frustrationPolicy,
  roleMasteryPolicy,
  recencyPolicy,
]);
