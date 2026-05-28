import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubCard } from '@/components/internal/StubCard';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('flags')!;

/**
 * Feature flags. Live data path:
 *   GET /api/v1/mining/internal/feature-flags (pending — surface not
 *   yet exposed by the api-gateway).
 */
export default function FlagsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <StubCard
        title="Feature flags not yet wired"
        description="Wire the gateway endpoint and this surface will list every flag with its current rollout percentage and the inline rollout-form action."
        hint="GET /api/v1/mining/internal/feature-flags"
      />
    </ScreenShell>
  );
}
