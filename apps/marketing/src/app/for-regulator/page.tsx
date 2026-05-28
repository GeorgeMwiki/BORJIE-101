import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

/**
 * /for-regulator , landing page for regulators and ministries
 * (Tumemadini, NEMC, the Ministry of Minerals, BOT).
 *
 * Reuses the AudiencePage template (LitFin for-banks parity). Per-
 * audience copy lives in the `audiencePages.regulator` i18n key.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.regulator;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function ForRegulatorPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.regulator;
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <AudiencePage locale={locale} copy={t} kickerIcon={ShieldCheck} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
