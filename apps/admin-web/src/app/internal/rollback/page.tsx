import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { RollbackPanel } from '@/components/internal/rollback/RollbackPanel';

const SCREEN = findScreen('rollback')!;

export default function RollbackPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={<StubBadge tone="warn">All reverts emit audit + notify channel</StubBadge>}
    >
      <RollbackPanel />
    </ScreenShell>
  );
}
