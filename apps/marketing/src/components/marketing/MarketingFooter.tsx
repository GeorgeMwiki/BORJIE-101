/**
 * MarketingFooter — LitFin marketing canonical name re-export.
 *
 * Borjie's existing `Footer` already mirrors LitFin's 4-column lockup
 * with the compliance badge, social icons, and admin login link. This
 * re-exports it under LitFin's canonical name so the layout.tsx +
 * page.tsx read like LitFin's own.
 *
 * Source of pattern: LITFIN_PATH/src/components/marketing/MarketingFooter.tsx
 * Source of impl:    apps/marketing/src/components/Footer.tsx
 */
import { Footer } from '@/components/Footer';
import type { Locale } from '@/lib/i18n';

export interface MarketingFooterProps {
  readonly locale: Locale;
}

export function MarketingFooter({ locale }: MarketingFooterProps): JSX.Element {
  return <Footer locale={locale} />;
}
