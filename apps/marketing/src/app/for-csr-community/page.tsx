import type { Metadata } from 'next';
import { HeartHandshake } from 'lucide-react';
import { AudiencePage } from '@/components/audience/AudiencePage';
import { getLocale } from '@/lib/locale';
import { getMessages } from '@/lib/i18n';

/**
 * /for-csr-community , landing page for CSR teams and community
 * development partners running Community Development Agreements.
 *
 * Reuses the AudiencePage template (LitFin for-banks parity). Per-
 * audience copy lives in the `audiencePages.csrCommunity` i18n key.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.csrCommunity;
  return {
    title: t.metaTitle,
    description: t.metaDescription,
  };
}

export default async function ForCsrCommunityPage() {
  const locale = await getLocale();
  const t = getMessages(locale).audiencePages.csrCommunity;
  return (
    <>
      
      <main id="main-content">
        <AudiencePage locale={locale} copy={t} kickerIcon={HeartHandshake} />
      </main>
      
    </>
  );
}
