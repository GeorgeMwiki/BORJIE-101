import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { SelfHealingConsole } from '@/components/internal/self-healing/SelfHealingConsole';

const SCREEN = findScreen('self-healing')!;

export default function SelfHealingPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="info">Platform-internal</StubBadge>}
    >
      <SelfHealingConsole />
    </ScreenShell>
  );
}
