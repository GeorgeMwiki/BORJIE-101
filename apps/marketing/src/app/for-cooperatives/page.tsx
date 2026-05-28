import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

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
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function ForCooperativesPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.cooperatives;
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <AudiencePage locale={locale} copy={t} kickerIcon={Users} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
