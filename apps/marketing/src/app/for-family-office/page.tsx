import type { Metadata } from 'next';
import { Landmark } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

/**
 * /for-family-office , landing page for multi-generational mining
 * estates and family-office trustees.
 *
 * Reuses the AudiencePage template (LitFin for-banks parity). Per-
 * audience copy lives in the `audiencePages.familyOffice` i18n key.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.familyOffice;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function ForFamilyOfficePage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.familyOffice;
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <AudiencePage locale={locale} copy={t} kickerIcon={Landmark} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
