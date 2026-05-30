/**
 * MainNav — LitFin marketing canonical name re-export.
 *
 * Borjie's marketing nav was already built to LitFin's MainNav pattern
 * (scroll-aware shell, "who we serve" mega-menu, locale toggle, primary
 * CTA). This re-exports the existing `Nav` component under LitFin's
 * canonical surface name so the layout.tsx + page.tsx can read like
 * LitFin's own files.
 *
 * Source of pattern: LITFIN_PATH/src/components/marketing/MainNav.tsx
 * Source of impl:    apps/marketing/src/components/Nav.tsx
 */
import { Nav } from '@/components/Nav';
import type { Locale } from '@/lib/i18n';

export interface MainNavProps {
  readonly locale: Locale;
}

export function MainNav({ locale }: MainNavProps): JSX.Element {
  return <Nav locale={locale} />;
}
