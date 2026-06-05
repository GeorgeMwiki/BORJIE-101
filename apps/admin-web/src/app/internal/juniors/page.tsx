import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { JuniorsList } from '@/components/internal/juniors/JuniorsList';

const SCREEN = findScreen('juniors')!;

/**
 * Juniors registry. Live data path:
 *   GET /api/v1/mining/internal/juniors — projects the static
 *   JUNIOR_REGISTRY to one row per junior (read-only; the registry is
 *   static on the gateway and there is no status-transition route).
 */
export default function JuniorsPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <JuniorsList />
    </ScreenShell>
  );
}
