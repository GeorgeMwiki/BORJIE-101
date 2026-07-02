import type { Metadata } from 'next';
import { Mountain } from 'lucide-react';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { buildSegmentMetadata } from '@/components/marketing/segment-metadata';

/**
 * /for-ml — landing page for Mining Licence operators (mid-tier).
 *
 * Audience-specific copy lives in `audiencePages.ml`. Page layout is
 * shared via the AudiencePage template.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.ml;
  return buildSegmentMetadata({
    path: '/for-ml',
    locale,
    title: t.metaTitle,
    description: t.metaDescription,
  });
}

export default async function ForMlPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.ml;
  return (
    <>
      
      <div>
        <AudiencePage locale={locale} copy={t} kickerIcon={Mountain} />
      </div>
      
    </>
  );
}
