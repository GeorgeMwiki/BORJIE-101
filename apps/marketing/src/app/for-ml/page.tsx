import type { Metadata } from 'next';
import { Mountain } from 'lucide-react';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

/**
 * /for-ml — landing page for Mining Licence operators (mid-tier).
 *
 * Audience-specific copy lives in `audiencePages.ml`. Page layout is
 * shared via the AudiencePage template.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.ml;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function ForMlPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.ml;
  return (
    <>
      
      <main id="main-content">
        <AudiencePage locale={locale} copy={t} kickerIcon={Mountain} />
      </main>
      
    </>
  );
}
