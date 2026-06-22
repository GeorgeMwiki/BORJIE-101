import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { ModelsOverview } from '@/components/internal/models/ModelsOverview';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('models')!;

export default async function ModelsPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell screen={SCREEN}>
      <ModelsOverview initialLocale={locale} />
    </ScreenShell>
  );
}
