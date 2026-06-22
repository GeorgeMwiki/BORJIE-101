import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { KillswitchControls } from '@/components/internal/killswitch/KillswitchControls';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('killswitch')!;

export default async function KillswitchPage(): Promise<JSX.Element> {
  // Seed the client locale from the server-resolved cookie so SSR + the
  // first client paint agree (no EN-under-SW first-frame split-brain).
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell screen={SCREEN} actions={<StubBadge tone="danger">Two-operator confirm</StubBadge>}>
      <KillswitchControls initialLocale={locale} />
    </ScreenShell>
  );
}
