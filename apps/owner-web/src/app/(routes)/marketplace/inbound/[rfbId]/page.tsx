/**
 * Commercial chain L3 — RFB detail page with manager/site pickers
 * and a dispatch CTA.
 *
 * Backing endpoint: POST /api/v1/marketplace/rfb/:id/dispatch
 * (services/api-gateway/src/routes/marketplace/rfb.hono.ts §POST /:id/dispatch).
 *
 * Server-rendered shell + client island for the picker form.
 * Bilingual sw/en throughout. Auth resolution via getOwnerSession.
 */

import { getOwnerSession } from '@/lib/session';
import { PageHero } from '@/components/shared/PageHero';
import { RfbDispatchPanel } from '@/components/marketplace/RfbDispatchPanel';

interface PageProps {
  readonly params: Promise<{ readonly rfbId: string }>;
}

export default async function InboundRfbDetailPage({ params }: PageProps) {
  const session = await getOwnerSession();
  const { rfbId } = await params;
  const isSw = session.languagePreference === 'sw';

  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="marketplace"
        actions={null}
      />
      <header className="space-y-1">
        <p className="text-tiny font-medium uppercase tracking-wide text-neutral-400">
          {isSw ? 'RFB ya mnunuzi' : 'Inbound buyer RFB'}
        </p>
        <h1 className="text-2xl font-semibold text-foreground">
          {isSw ? 'Tuma kwa msimamizi' : 'Dispatch to a manager'}
        </h1>
        <p className="max-w-2xl text-sm text-neutral-400">
          {isSw
            ? 'Chagua msimamizi na tovuti ya kushughulikia ombi hili. Hatua hii itaunda kazi ya kazi ya mfanyakazi inayofungamana na RFB hii.'
            : 'Pick the manager and the site that will fulfil this buyer request. This creates a worker task linked back to the RFB.'}
        </p>
      </header>

      <RfbDispatchPanel rfbId={rfbId} locale={session.languagePreference} />
    </div>
  );
}
