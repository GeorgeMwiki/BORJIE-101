/**
 * Trigger engine.
 *
 * Runs the rule registry against a (profile, signals, role) bundle.
 * Filters rules by role applicability, executes each `evaluate`,
 * drops nulls, sorts by urgency desc.
 *
 * The engine is sync — every rule's `evaluate` is sync. Async work
 * happens upstream in the profile / signal builders.
 */
import type {
  AnyProfile,
  BehavioralSignals,
  Role,
  Trigger,
} from '../types.js';
import { ALL_TRIGGER_RULES, type TriggerRule } from './rules.js';

export interface ComputeTriggersArgs {
  readonly profile: AnyProfile;
  readonly signals: BehavioralSignals;
  readonly role: Role;
  readonly userId: string;
  readonly tenantId: string;
  /** Pinned clock for tests. */
  readonly now?: Date;
  /** Optional override registry — defaults to {@link ALL_TRIGGER_RULES}. */
  readonly rules?: ReadonlyArray<TriggerRule>;
}

/**
 * Evaluate every applicable rule, return triggers sorted by urgency desc.
 */
export function computeTriggers(args: ComputeTriggersArgs): ReadonlyArray<Trigger> {
  const rules = args.rules ?? ALL_TRIGGER_RULES;
  const triggers: Trigger[] = [];
  for (const rule of rules) {
    if (!rule.applicableRoles.includes(args.role)) continue;
    try {
      const result = rule.evaluate({
        userId: args.userId,
        tenantId: args.tenantId,
        role: args.role,
        profile: args.profile,
        signals: args.signals,
        ...(args.now ? { now: args.now } : {}),
      });
      if (result) triggers.push(result);
    } catch {
      // A buggy rule should never knock out the whole engine. Skip and
      // continue — operators see the missing trigger in their telemetry.
    }
  }
  return triggers.slice().sort((a, b) => b.urgency - a.urgency);
}
