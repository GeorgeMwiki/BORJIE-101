import type { Metadata } from 'next';
import { Truck } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

/**
 * /for-off-taker , landing page for off-takers and exporters who
 * consolidate PML / ML supply into BOT-aligned export shipments.
 *
 * Reuses the AudiencePage template (LitFin for-banks parity). Per-
 * audience copy lives in the `audiencePages.offTaker` i18n key.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.offTaker;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function ForOffTakerPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.offTaker;
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <AudiencePage locale={locale} copy={t} kickerIcon={Truck} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
