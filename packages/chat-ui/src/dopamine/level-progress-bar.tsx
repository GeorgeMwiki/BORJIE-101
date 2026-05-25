/**
 * LevelProgressBar — progress bar for operator levels.
 *
 * Tiers match the gamification service: bronze / silver / gold / platinum.
 */

import React from 'react';
import type { DopamineTier, LevelState } from './types.js';

export interface LevelProgressBarProps {
  readonly state: LevelState;
  readonly locale?: 'en' | 'sw';
  readonly className?: string;
}

const TIER_ORDER: readonly DopamineTier[] = ['bronze', 'silver', 'gold', 'platinum'];

const TIER_COLORS: Record<DopamineTier, string> = {
  bronze: 'bg-amber-700',
  silver: 'bg-slate-400',
  gold: 'bg-yellow-500',
  platinum: 'bg-cyan-300',
};

const TIER_LABEL_EN: Record<DopamineTier, string> = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

const TIER_LABEL_SW: Record<DopamineTier, string> = {
  bronze: 'Shaba',
  silver: 'Fedha',
  gold: 'Dhahabu',
  platinum: 'Platinamu',
};

export function LevelProgressBar(props: LevelProgressBarProps): JSX.Element {
  const { state, locale = 'en', className = '' } = props;
  const label = locale === 'sw' ? TIER_LABEL_SW[state.tier] : TIER_LABEL_EN[state.tier];
  const nextTierIdx = TIER_ORDER.indexOf(state.tier);
  const nextTier = nextTierIdx >= 0 && nextTierIdx < TIER_ORDER.length - 1
    ? TIER_ORDER[nextTierIdx + 1]!
    : null;
  const nextLabel = nextTier
    ? locale === 'sw'
      ? TIER_LABEL_SW[nextTier]
      : TIER_LABEL_EN[nextTier]
    : null;
  const totalForTier = Math.max(1, state.xp + state.xpToNextTier);
  const pct = Math.max(0, Math.min(100, (state.xp / totalForTier) * 100));
  return (
    <div
      data-dopamine-tenant={state.tenantId}
      data-dopamine-user={state.userId}
      data-dopamine-tier={state.tier}
      className={['w-full space-y-1', className].filter(Boolean).join(' ')}
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-gray-900">{label}</span>
        {nextLabel ? (
          <span className="text-gray-500">
            {locale === 'sw'
              ? `Inaelekea ${nextLabel}: ${state.xpToNextTier} XP`
              : `Next ${nextLabel}: ${state.xpToNextTier} XP`}
          </span>
        ) : (
          <span className="text-gray-500">
            {locale === 'sw' ? 'Kiwango cha juu' : 'Top tier'}
          </span>
        )}
      </div>
      <div
        className="h-2 w-full rounded bg-gray-200 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={['h-full', TIER_COLORS[state.tier]].join(' ')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
