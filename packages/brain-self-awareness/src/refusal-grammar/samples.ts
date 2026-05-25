// Refusal Grammar — six canonical sample refusals.
// These cover the most common refusal causes encountered across the platform.

import type { Refusal } from './types.js'

/**
 * Brain is technically able to act but its autonomy scope forbids it.
 * Most common: tenant-facing AI hitting an EXECUTE_WITH_APPROVAL ceiling.
 */
export const REFUSAL_ABOVE_AUTONOMY_CAP: Refusal = {
  class: 'wont',
  reason_owner_safe:
    'This action is above my current autonomy. I need an owner or manager to approve it.',
  alternative:
    'I can draft the action for your review — say "draft it" and I will prepare it.',
  escalation_path: 'role:owner',
  code: 'ABOVE_AUTONOMY_CAP'
}

/**
 * Action is destructive (e.g. lease termination, mass refund) AND no
 * 2-eye / 4-eye approval ticket exists.
 */
export const REFUSAL_DESTRUCTIVE_NO_APPROVAL: Refusal = {
  class: 'wont',
  reason_owner_safe:
    'This is a destructive action. I will not run it without a second pair of eyes.',
  alternative:
    'I can open an approval ticket so a second manager can sign off.',
  escalation_path: 'role:owner+role:manager',
  code: 'DESTRUCTIVE_NO_APPROVAL'
}

/**
 * Brain literally cannot — required field is missing from the request /
 * referenced document is not in storage / vendor not registered.
 */
export const REFUSAL_MISSING_DATA: Refusal = {
  class: 'cant',
  reason_owner_safe:
    'I am missing some information to proceed. Could you share the missing details?',
  alternative:
    'I can show you a short form that asks only for what I still need.',
  escalation_path: 'self-serve:fill-form',
  code: 'MISSING_DATA'
}

/**
 * Action would cross a jurisdictional boundary the brain is not licensed for
 * (e.g. issuing a lease document in a region whose template is not loaded).
 */
export const REFUSAL_JURISDICTION: Refusal = {
  class: 'cant',
  reason_owner_safe:
    'This action depends on a jurisdiction I am not configured for.',
  alternative:
    'I can hand off to a licensed counsel or paralegal in your network.',
  escalation_path: 'role:legal',
  code: 'JURISDICTION_UNSUPPORTED'
}

/**
 * Brain is calibrated and below its confidence floor — admits uncertainty
 * rather than guessing.
 */
export const REFUSAL_MODEL_UNCERTAIN: Refusal = {
  class: 'uncertain',
  reason_owner_safe:
    'I am not confident enough to act here. I would rather flag it than guess.',
  alternative:
    'Want me to list what I would need to be sure, so we can decide together?',
  escalation_path: 'role:owner',
  code: 'MODEL_UNCERTAIN'
}

/**
 * Action was blocked by an upstream policy/safety classifier (e.g. PII filter,
 * harassment filter, sanctions screen).
 */
export const REFUSAL_CLASSIFIER_BLOCKED: Refusal = {
  class: 'wont',
  reason_owner_safe:
    'A safety check blocked this action. I will not bypass it.',
  alternative:
    'If you believe this was a false positive, an admin can open a review ticket.',
  escalation_path: 'role:admin',
  code: 'CLASSIFIER_BLOCKED'
}

/**
 * Convenience: the six samples enumerated in a stable order.
 * Useful for fixture generation and contract tests downstream.
 */
export const ALL_SAMPLE_REFUSALS: readonly Refusal[] = [
  REFUSAL_ABOVE_AUTONOMY_CAP,
  REFUSAL_DESTRUCTIVE_NO_APPROVAL,
  REFUSAL_MISSING_DATA,
  REFUSAL_JURISDICTION,
  REFUSAL_MODEL_UNCERTAIN,
  REFUSAL_CLASSIFIER_BLOCKED
]
