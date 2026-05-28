import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubCard } from '@/components/internal/StubCard';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('juniors')!;

/**
 * Juniors registry. Live data path:
 *   GET /api/v1/mining/internal/juniors (pending — the registry is
 *   currently hard-coded in the api-gateway router; a list endpoint
 *   has not been added yet).
 */
export default function JuniorsPage(): JSX.Element {
  return (
    <ScreenShell
      screen={SCREEN}
      actions={
        <button
          type="button"
          disabled
          className="rounded-md bg-signal-500/40 px-3 py-1.5 text-xs font-medium text-primary-foreground opacity-50"
          title="Awaiting live juniors registry endpoint"
        >
          New junior template
        </button>
      }
    >
      <StubCard
        title="Juniors registry not yet wired"
        description="Wire the gateway endpoint to expose the junior-template registry; the cards below will render the live list with role, model, and status."
        hint="GET /api/v1/mining/internal/juniors"
      />
    </ScreenShell>
  );
}
