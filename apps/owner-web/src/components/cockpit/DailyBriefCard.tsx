'use client';

import { Card } from '@borjie/design-system';

import type { BriefItem } from '@/lib/types/cockpit';
import { useT } from '@/i18n/t.client';
import { useLocale } from '@/lib/locale';

interface DailyBriefCardProps {
  readonly items: ReadonlyArray<BriefItem>;
  /**
   * Active locale — optional override (e.g. when the parent already resolved
   * the locale and wants to avoid a second cookie read). When omitted the card
   * reads the active locale via `useLocale()` so it never requires callers to
   * thread a language prop.
   */
  readonly language?: 'en' | 'sw' | undefined;
}

const SEVERITY_PILL: Record<BriefItem['severity'], string> = {
  info: 'pill-green',
  warn: 'pill-amber',
  critical: 'pill-red',
};

export function DailyBriefCard({ items, language }: DailyBriefCardProps) {
  // Seed both hooks from the caller-supplied `language` so the title and
  // body render the active language on the first client paint — without
  // the seed they default to `en` and flash under an SW page (split-brain).
  const t = useT(language);
  // Resolve locale: caller-supplied prop takes precedence; fall back to the
  // locale cookie so this card always renders in exactly one language without
  // requiring every parent to thread the prop.
  const cookieLocale = useLocale(language);
  const activeLocale = language ?? cookieLocale;

  return (
    <Card hoverable className="p-5 lg:col-span-2">
      <div className="cockpit-card-title">{t('cockpit.dailyBriefTitle')}</div>
      <ul className="flex flex-col gap-3">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-3">
            <span className={`pill ${SEVERITY_PILL[item.severity]} shrink-0`}>
              {item.severity}
            </span>
            <p className="text-sm leading-snug text-foreground">
              {activeLocale === 'sw' ? item.textSw : item.text}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
