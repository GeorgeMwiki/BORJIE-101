import type { Metadata } from 'next';
import { Gem } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

/**
 * /for-sml — landing page for Special Mining Licence holders (large-format).
 *
 * Audience-specific copy lives in `audiencePages.sml`. Page layout is
 * shared via the AudiencePage template.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.sml;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function ForSmlPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.sml;
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <AudiencePage locale={locale} copy={t} kickerIcon={Gem} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
