import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { RollbackPanel } from '@/components/internal/rollback/RollbackPanel';
import { readLocaleFromServerCookies } from '@/lib/locale.server';
import { pickByLocale } from '@/lib/locale-shared';

const SCREEN = findScreen('rollback')!;

export default async function RollbackPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <StubBadge tone="warn">
          {pickByLocale(locale, {
            en: 'All reverts emit audit + notify channel',
            sw: 'Marejesho yote hutoa ukaguzi + huarifu chaneli',
          })}
        </StubBadge>
      }
    >
      <RollbackPanel initialLocale={locale} />
    </ScreenShell>
  );
}
