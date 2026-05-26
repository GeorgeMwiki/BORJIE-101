/**
 * Terms of Service — Tanzania-compliant boilerplate.
 *
 * Mining-domain aware: licence data, marketplace transactions, cashflow
 * tracking. References Mining Act 2010, TRA tax rules, Data Protection
 * Act 2022, NEMC environmental data.
 *
 * Contact: legal@borjie.tz (placeholder).
 */
import type { Metadata } from 'next';
import { getLocale } from '@/lib/locale';
import type { Locale } from '@/lib/i18n';
import {
  LegalLayout,
  LegalList,
  LegalParagraph,
} from '@/components/LegalLayout';

type SiteLang = Locale;
interface Bilingual<T> {
  readonly sw: T;
  readonly en: T;
}
function pick<T>(b: Bilingual<T>, lang: SiteLang): T {
  return lang === 'en' ? b.en : b.sw;
}

const LAST_UPDATED: Bilingual<string> = {
  sw: 'Mei 2026',
  en: 'May 2026',
};

export const metadata: Metadata = {
  title: 'Terms of Service · Borjie',
  description: 'The rules that govern your use of Borjie.',
};

interface SectionBundle {
  readonly id: string;
  readonly heading: Bilingual<string>;
  readonly paragraphs: ReadonlyArray<Bilingual<string>>;
  readonly bullets?: Bilingual<ReadonlyArray<string>>;
}

