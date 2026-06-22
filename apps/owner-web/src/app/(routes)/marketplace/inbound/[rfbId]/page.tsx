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
import { routesAStrings as S } from '@/i18n/strings/routes-a';

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
        <p className="text-tiny font-medium uppercase tracking-wide text-muted-foreground">
          {isSw ? S.inboundRfb.eyebrow.sw : S.inboundRfb.eyebrow.en}
        </p>
        <h1 className="text-2xl font-semibold text-foreground">
          {isSw ? S.inboundRfb.heading.sw : S.inboundRfb.heading.en}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {isSw ? S.inboundRfb.body.sw : S.inboundRfb.body.en}
        </p>
      </header>

      <RfbDispatchPanel rfbId={rfbId} locale={session.languagePreference} />
    </div>
  );
}
