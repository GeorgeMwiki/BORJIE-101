import type { Metadata } from 'next';
import { ShoppingBag } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

/**
 * /for-buyer , landing page for mineral buyers (gold-window
 * day-buyers, smelter procurement leads, regional aggregators).
 *
 * Reuses the AudiencePage template (LitFin for-banks parity). Per-
 * audience copy lives in the `audiencePages.buyer` i18n key.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.buyer;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function ForBuyerPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.buyer;
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <AudiencePage locale={locale} copy={t} kickerIcon={ShoppingBag} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
