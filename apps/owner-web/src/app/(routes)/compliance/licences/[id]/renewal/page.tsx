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
        className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {isSw ? 'Rudi kwa compliance' : 'Back to compliance'}
      </Link>
      <header>
        <p className="text-xs uppercase tracking-wide text-signal-400">
          {isSw ? 'Upyaji wa leseni' : 'Licence renewal'}
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-50">
          {isSw ? 'Mchakato wa upyaji' : 'Renewal workflow'}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {isSw
            ? 'Anzisha rasimu, kagua, na uwasilishe kwa NEMC / PCCB / TMAA. Mr. Mwikila atatuma vikumbusho vya 90 / 60 / 30 / 14 / 7 / 1 siku.'
            : 'Start the draft, review, and submit to NEMC / PCCB / TMAA. Mr. Mwikila pulses reminders at 90 / 60 / 30 / 14 / 7 / 1 days.'}
        </p>
      </header>
      <LicenceRenewalClient licenceId={id} isSwahili={isSw} />
    </div>
  );
}
