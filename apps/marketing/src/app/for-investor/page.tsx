import type { Metadata } from 'next';
import { Coins } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

/**
 * /for-investor , landing page for mining investors and lenders.
 *
 * Reuses the AudiencePage template (LitFin for-banks parity). Per-
 * audience copy lives in the `audiencePages.investor` i18n key.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.investor;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function ForInvestorPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.investor;
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <AudiencePage locale={locale} copy={t} kickerIcon={Coins} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
