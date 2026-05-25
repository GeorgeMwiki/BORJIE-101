import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { SloDashboard } from '@/components/internal/slo/SloDashboard';

const SCREEN = findScreen('slo')!;

export default function SloPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <SloDashboard />
    </ScreenShell>
  );
}
