import { ScreenShell } from '@/components/internal/ScreenShell';
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
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">
          Juniors registry not yet wired
        </p>
        <p className="mt-2 max-w-md mx-auto text-xs text-neutral-400">
          Wire `/api/v1/mining/internal/juniors` to expose the
          junior-template registry; the cards below will render the
          live list with role, model, and status.
        </p>
      </div>
    </ScreenShell>
  );
}
