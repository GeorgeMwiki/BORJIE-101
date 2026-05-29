/**
 * Personal-KB detail page — Roadmap R8.
 *
 * Lists every memory cell associated with the canonical personId.
 * Reads /api/v1/me/persons/:personId/cells which enforces a
 * caller-owns-person check + the consent gate; the server returns
 * 403 CONSENT_REQUIRED until the user opts in.
 */

import Link from 'next/link';
import { PersonalKbDetailPanel } from './personal-kb-detail-panel';

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly params: Promise<{ personId: string }>;
}

export default async function PersonalKbDetailPage({ params }: PageProps) {
  const { personId } = await params;
  return (
    <main className="px-8 py-6">
      <header className="border-b border-border pb-4">
        <Link
          href="/personal-kb"
          className="text-xs text-neutral-400 hover:text-foreground"
        >
          ← All hats / Kofia zote
        </Link>
        <h1 className="mt-2 font-display text-3xl text-foreground">
          Personal memory cells
        </h1>
        <p className="mt-0.5 text-xs italic text-neutral-500">
          Vipande vya kumbukumbu — kila kitu ninachokujua kuhusu wewe
        </p>
        <p className="mt-3 font-mono text-xs text-neutral-500">
          person id: {personId}
        </p>
      </header>
      <PersonalKbDetailPanel personId={personId} />
    </main>
  );
}
