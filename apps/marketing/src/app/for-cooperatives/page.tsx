import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';
import { buildSegmentMetadata } from '@/components/marketing/segment-metadata';

/**
 * /for-cooperatives — landing page for artisanal mining cooperatives
 * and AMCOS-style federated mining groups.
 *
 * Audience-specific copy lives in `audiencePages.cooperatives`. Page
 * layout is shared via the AudiencePage template.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.cooperatives;
  return buildSegmentMetadata({
    path: '/for-cooperatives',
    locale,
    title: t.metaTitle,
    description: t.metaDescription,
  });
}

export default async function ForCooperativesPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.cooperatives;
  return (
    <>
      
      <div>
        <AudiencePage locale={locale} copy={t} kickerIcon={Users} />
      </div>
      
    </>
  );
}
