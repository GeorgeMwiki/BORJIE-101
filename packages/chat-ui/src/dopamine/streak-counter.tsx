/**
 * StreakCounter — visible streak counter for staff.
 *
 * E.g. days-without-maintenance-overrun, on-time rent streak, inspection
 * streak. Pure presentational, tenant-tagged.
 */

import React from 'react';
import type { StreakState } from './types.js';

export interface StreakCounterProps {
  readonly state: StreakState;
  readonly labelEn: string;
  readonly labelSw: string;
  readonly locale?: 'en' | 'sw';
  readonly className?: string;
}

export function StreakCounter(props: StreakCounterProps): JSX.Element {
  const { state, labelEn, labelSw, locale = 'en', className = '' } = props;
  const label = locale === 'sw' ? labelSw : labelEn;
  const isPersonalBest = state.currentValue > 0 && state.currentValue === state.personalBest;
  const rootClass = [
    'inline-flex flex-col items-start gap-1 rounded-lg border px-3 py-2',
    isPersonalBest ? 'border-green-500 bg-green-50' : 'border-gray-200 bg-white',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div
      data-dopamine-tenant={state.tenantId}
      data-dopamine-user={state.userId}
      data-streak-key={state.streakKey}
      data-personal-best={isPersonalBest ? 'true' : 'false'}
      className={rootClass}
    >
      <span className="text-xs text-gray-500 uppercase tracking-wide">{label}</span>
      <span className="text-2xl font-bold text-gray-900">{state.currentValue}</span>
      <span className="text-xs text-gray-500">
        {locale === 'sw'
          ? `Rekodi: ${state.personalBest}`
          : `Personal best: ${state.personalBest}`}
      </span>
    </div>
  );
}
