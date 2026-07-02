import type { Metadata } from 'next';
import { Building2 } from 'lucide-react';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { buildSegmentMetadata } from '@/components/marketing/segment-metadata';

/**
 * /for-bank , landing page for banks and microfinance lenders that
 * underwrite mining collateral and royalty assignment.
 *
 * Reuses the AudiencePage template (LitFin for-banks parity). Per-
 * audience copy lives in the `audiencePages.bank` i18n key.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.bank;
  return buildSegmentMetadata({
    path: '/for-bank',
    locale,
    title: t.metaTitle,
    description: t.metaDescription,
  });
}

export default async function ForBankPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.bank;
  return (
    <>
      
      <div>
        <AudiencePage locale={locale} copy={t} kickerIcon={Building2} />
      </div>
      
    </>
  );
}
