import type { Metadata } from 'next';
import { Coins } from 'lucide-react';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { buildSegmentMetadata } from '@/components/marketing/segment-metadata';

/**
 * /for-investor , landing page for mining investors and lenders.
 *
 * Reuses the AudiencePage template (LitFin for-banks parity). Per-
 * audience copy lives in the `audiencePages.investor` i18n key.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.investor;
  return buildSegmentMetadata({
    path: '/for-investor',
    locale,
    title: t.metaTitle,
    description: t.metaDescription,
  });
}

export default async function ForInvestorPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.investor;
  return (
    <>
      
      <div>
        <AudiencePage locale={locale} copy={t} kickerIcon={Coins} />
      </div>
      
    </>
  );
}
