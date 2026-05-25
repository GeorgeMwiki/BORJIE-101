/**
 * Signal orchestrator — composes recent-activity, open-items,
 * lifecycle-stage, and intent-signals into a single
 * {@link BehavioralSignals} bundle.
 */
import type {
  AnyProfile,
  BehavioralSignals,
  Role,
} from '../types.js';
import { buildProfile } from '../profile/index.js';
import { intentSignals } from './intent-signals.js';
import { lifecycleStage } from './lifecycle-stage.js';
import { openItems } from './open-items.js';
import { recentActivity } from './recent-activity.js';

export interface GatherSignalsArgs {
  readonly userId: string;
  readonly tenantId: string;
  readonly role: Role;
  readonly db: unknown;
  /** Already-built profile (optional — skip the rebuild). */
  readonly profile?: AnyProfile;
  readonly activityDays?: number;
}

/**
 * Run every signal in parallel, then compose into a single
 * {@link BehavioralSignals} bundle.
 */
export async function gatherSignals(
  args: GatherSignalsArgs,
): Promise<BehavioralSignals> {
  const [profile, activity, openItemsResult] = await Promise.all([
    args.profile
      ? Promise.resolve(args.profile)
      : buildProfile({
          role: args.role,
          userId: args.userId,
          tenantId: args.tenantId,
          db: args.db,
        }),
    recentActivity({
      userId: args.userId,
      tenantId: args.tenantId,
      db: args.db,
      ...(args.activityDays !== undefined ? { days: args.activityDays } : {}),
    }),
    openItems({
      userId: args.userId,
      tenantId: args.tenantId,
      role: args.role,
      db: args.db,
    }),
  ]);

  const lifecycle = lifecycleStage({ profile, activity });
  const intents = intentSignals({ activity, lifecycle, profile });

  return {
    recentActivity: activity,
    openItems: openItemsResult,
    lifecycleStage: lifecycle,
    intentSignals: intents,
  };
}

export { intentSignals } from './intent-signals.js';
export { lifecycleStage } from './lifecycle-stage.js';
export { openItems } from './open-items.js';
export { recentActivity } from './recent-activity.js';
