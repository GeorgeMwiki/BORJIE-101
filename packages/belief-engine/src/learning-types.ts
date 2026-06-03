/**
 * Learning-side shared types used by the DPO preference-learner.
 *
 * `TenantScope` mirrors the signal-emitter's scope vocabulary so a
 * PreferencePair lifted from a LearningSignal lines up without a cast.
 */

export type TenantScope = 'user' | 'org' | 'platform';

/**
 * A pair of action variants observed in the same context. The winner was
 * chosen / kept; the loser was rejected / overridden. The DPO head + the
 * LinUCB posteriors absorb these.
 */
export interface PreferencePair {
  readonly contextHash: string;
  readonly winnerFeatures: ReadonlyArray<number>;
  readonly loserFeatures: ReadonlyArray<number>;
  readonly winnerReward: number;
  readonly loserReward: number;
  readonly tenantScope: TenantScope;
  readonly subjectUserId?: string | null;
  readonly subjectOrgId?: string | null;
}
