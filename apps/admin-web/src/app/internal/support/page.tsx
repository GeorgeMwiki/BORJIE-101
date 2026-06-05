import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { SupportTicketList } from '@/components/internal/support/SupportTicketList';

const SCREEN = findScreen('support')!;

/**
 * Support tickets. Live data path:
 *   GET /api/v1/mining/internal/support/tickets — the union of
 *   unresolved compliance escalations awaiting a human operator
 *   (read-only; the gateway does not yet expose a ticket-acknowledge
 *   route, so each row shows severity + SLA only).
 */
export default function SupportPage(): JSX.Element {
  return (
    <ScreenShell screen={SCREEN}>
      <SupportTicketList />
    </ScreenShell>
  );
}
