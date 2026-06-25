/**
 * O-W-21 — Owner onboarding wizard (LANE B1 — real-row bridge).
 *
 * Thin server page: resolves the active locale from the cookie and seeds the
 * client island so SSR + the first client paint render the SAME language —
 * never an EN title/subtitle under an SW header for a frame (the zero-mix
 * canon). The wizard itself lives in `./onboarding-panel`.
 */

import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { OnboardingPanel } from './onboarding-panel';

export default async function OnboardingPage() {
  const locale = await readLocaleFromServerCookies();
  return <OnboardingPanel initialLocale={locale} />;
}
