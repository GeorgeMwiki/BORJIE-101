'use client';

import { StubBadge } from '../StubBadge';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';
import type { TenantStatus } from '@/lib/internal/types';

const TONE: Record<TenantStatus, 'success' | 'warn' | 'danger' | 'neutral' | 'info'> = {
  Active: 'success',
  Trial: 'info',
  'Past due': 'warn',
  Suspended: 'danger',
};

/**
 * Closed {en,sw} map for the tenant lifecycle status. The `TenantStatus`
 * union members are English carrier literals — they must NOT render raw under
 * the sw locale (that would be language mixing). One canonical sw term each.
 */
const STATUS_LABELS: Record<TenantStatus, { readonly en: string; readonly sw: string }> = {
  Active: { en: 'Active', sw: 'Hai' },
  Trial: { en: 'Trial', sw: 'Jaribio' },
  'Past due': { en: 'Past due', sw: 'Imepitwa na muda' },
  Suspended: { en: 'Suspended', sw: 'Imesimamishwa' },
};

export function TenantStatusBadge({
  status,
  initialLocale,
}: {
  readonly status: TenantStatus;
  readonly initialLocale?: Locale;
}): JSX.Element {
  const locale = useLocale(initialLocale);
  return <StubBadge tone={TONE[status]}>{pickByLocale(locale, STATUS_LABELS[status])}</StubBadge>;
}
