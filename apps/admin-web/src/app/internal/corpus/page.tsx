import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { CorpusManagement } from '@/components/internal/corpus/CorpusManagement';

const SCREEN = findScreen('corpus')!;

export default function CorpusPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <CorpusManagement />
    </ScreenShell>
  );
}
