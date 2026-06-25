import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { SelfHealingConsole } from '@/components/internal/self-healing/SelfHealingConsole';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';

const SCREEN = findScreen('self-healing')!;

export default async function SelfHealingPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <StubBadge tone="info">
          {pickByLocale(locale, {
            en: 'Platform-internal',
            sw: 'Ndani ya jukwaa',
          })}
        </StubBadge>
      }
    >
      <SelfHealingConsole initialLocale={locale} />
    </ScreenShell>
  );
}
