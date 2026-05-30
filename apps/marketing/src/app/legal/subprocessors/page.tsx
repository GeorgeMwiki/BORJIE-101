import type { Metadata } from 'next';
import { LegalShell, type LegalSection } from '@/components/LegalShell';
import { getLocale } from '@/lib/locale';

/**
 * /legal/subprocessors , vendor / role / region table.
 *
 * Per LitFin marketing secondary spec §7 the sub-processors page
 * renders as a single table inside the legal shell. The shell's
 * section nav still appears on lg+ so the page reads like the rest of
 * the legal set.
 */

export const metadata: Metadata = {
  title: 'Sub-processors , Borjie',
  description:
    'Borjie sub-processor list. Vendor, role, region, contract reference. Updated 30 days before any change.',
};

interface VendorRow {
  readonly vendor: string;
  readonly roleEn: string;
  readonly roleSw: string;
  readonly region: string;
  readonly contract: string;
}

const VENDORS: ReadonlyArray<VendorRow> = [
  {
    vendor: 'Supabase',
    roleEn: 'Postgres database and auth',
    roleSw: 'Hifadhidata ya Postgres na uthibitishaji',
    region: 'EU-West-2 (Frankfurt)',
    contract: 'supabase.com/legal/dpa',
  },
  {
    vendor: 'Anthropic',
    roleEn: 'LLM inference (chat content, no PII identifiers)',
    roleSw: 'Mfumo wa LLM (mazungumzo bila vitambulisho vya PII)',
    region: 'US (us-east-1)',
    contract: 'anthropic.com/legal/dpa',
  },
  {
    vendor: 'OpenAI',
    roleEn: 'Text embeddings (text only, no PII identifiers)',
    roleSw: 'Embeddings za maandishi (maandishi tu, bila PII)',
    region: 'US',
    contract: 'openai.com/policies/dpa',
  },
  {
    vendor: 'Upstash',
    roleEn: 'Redis cache (idempotency, rate limiting)',
    roleSw: 'Hifadhi ya Redis (idempotency, kuzuia visivyo halali)',
    region: 'EU (eu-west-1)',
    contract: 'upstash.com/dpa',
  },
  {
    vendor: 'Resend',
    roleEn: 'Transactional email delivery',
    roleSw: 'Utoaji wa baruapepe za miamala',
    region: 'EU (eu-central-1)',
    contract: 'resend.com/legal/dpa',
  },
  {
    vendor: 'Sentry',
    roleEn: 'Error monitoring (server stack traces, no body content)',
    roleSw: 'Ufuatiliaji wa makosa (stack-trace, hakuna maudhui ya mwili)',
    region: 'EU (eu-central-1)',
    contract: 'sentry.io/legal/dpa',
  },
];

function buildSections(locale: 'sw' | 'en'): ReadonlyArray<LegalSection> {
  const isSw = locale === 'sw';
  return [
    {
      id: 'overview',
      title: isSw ? '1. Maelezo' : '1. Overview',
      body: isSw
        ? 'Borjie inatumia wachakataji wadogo wachache, walioteuliwa kwa makini, ili kuendesha mfumo. Kila mchakataji mdogo amesainiwa Data Processing Agreement kabla ya kuanza.'
        : 'Borjie uses a small, carefully-vetted set of sub-processors to run the platform. Each sub-processor is bound by a signed Data Processing Agreement before any data flows.',
    },
    {
      id: 'list',
      title: isSw ? '2. Orodha ya wachakataji' : '2. Sub-processor list',
      body: (
        <div className="-mx-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-border/60 text-tiny uppercase tracking-widest text-foreground/60">
              <tr>
                <th className="px-3 py-2 font-semibold">
                  {locale === 'sw' ? 'Mchakataji' : 'Vendor'}
                </th>
                <th className="px-3 py-2 font-semibold">
                  {locale === 'sw' ? 'Jukumu' : 'Role'}
                </th>
                <th className="px-3 py-2 font-semibold">
                  {locale === 'sw' ? 'Eneo' : 'Region'}
                </th>
                <th className="px-3 py-2 font-semibold">
                  {locale === 'sw' ? 'Mkataba' : 'Contract'}
                </th>
              </tr>
            </thead>
            <tbody>
              {VENDORS.map((v) => (
                <tr
                  key={v.vendor}
                  className="border-b border-border/30 align-top"
                >
                  <td className="px-3 py-2 font-medium text-foreground">
                    {v.vendor}
                  </td>
                  <td className="px-3 py-2 text-foreground/70">
                    {locale === 'sw' ? v.roleSw : v.roleEn}
                  </td>
                  <td className="px-3 py-2 font-mono text-tiny text-foreground/70">
                    {v.region}
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={`https://${v.contract}`}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-signal-500 hover:text-signal-400"
                    >
                      {v.contract}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      id: 'change-notice',
      title: isSw ? '3. Taarifa za mabadiliko' : '3. Change notice',
      body: isSw
        ? 'Borjie itatoa taarifa siku 30 kabla ya kuongeza, kuondoa, au kubadilisha mchakataji mdogo. Wateja waliojiandikisha kupokea taarifa watapokea barua pepe.'
        : 'Borjie provides 30 days notice before adding, removing, or replacing a sub-processor. Tenants subscribed to notices receive an email.',
    },
  ];
}

export default async function LegalSubprocessorsPage() {
  const locale = await getLocale();
  const isSw = locale === 'sw';
  return (
    <LegalShell
      locale={locale}
      kicker={isSw ? 'Wachakataji wadogo' : 'Sub-processors'}
      heading={isSw ? 'Orodha ya wachakataji wadogo' : 'Sub-processor list'}
      lastUpdated={isSw ? 'Imesasishwa 28 Mei 2026' : 'Last updated 28 May 2026'}
      sections={buildSections(locale)}
    />
  );
}
