'use client';

import { StubBadge } from './StubBadge';
import { useLocale, pickByLocale, type Locale } from '@/lib/locale';

interface DataSourceBadgeProps {
  readonly source: 'live' | 'mock';
  /**
   * Active locale held by the rendering parent. Pass it so the pill renders
   * the same language as the surface it sits on (no first-paint EN/SW split).
   * When omitted, the badge self-resolves via `useLocale()` and corrects on
   * mount — never a hardcoded language.
   */
  readonly locale?: Locale;
}

const S = {
  live: { en: 'Live', sw: 'Hai' },
  mock: { en: 'Mock data', sw: 'Takwimu za majaribio' },
} as const;

/**
 * Tiny status pill that tells the operator whether the rows they're
 * looking at came from the gateway ('live') or from the in-memory
 * fixtures ('mock'). Keeps demos honest before the backend is online.
 */
export function DataSourceBadge({ source, locale }: DataSourceBadgeProps): JSX.Element {
  const resolved = useLocale(locale);
  return source === 'live' ? (
    <StubBadge tone="success">{pickByLocale(resolved, S.live)}</StubBadge>
  ) : (
    <StubBadge tone="info">{pickByLocale(resolved, S.mock)}</StubBadge>
  );
}
