import { ScreenShell } from '@/components/internal/ScreenShell';
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
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">
          Feature flags not yet wired
        </p>
        <p className="mt-2 max-w-md mx-auto text-xs text-neutral-400">
          Wire `/api/v1/mining/internal/feature-flags` and this surface
          will list every flag with its current rollout percentage and
          the inline rollout-form action.
        </p>
      </div>
    </ScreenShell>
  );
}
