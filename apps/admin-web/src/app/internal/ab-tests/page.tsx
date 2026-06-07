import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { ExperimentsList } from '@/components/internal/ab-tests/ExperimentsList';

const SCREEN = findScreen('ab-tests')!;

/**
 * A/B test harness. Live data path:
 *   GET/POST /api/v1/mining/internal/ab-tests        — list / create.
 *   POST     /api/v1/mining/internal/ab-tests/:id/promote-winner.
 * Backed by the real `ab_experiments` table (migration 0300).
 */
export default function AbTestsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <ExperimentsList />
    </ScreenShell>
  );
}
