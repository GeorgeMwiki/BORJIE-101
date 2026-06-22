import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { RegulatorKanban } from '@/components/internal/regulator-pipeline/RegulatorKanban';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('regulator-pipeline')!;

export default async function RegulatorPipelinePage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell screen={SCREEN}>
      <RegulatorKanban initialLocale={locale} />
    </ScreenShell>
  );
}
