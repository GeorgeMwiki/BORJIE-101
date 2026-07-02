import type { Metadata } from 'next';
import { Gem } from 'lucide-react';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { buildSegmentMetadata } from '@/components/marketing/segment-metadata';

/**
 * /for-sml — landing page for Special Mining Licence holders (large-format).
 *
 * Audience-specific copy lives in `audiencePages.sml`. Page layout is
 * shared via the AudiencePage template.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.sml;
  return buildSegmentMetadata({
    path: '/for-sml',
    locale,
    title: t.metaTitle,
    description: t.metaDescription,
  });
}

export default async function ForSmlPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.sml;
  return (
    <>
      
      <div>
        <AudiencePage locale={locale} copy={t} kickerIcon={Gem} />
      </div>
      
    </>
  );
}
