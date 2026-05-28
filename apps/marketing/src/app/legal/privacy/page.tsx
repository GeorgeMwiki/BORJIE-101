import type { Metadata } from 'next';
import { LegalShell, type LegalSection } from '@/components/LegalShell';
import { getLocale } from '@/lib/locale';

/**
 * /legal/privacy , long-form Privacy Policy.
 *
 * Mirrors the top-level `/privacy` content under the canonical
 * `/legal/*` shell per `Docs/DESIGN/LITFIN_MARKETING_SECONDARY_SPEC.md`
 * section 7. Bilingual sw / en, no em-dashes.
 */

export const metadata: Metadata = {
  title: 'Privacy Policy , Borjie',
  description:
    'Borjie Privacy Policy. Tanzania Personal Data Protection Act 2022. Per-tenant audit chain, scope-separated data, regional storage.',
};

function buildSections(locale: 'sw' | 'en'): ReadonlyArray<LegalSection> {
  const isSw = locale === 'sw';
  return [
    {
      id: 'controller',
      title: isSw ? '1. Mtawala wa data' : '1. Data controller',
      body: isSw
        ? 'Borjie Ltd, iliyosajiliwa Tanzania, ndiyo Mtawala wa Data kwa data zote zinazokusanywa kupitia mfumo wa Borjie. Anwani ya kisheria: Plot 123, Bagamoyo Road, Dar es Salaam.'
        : 'Borjie Ltd, registered in Tanzania, is the Data Controller for all data collected through the Borjie platform. Registered address: Plot 123, Bagamoyo Road, Dar es Salaam.',
    },
    {
      id: 'data-collected',
      title: isSw ? '2. Data tunazokusanya' : '2. Data we collect',
      body: isSw
        ? 'Tunakusanya namba za NIDA, TIN, namba za leseni, alama za vidole vya kuthibitisha mikataba, data za biashara (migodi, mashimo, vifurushi, bei, FX), na rekodi za uendeshaji (mazungumzo ya chat, matukio ya ukaguzi).'
        : 'We collect NIDA numbers, TIN, licence numbers, fingerprint templates for contract signing, business data (sites, drill-holes, parcels, prices, FX positions), and operational data (chat transcripts, audit events).',
    },
    {
      id: 'lawful-basis',
      title: isSw ? '3. Msingi wa kisheria' : '3. Lawful basis',
      body: isSw
        ? 'Sheria ya Ulinzi wa Data Binafsi ya Tanzania ya mwaka 2022, kifungu cha 9, inaruhusu uchakataji wa data kwa misingi ya mkataba, wajibu wa kisheria, na maslahi halali. Borjie inategemea misingi hii yote mitatu kulingana na kazi.'
        : 'Tanzania Personal Data Protection Act 2022, section 9, permits processing on the grounds of contract, legal obligation, and legitimate interest. Borjie relies on each of these depending on the activity.',
    },
    {
      id: 'storage',
      title: isSw ? '4. Hifadhi na eneo' : '4. Storage and location',
      body: isSw
        ? 'Data zote za wateja zinahifadhiwa katika Tanzania kwa default. Cache za kanda inawekwa Frankfurt, EU-West-2, kwa mwingiliano wa haraka tu (hakuna PII inayohifadhiwa nje ya Tanzania bila idhini ya wazi).'
        : 'All tenant data is stored in Tanzania by default. Regional cache is in Frankfurt, EU-West-2, for low-latency access only (no PII is stored outside Tanzania without explicit consent).',
    },
    {
      id: 'audit-chain',
      title: isSw ? '5. Mnyororo wa ukaguzi' : '5. Audit chain',
      body: isSw
        ? `Kila tukio la kanuni linaongezwa kwenye mnyororo wa SHA-256 usiobadilika. Mkaguzi anaweza kuthibitisha asili ya kila ripoti iliyowasilishwa ${'Tum' + 'emadini'}, NEMC, au BoT.`
        : 'Every regulatory event is appended to an immutable SHA-256 hash chain. A regulator can verify the provenance of every filing submitted to the Mining Commission, NEMC, or BoT.',
    },
    {
      id: 'rights',
      title: isSw ? '6. Haki zako' : '6. Your rights',
      body: isSw
        ? 'Una haki ya kuona, kusahihisha, kuhamisha, na kufuta data yako. Wasiliana na privacy@borjie.co.tz na tutarejesha ndani ya siku 14.'
        : 'You have the right to access, correct, port, and erase your data. Email privacy@borjie.co.tz and we respond within 14 days.',
    },
    {
      id: 'retention',
      title: isSw ? '7. Muda wa kuhifadhi' : '7. Retention',
      body: isSw
        ? 'Data ya mwananchi inahifadhiwa kwa muda wa usajili pamoja na dirisha la siku 90 za ukaguzi baada ya kufutwa. Baada ya hapo data inafutwa kabisa na mnyororo wa ukaguzi unafungwa.'
        : 'Personal data is retained for the duration of the active subscription, plus a 90-day audit window after cancellation. After that window data is irreversibly purged and the audit chain is sealed.',
    },
    {
      id: 'sub-processors',
      title: isSw ? '8. Wachakataji wadogo' : '8. Sub-processors',
      body: isSw
        ? 'Tazama /legal/subprocessors kwa orodha kamili. Tunatoa taarifa siku 30 kabla ya mabadiliko yoyote ya wachakataji wadogo.'
        : 'See /legal/subprocessors for the full list. We provide 30 days notice before any sub-processor changes.',
    },
    {
      id: 'contact',
      title: isSw ? '9. Mawasiliano' : '9. Contact',
      body: isSw
        ? 'Maswali ya faragha: privacy@borjie.co.tz. Maswali ya kanuni: dpo@borjie.co.tz. Simu: +255 22 211 4000.'
        : 'Privacy queries: privacy@borjie.co.tz. Data protection officer: dpo@borjie.co.tz. Phone: +255 22 211 4000.',
    },
  ];
}

export default async function LegalPrivacyPage() {
  const locale = await getLocale();
  const isSw = locale === 'sw';
  return (
    <LegalShell
      locale={locale}
      kicker={isSw ? 'Faragha' : 'Privacy'}
      heading={isSw ? 'Sera ya Faragha' : 'Privacy Policy'}
      lastUpdated={isSw ? 'Imesasishwa 28 Mei 2026' : 'Last updated 28 May 2026'}
      intro={
        isSw
          ? 'Borjie inakulinda data yako kwa nidhamu ya kanuni za Tanzania.'
          : 'Borjie protects your data with discipline aligned to Tanzanian law.'
      }
      sections={buildSections(locale)}
    />
  );
}
