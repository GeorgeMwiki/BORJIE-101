import type { Metadata } from 'next';
import { Pickaxe } from 'lucide-react';
import { Nav } from '@/components/Nav';
import { Footer } from '@/components/Footer';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

/**
 * /for-pml — landing page for Primary Mining Licence holders.
 *
 * Mirrors LitFin's `(marketing)/for-banks/page.tsx` template, ported to
 * Borjie's mining audience set. The reusable AudiencePage component
 * holds the hero, stats, how-it-works, problem/solution duo, and CTA
 * footer. Per-audience copy lives in the `audiencePages.pml` i18n key.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.pml;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function ForPmlPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.pml;
  return (
    <>
      <Nav locale={locale} />
      <main id="main-content">
        <AudiencePage locale={locale} copy={t} kickerIcon={Pickaxe} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
