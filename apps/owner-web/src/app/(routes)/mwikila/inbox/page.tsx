/**
 * Mr. Mwikila "Acting on your behalf" inbox — owner-web page.
 *
 * Server component renders the heading + Swahili gloss; the client
 * component drives the list + one-tap approve / deny / reverse.
 *
 * Routes used:
 *   GET    /api/v1/owner/mwikila-inbox
 *   POST   /api/v1/owner/mwikila-inbox/:id/approve
 *   POST   /api/v1/owner/mwikila-inbox/:id/deny
 *   POST   /api/v1/owner/mwikila-inbox/:id/reverse
 */

import { MwikilaInboxPanel } from './mwikila-inbox-panel';

export const dynamic = 'force-dynamic';

export default function MwikilaInboxPage() {
  return (
    <main className="px-8 py-6">
      <header className="border-b border-border pb-4">
        <h1 className="font-display text-3xl text-foreground">
          Acting on your behalf
        </h1>
        <p className="mt-0.5 text-xs italic text-neutral-500">
          Mwikila kwa niaba yako — kagua, idhinisha au rejesha
        </p>
        <p className="mt-3 max-w-2xl text-sm text-neutral-300">
          Mr. Mwikila handles routine operations under the delegation
          tiers you set. Every proposal, execution, and safety-rail
          block lands here for your review. T2 executions are
          reversible within the window shown.
        </p>
      </header>
      <MwikilaInboxPanel />
    </main>
  );
}
