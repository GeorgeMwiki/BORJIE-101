import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { FeatureFlagsList } from '@/components/internal/flags/FeatureFlagsList';

const SCREEN = findScreen('flags')!;

/**
 * Feature flags. Live data path:
 *   GET   /api/v1/mining/internal/feature-flags         catalog
 *   PATCH /api/v1/mining/internal/feature-flags/:flagKey/rollout
 *
 * The canonical `feature_flags` row is a BOOLEAN default (on/off), so the
 * inline control is an enable/disable toggle — not a rollout percentage.
 */
export default function FlagsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <FeatureFlagsList />
    </ScreenShell>
  );
}
