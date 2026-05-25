import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubBadge } from '@/components/internal/StubBadge';
import { findScreen } from '@/lib/internal/screens';
import { CitationLibrary } from '@/components/internal/citations/CitationLibrary';

const SCREEN = findScreen('citations')!;

export default function CitationsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN} actions={<StubBadge tone="info">Gazette ingest: hourly</StubBadge>}>
      <CitationLibrary />
    </ScreenShell>
  );
}
