import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { ComplianceQueue } from '@/components/internal/compliance/ComplianceQueue';

const SCREEN = findScreen('compliance-queue')!;

export default function ComplianceQueuePage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN} actions={<StubBadge tone="info">Awaiting human approval</StubBadge>}>
      <ComplianceQueue />
    </ScreenShell>
  );
}
