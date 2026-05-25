import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { RegulatorKanban } from '@/components/internal/regulator-pipeline/RegulatorKanban';

const SCREEN = findScreen('regulator-pipeline')!;

export default function RegulatorPipelinePage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <RegulatorKanban />
    </ScreenShell>
  );
}
