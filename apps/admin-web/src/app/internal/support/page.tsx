import { ScreenShell } from '@/components/internal/ScreenShell';
import { StubCard } from '@/components/internal/StubCard';
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
      <StubCard
        title="Support tickets not yet wired"
        description="The api-gateway does not yet expose the support tickets surface. Wire the endpoint and the table will populate from the live response."
        hint="GET /api/v1/mining/internal/support/tickets"
      />
    </ScreenShell>
  );
}
