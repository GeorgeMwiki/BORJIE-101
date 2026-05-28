import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { PageHero } from '@/components/shared/PageHero';
import { MarketplaceBoard } from '@/components/marketplace/MarketplaceBoard';
import { getOwnerSession } from '@/lib/session';

/**
 * O-W-20 — Marketplace & external partners.
 *
 * Hero strip surfaces the "post a new ore parcel" CTA so the owner
 * can list a parcel without leaving the index. Below, the live
 * MarketplaceBoard renders outbound (sell) listings + inbound (buy)
 * services from `/api/v1/mining/marketplace/listings`.
 */
export default async function MarketplacePage() {
  const session = await getOwnerSession();
  const isSw = session.languagePreference === 'sw';
  return (
    <div className="space-y-8 px-8 py-8">
      <PageHero
        slug="marketplace"
        actions={
          <>
            <Link
              href="/sales"
              className="inline-flex items-center gap-2 rounded-full bg-signal-500 px-4 py-2 text-xs font-semibold text-background hover:bg-signal-400"
            >
              {isSw ? 'Tangaza parcel mpya' : 'List new ore parcel'}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              href="/ask?prompt=marketplace"
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-semibold text-foreground hover:bg-surface"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {isSw ? 'Linganisha bei' : 'Compare prices'}
            </Link>
          </>
        }
      />
      <MarketplaceBoard locale={session.languagePreference} />
    </div>
  );
}
