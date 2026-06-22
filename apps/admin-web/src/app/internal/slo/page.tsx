import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { SloDashboard } from '@/components/internal/slo/SloDashboard';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('slo')!;

export default async function SloPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell screen={SCREEN}>
      <SloDashboard initialLocale={locale} />
    </ScreenShell>
  );
}
