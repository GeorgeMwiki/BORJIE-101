import type { Metadata } from 'next';
import { LegalShell, type LegalSection } from '@/components/LegalShell';
import { getLocale } from '@/lib/locale';

/**
 * /legal/terms , long-form Terms of Service.
 *
 * Mirrors the top-level `/terms` content under the canonical
 * `/legal/*` shell per the LitFin marketing secondary spec.
 * Tanzania jurisdiction, mining-domain specific (Tumemadini, NEMC,
 * TRA, FIU).
 */

export const metadata: Metadata = {
  title: 'Terms of Service , Borjie',
  description:
    'Borjie terms of service. Tanzania jurisdiction. Mining-domain specific (Tumemadini, NEMC, TRA, FIU).',
};

function buildSections(locale: 'sw' | 'en'): ReadonlyArray<LegalSection> {
  const isSw = locale === 'sw';
  return [
    {
      id: 'acceptance',
      title: isSw ? '1. Kukubali masharti' : '1. Acceptance',
      body: isSw
        ? 'Kwa kutumia Borjie unakubali masharti haya. Ikiwa hukubaliana, usitumie huduma.'
        : 'By using Borjie you accept these terms. If you do not agree, do not use the service.',
    },
    {
      id: 'eligibility',
      title: isSw ? '2. Ustahiki' : '2. Eligibility',
      body: isSw
        ? 'Lazima uwe mwenye leseni ya PML, ML, au SML iliyotolewa na Tume ya Madini Tanzania, au mnunuzi aliyethibitishwa.'
        : 'You must hold a PML, ML, or SML licence issued by the Tanzanian Mining Commission, or be a verified buyer.',
    },
    {
      id: 'tenant-data',
      title: isSw ? '3. Data ya mteja' : '3. Tenant data',
      body: isSw
        ? 'Data zako ni zako. Borjie inazichakata kwa niaba yako kwa misingi ya mkataba. RLS imewashwa kwa nguvu katika kila jedwali la mteja.'
        : 'Your data is yours. Borjie processes it on your behalf on contractual basis. RLS is force-enabled on every tenant-scoped table.',
    },
    {
      id: 'kill-switch',
      title: isSw ? '4. Switch ya kuzimisha' : '4. Kill switch',
      body: isSw
        ? 'Borjie inaweza kuzimisha shughuli yoyote bila taarifa ya awali ikiwa tutapata ushahidi wa uhalifu wa kifedha au ukiukaji wa kanuni za madini.'
        : 'Borjie may halt any activity without prior notice if we detect evidence of financial crime or mining-regulation breach.',
    },
    {
      id: 'regulator-cooperation',
      title: isSw ? '5. Ushirikiano na wakaguzi' : '5. Regulator cooperation',
      body: isSw
        ? 'Tutashirikiana na Tumemadini, NEMC, TRA, FIU, na BoT kwa mujibu wa sheria. Hatutoi data nje ya wakaguzi waliosajiliwa bila amri ya mahakama.'
        : 'We cooperate with Tumemadini, NEMC, TRA, FIU, and BoT as required by law. We do not disclose data to non-listed parties without a court order.',
    },
    {
      id: 'payment',
      title: isSw ? '6. Malipo' : '6. Payment',
      body: isSw
        ? 'Bei iko katika sarafu ya TZS kwa default. USD inakubaliwa kwa makubaliano maalum tu (baada ya marekebisho ya tarehe 27 Machi 2026).'
        : 'Pricing is in TZS by default. USD is accepted only on special agreement (post the 27 March 2026 remediation update).',
    },
    {
      id: 'suspension',
      title: isSw ? '7. Kusitishwa' : '7. Suspension',
      body: isSw
        ? 'Borjie inaweza kusitisha akaunti yako kwa siku 30 baada ya taarifa ya kushindwa kulipa. Tunaweza kuondoa data ndani ya siku 90.'
        : 'Borjie may suspend your account 30 days after payment failure notice. We may purge data within 90 days thereafter.',
    },
    {
      id: 'liability',
      title: isSw ? '8. Dhima' : '8. Liability',
      body: isSw
        ? 'Dhima ya Borjie haitazidi malipo ya mwaka mmoja uliopita. Hatutawajibika kwa hasara isiyo ya moja kwa moja.'
        : 'Borjie liability will not exceed the prior 12 months of fees. We are not liable for indirect losses.',
    },
    {
      id: 'governing-law',
      title: isSw ? '9. Sheria inayotumika' : '9. Governing law',
      body: isSw
        ? 'Masharti haya yanatawaliwa na sheria za Tanzania. Mahakama ya Biashara ya Dar es Salaam ina mamlaka ya kipekee.'
        : 'These terms are governed by Tanzanian law. The Dar es Salaam Commercial Court has exclusive jurisdiction.',
    },
    {
      id: 'updates',
      title: isSw ? '10. Sasisho' : '10. Updates',
      body: isSw
        ? 'Tunaweza kusasisha masharti haya. Tutakutaarifu siku 30 kabla ya kuanza kutumika kwa mabadiliko muhimu.'
        : 'We may update these terms. We will notify you 30 days before material changes take effect.',
    },
  ];
}

export default async function LegalTermsPage() {
  const locale = await getLocale();
  const isSw = locale === 'sw';
  return (
    <LegalShell
      locale={locale}
      kicker={isSw ? 'Masharti' : 'Terms'}
      heading={isSw ? 'Masharti ya Huduma' : 'Terms of Service'}
      lastUpdated={isSw ? 'Imesasishwa 28 Mei 2026' : 'Last updated 28 May 2026'}
      intro={
        isSw
          ? 'Masharti ya kutumia mfumo wa Borjie kwa wamiliki, wanunuzi, na wakaguzi.'
          : 'Terms for using the Borjie platform as an owner, buyer, or regulator.'
      }
      sections={buildSections(locale)}
    />
  );
}
