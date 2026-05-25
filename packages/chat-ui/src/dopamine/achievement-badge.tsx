/**
 * AchievementBadge — unlockable badges for operators.
 *
 * Pure presentational. Badge state comes from the caller (gamification
 * service). Tenant isolation is enforced upstream; this component only
 * renders what it's given and tags itself with tenant+user via data attrs.
 */

import React from 'react';
import type { AchievementBadgeData, DopamineTier } from './types.js';

export interface AchievementBadgeProps {
  readonly badge: AchievementBadgeData;
  readonly locale?: 'en' | 'sw';
  readonly className?: string;
}

const TIER_STYLES: Record<DopamineTier, string> = {
  bronze: 'bg-amber-700 text-amber-50 border-amber-800',
  silver: 'bg-slate-400 text-slate-900 border-slate-500',
  gold: 'bg-yellow-500 text-yellow-950 border-yellow-700',
  platinum: 'bg-cyan-300 text-cyan-950 border-cyan-500',
};

export function AchievementBadge(props: AchievementBadgeProps): JSX.Element {
  const { badge, locale = 'en', className = '' } = props;
  const title = locale === 'sw' ? badge.titleSw : badge.titleEn;
  const description = locale === 'sw' ? badge.descriptionSw : badge.descriptionEn;
  const earned = badge.earnedAt !== null;
  const tierClass = TIER_STYLES[badge.tier];
  const overall = [
    'inline-flex items-center gap-3 rounded-full px-4 py-2 border-2',
    tierClass,
    earned ? '' : 'opacity-40 grayscale',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      data-dopamine-tenant={badge.tenantId}
      data-dopamine-user={badge.userId}
      data-dopamine-tier={badge.tier}
      data-dopamine-earned={earned ? 'true' : 'false'}
      role="img"
      aria-label={title}
      className={overall}
      title={description}
    >
      <span aria-hidden="true" className="text-lg">
        {iconFor(badge.iconKey)}
      </span>
      <span className="flex flex-col">
        <span className="text-sm font-semibold leading-tight">{title}</span>
        <span className="text-xs leading-tight">{description}</span>
      </span>
    </div>
  );
}

function iconFor(key: string): string {
  const map: Record<string, string> = {
    lease: '#',
    streak: '*',
    inspect: '!',
    default: '+',
  };
  return map[key] ?? map.default ?? '+';
}
