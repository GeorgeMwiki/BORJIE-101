/**
 * IgnitionHero — LitFin marketing canonical name re-export.
 *
 * Borjie's existing Hero is already a LitFin IgnitionHero clone (Live
 * Fabric two-column with copper gradient header, choreographed chat,
 * mini-waveform, ROUND send button). This re-exports it under LitFin's
 * canonical name so the layout.tsx + page.tsx read like LitFin's own.
 *
 * Source of pattern: LITFIN_PATH/src/components/marketing/IgnitionHero.tsx
 * Source of impl:    apps/marketing/src/components/Hero.tsx
 */
import { Hero } from '@/components/Hero';
import type { Locale } from '@/lib/i18n';

export interface IgnitionHeroProps {
  readonly locale: Locale;
}

export function IgnitionHero({ locale }: IgnitionHeroProps): JSX.Element {
  return <Hero locale={locale} />;
}
