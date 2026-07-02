import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { buildSegmentMetadata } from '@/components/marketing/segment-metadata';

/**
 * /for-regulator , landing page for regulators and ministries
 * (Mining Commission, NEMC, the Ministry of Minerals, BOT).
 *
 * Reuses the AudiencePage template (LitFin for-banks parity). Per-
 * audience copy lives in the `audiencePages.regulator` i18n key.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.regulator;
  return buildSegmentMetadata({
    path: '/for-regulator',
    locale,
    title: t.metaTitle,
    description: t.metaDescription,
  });
}

export default async function ForRegulatorPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.regulator;
  return (
    <>
      
      <div>
        <AudiencePage locale={locale} copy={t} kickerIcon={ShieldCheck} />
      </div>
      
    </>
  );
}
