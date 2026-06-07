import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { AnalyticsView } from '@/components/internal/analytics/AnalyticsView';

const SCREEN = findScreen('analytics')!;

/**
 * Onboarding / churn analytics. Live data path:
 *   GET /api/v1/mining/internal/analytics/funnel  — activation funnel.
 *   GET /api/v1/mining/internal/analytics/cohorts — signup cohorts.
 * Both aggregate the real append-only `activation_events` log (mig 0300).
 */
export default function AnalyticsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <AnalyticsView />
    </ScreenShell>
  );
}
