import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';

const SCREEN = findScreen('support')!;

/**
 * Support tickets. Live data path:
 *   GET /api/v1/mining/internal/support/tickets (pending — surface not
 *   yet exposed by the api-gateway).
 *
 * Until the route lands this page renders an empty state instead of
 * mock data; the rest of the support UI (TicketAck, SLA badges) stays
 * available for when the data wires up.
 */
export default function SupportPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">
          Support tickets not yet wired
        </p>
        <p className="mt-2 max-w-md mx-auto text-xs text-neutral-400">
          The api-gateway does not yet expose the support tickets
          surface. Wire `/api/v1/mining/internal/support/tickets` and
          the table will populate from the live response.
        </p>
      </div>
    </ScreenShell>
  );
}
