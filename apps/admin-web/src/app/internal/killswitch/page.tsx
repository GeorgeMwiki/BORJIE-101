import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { KillswitchControls } from '@/components/internal/killswitch/KillswitchControls';

const SCREEN = findScreen('killswitch')!;

export default function KillswitchPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN} actions={<StubBadge tone="danger">Two-operator confirm</StubBadge>}>
      <KillswitchControls />
    </ScreenShell>
  );
}
