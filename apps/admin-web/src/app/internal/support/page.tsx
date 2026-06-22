import { ScreenShell } from '@/components/internal/ScreenShell';
import { findScreen } from '@/lib/internal/screens';
import { SupportTicketList } from '@/components/internal/support/SupportTicketList';
import { readLocaleFromServerCookies } from '@/lib/locale.server';

const SCREEN = findScreen('support')!;

/**
 * Support tickets. Live data path:
 *   GET /api/v1/mining/internal/support/tickets — the union of
 *   unresolved compliance escalations awaiting a human operator
 *   (read-only; the gateway does not yet expose a ticket-acknowledge
 *   route, so each row shows severity + SLA only).
 */
export default async function SupportPage(): Promise<JSX.Element> {
  const locale = await readLocaleFromServerCookies();
  return (
    <ScreenShell screen={SCREEN}>
      <SupportTicketList initialLocale={locale} />
    </ScreenShell>
  );
}
