/**
 * CapabilitiesSection — LitFin marketing canonical name re-export.
 *
 * Borjie's existing CapabilitiesGrid already mirrors LitFin's tilt-card
 * capabilities grid pattern (6 capabilities × audience-aware copy). This
 * re-exports it under LitFin's canonical name so the page.tsx reads
 * like LitFin's own.
 *
 * Source of pattern: LITFIN_PATH/src/components/marketing/CapabilitiesSection.tsx
 * Source of impl:    apps/marketing/src/components/CapabilitiesGrid.tsx
 */
import { CapabilitiesGrid } from '@/components/CapabilitiesGrid';
import type { Locale } from '@/lib/i18n';

export interface CapabilitiesSectionProps {
  readonly locale: Locale;
  /** Audience filter, kept for parity with LitFin's CapabilitiesSection
   *  signature. Borjie's `CapabilitiesGrid` is currently audience-
   *  agnostic; the prop is accepted for forward compat with future
   *  vertical-targeted variants. */
  readonly audience?: 'platform' | 'operator' | 'buyer' | 'capital';
}

export function CapabilitiesSection({
  locale,
}: CapabilitiesSectionProps): JSX.Element {
  return <CapabilitiesGrid locale={locale} />;
}