const sections: ReadonlyArray<SectionBundle> = [
  {
    id: 'acceptance',
    heading: { sw: 'Kukubali masharti', en: 'Acceptance' },
    paragraphs: [
      {
        sw: 'Kwa kutumia Borjie, unakubali masharti haya. Ukitumia kwa niaba ya kampuni, unathibitisha una mamlaka ya kuifunga kampuni kwenye masharti haya.',
        en: 'By using Borjie you accept these terms. If you use it on behalf of a company, you confirm you have authority to bind that company.',
      },
    ],
  },
  {
    id: 'service',
    heading: { sw: 'Huduma', en: 'The service' },
    paragraphs: [
      {
        sw: 'Borjie ni mfumo wa programu unaomsaidia mmiliki wa mgodi nchini Tanzania kufuatilia leseni, fedha, zamu, na soko la madini. Huduma hutolewa kwa muundo wa SaaS.',
        en: 'Borjie is a software platform that helps Tanzanian mining owners track licences, finance, shifts and the minerals marketplace. The service is delivered as SaaS.',
      },
      {
        sw: 'Tunaweza kuongeza, kubadilisha, au kuondoa sifa kwa lengo la kuboresha huduma. Tutakuarifu kabla ya mabadiliko makubwa.',
        en: 'We may add, change or remove features to improve the service. We will give notice for material changes.',
      },
    ],
  },
  {
    id: 'account',
    heading: { sw: 'Akaunti yako', en: 'Your account' },
    paragraphs: [
      {
        sw: 'Una jukumu la kulinda nenosiri lako na kifaa chako. Tunashauri uwashe uthibitisho wa hatua mbili (2FA).',
        en: 'You are responsible for your password and device security. We strongly recommend enabling 2FA.',
      },
    ],
    bullets: {
      sw: [
        'Toa taarifa sahihi za usajili.',
        'Usishiriki akaunti na mtu mwingine — kila mtumiaji ana akaunti yake.',
        'Tuambie haraka iwapo unashuku akaunti yako imeingiliwa.',
      ],
      en: [
        'Provide accurate registration details.',
        'Do not share an account — each user has their own account.',
        'Notify us promptly of any suspected account compromise.',
      ],
    },
  },
  {
    id: 'mining-data',
    heading: { sw: 'Data ya leseni za madini', en: 'Mining licence data' },
    paragraphs: [
      {
        sw: 'Unapopakia leseni za PML, ML au nyingine, unathibitisha unayo haki ya leseni hiyo na unakubali kwamba data hiyo inashughulikiwa kwa mujibu wa Sheria ya Madini ya 2010.',
        en: 'When uploading PML, ML or other licences, you confirm you hold the licence and agree the data is handled in line with the Mining Act 2010.',
      },
      {
        sw: 'Borjie haitumii data ya leseni yako kwa madhumuni mengine yoyote nje ya kukutumikia.',
        en: 'Borjie does not use your licence data for any purpose beyond serving you.',
      },
    ],
  },
  {
    id: 'marketplace',
    heading: { sw: 'Soko la madini', en: 'Marketplace' },
    paragraphs: [
      {
        sw: 'Soko la Borjie ni jukwaa la kuunganisha wauzaji na wanunuzi wa madini. Borjie haimiliki madini wala haifanyi malipo yoyote ya mauzo kwa niaba yako.',
        en: 'The Borjie marketplace connects sellers and buyers of minerals. Borjie does not own the minerals nor act as payment intermediary.',
      },
    ],
    bullets: {
      sw: [
        'Wewe ndiye unayehusika na ubora wa madini unayouza.',
        'Mauzo lazima yafuate Sheria ya Madini ya 2010, ikiwa ni pamoja na ushuru wa serikali.',
        'Borjie inaweza kusitisha matangazo yanayoonekana kuwa udanganyifu.',
      ],
      en: [
        'You are responsible for the quality of minerals you list for sale.',
        'Sales must comply with the Mining Act 2010, including state royalties.',
        'Borjie may suspend listings that appear fraudulent.',
      ],
    },
  },
  {
    id: 'payments',
    heading: { sw: 'Malipo na bili', en: 'Payments and billing' },
    paragraphs: [
      {
        sw: 'Bei ya huduma imeonyeshwa kwa Shilingi za Tanzania (TZS) na hailipi VAT pale isipotajwa. Bili hutumwa kila mwezi au robo ya mwaka, kulingana na mpango wako.',
        en: 'Service pricing is shown in Tanzanian Shillings (TZS) exclusive of VAT unless stated. Invoices are sent monthly or quarterly depending on plan.',
      },
      {
        sw: 'Risiti zinazingatia mahitaji ya TRA. Tutahifadhi rekodi za malipo kwa miaka 7 kwa mujibu wa sheria ya kodi.',
        en: 'Receipts meet TRA requirements. We retain payment records for 7 years under Tanzanian tax law.',
      },
    ],
  },
  {
    id: 'acceptable-use',
    heading: { sw: 'Matumizi yanayokubalika', en: 'Acceptable use' },
    paragraphs: [
      {
        sw: 'Huwezi kutumia Borjie kufanya yafuatayo:',
        en: 'You may not use Borjie to:',
      },
    ],
    bullets: {
      sw: [
        'Kupakia leseni za uongo au hati zilizoharibiwa.',
        'Kuingilia mfumo, kufanya udukuzi, au kuiba data ya mtumiaji mwingine.',
        'Kuuza madini bila kufuata Sheria ya Madini.',
        'Kuvunja sheria yoyote ya Tanzania, ikiwa ni pamoja na NEMC.',
      ],
      en: [
        'Upload fake licences or tampered documents.',
        'Probe the system, attempt intrusion, or scrape another user’s data.',
        'Trade minerals outside the Mining Act.',
        'Breach any Tanzanian law, including NEMC environmental rules.',
      ],
    },
  },
  {
    id: 'liability',
    heading: { sw: 'Mipaka ya wajibu', en: 'Limitation of liability' },
    paragraphs: [
      {
        sw: 'Borjie hutoa huduma "kama ilivyo" (as-is). Hatuwezi kuhakikisha utendaji kazi bila kosa kabisa, ingawa tunajitahidi kuwa juu ya 99.5%.',
        en: 'Borjie provides the service on an as-is basis. We do not guarantee uninterrupted operation though we target above 99.5% uptime.',
      },
      {
        sw: 'Wajibu wetu jumla katika kipindi cha mwaka mmoja ni mdogo kwa ada uliyolipa katika kipindi hicho.',
        en: 'Our aggregate liability in any 12-month period is limited to the fees you paid in that period.',
      },
    ],
  },
  {
    id: 'termination',
    heading: { sw: 'Kusitishwa', en: 'Termination' },
    paragraphs: [
      {
        sw: 'Unaweza kusitisha matumizi wakati wowote. Tunaweza kusitisha akaunti ikiwa unavunja masharti haya, baada ya kukutumia onyo.',
        en: 'You may stop using Borjie at any time. We may terminate an account for breach of these terms, after notice.',
      },
      {
        sw: 'Baada ya kusitishwa, data ya kifedha itahifadhiwa kwa miaka 7 kwa mujibu wa sheria ya TRA. Data nyingine inafutwa ndani ya siku 90.',
        en: 'After termination, financial data is retained for 7 years per TRA. Other data is deleted within 90 days.',
      },
    ],
  },
  {
    id: 'dispute',
    heading: { sw: 'Migogoro', en: 'Disputes' },
    paragraphs: [
      {
        sw: 'Tunajaribu kutatua migogoro kwa mazungumzo. Iwapo haitawezekana, mgogoro utatatuliwa katika mahakama za Tanzania chini ya sheria ya Tanzania.',
        en: 'We try to resolve disputes through good-faith discussion. Unresolved disputes will be heard in the courts of Tanzania under Tanzanian law.',
      },
    ],
  },
  {
    id: 'changes',
    heading: { sw: 'Mabadiliko ya masharti', en: 'Changes to these terms' },
    paragraphs: [
      {
        sw: 'Tukibadilisha masharti, tutakutumia barua pepe na kuonyesha ujumbe ndani ya programu angalau siku 30 mapema.',
        en: 'If we change these terms, we email and show an in-app notice at least 30 days in advance.',
      },
    ],
  },
  {
    id: 'contact',
    heading: { sw: 'Mawasiliano', en: 'Contact' },
    paragraphs: [
      {
        sw: 'Maswali ya kisheria: legal@borjie.tz. Maswali ya faragha: privacy@borjie.tz.',
        en: 'Legal questions: legal@borjie.tz. Privacy questions: privacy@borjie.tz.',
      },
    ],
  },
];

function renderSection(s: SectionBundle, lang: SiteLang) {
  const paragraphs = s.paragraphs.map((p, i) => (
    <LegalParagraph key={i}>{pick(p, lang)}</LegalParagraph>
  ));
  const bullets = s.bullets ? (
    <LegalList items={pick(s.bullets, lang).map((b, i) => <span key={i}>{b}</span>)} />
  ) : null;
  return {
    id: s.id,
    heading: pick(s.heading, lang),
    body: (
      <>
        {paragraphs}
        {bullets}
      </>
    ),
  };
}

export default async function TermsPage() {
  const lang = await getLocale();
  const rendered = sections.map((s) => renderSection(s, lang));
  return (
    <LegalLayout
      title={lang === 'sw' ? 'Masharti ya Huduma' : 'Terms of Service'}
      subtitle={
        lang === 'sw'
          ? 'Sheria zinazoongoza matumizi yako ya Borjie.'
          : 'The rules that govern your use of Borjie.'
      }
      lastUpdated={pick(LAST_UPDATED, lang)}
      lang={lang}
      sections={rendered}
      toc={rendered.map((r) => ({ id: r.id, label: r.heading }))}
    />
  );
}
