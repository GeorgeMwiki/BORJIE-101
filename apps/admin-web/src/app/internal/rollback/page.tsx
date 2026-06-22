import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { RollbackPanel } from '@/components/internal/rollback/RollbackPanel';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('rollback')!;

export default async function RollbackPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="warn">All reverts emit audit + notify channel</StubBadge>}
    >
      <RollbackPanel initialLocale={locale} />
    </ScreenShell>
  );
}
