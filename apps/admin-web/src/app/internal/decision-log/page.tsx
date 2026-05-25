import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { DecisionLogAuditor } from '@/components/internal/decision-log/DecisionLogAuditor';

const SCREEN = findScreen('decision-log')!;

export default function DecisionLogPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN} actions={<StubBadge tone="info">Evidence chain immutable</StubBadge>}>
      <DecisionLogAuditor />
    </ScreenShell>
  );
}
