import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { ModelsOverview } from '@/components/internal/models/ModelsOverview';

const SCREEN = findScreen('models')!;

export default function ModelsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <ModelsOverview />
    </ScreenShell>
  );
}
