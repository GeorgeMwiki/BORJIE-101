/**
 * Owner → Compliance → Licence renewal (issue #194 chain C-B).
 *
 * Server-rendered shell that loads the licence summary via the
 * gateway's renewal-status endpoint and hands the data to the client
 * component for interactive sign / submit. The page is owner-only
 * (session role check enforced via getOwnerSession + middleware).
 */

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { LicenceRenewalClient } from './LicenceRenewalClient';
import { getOwnerSession } from '@/lib/session';
import { routesAStrings as S } from '@/i18n/strings/routes-a';

interface RouteProps {
  readonly params: Promise<{ readonly id: string }>;
}

export default async function LicenceRenewalPage({ params }: RouteProps) {
  const session = await getOwnerSession();
  const { id } = await params;
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-6 px-8 py-8">
      <Link
        href="/compliance"
        className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {isSw ? S.renewalPage.backToCompliance.sw : S.renewalPage.backToCompliance.en}
      </Link>
      <header>
        <p className="text-xs uppercase tracking-wide text-signal-400">
          {isSw ? S.renewalPage.eyebrow.sw : S.renewalPage.eyebrow.en}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-foreground">
          {isSw ? S.renewalPage.heading.sw : S.renewalPage.heading.en}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isSw ? S.renewalPage.body.sw : S.renewalPage.body.en}
        </p>
      </header>
      <LicenceRenewalClient licenceId={id} isSwahili={isSw} />
    </div>
  );
}
