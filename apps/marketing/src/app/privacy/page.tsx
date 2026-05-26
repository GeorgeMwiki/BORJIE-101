/**
 * Privacy Policy — Tanzania-compliant boilerplate.
 *
 * References:
 *   - Data Protection (Personal Information Protection) Act 2022 (Tanzania)
 *   - Mining Act 2010 (Tanzania) — licence-data handling
 *   - TRA tax compliance — transactional data retention
 *   - NEMC environmental data
 *
 * Cookies: session + language preference only. No third-party tracking.
 * Data residency: Supabase eu-west-2 (London). Data export on request.
 * Contact: privacy@borjie.tz (placeholder).
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
  title: 'Privacy Policy · Borjie',
  description:
    'How Borjie collects, stores and uses your data. Tanzania DPA 2022 compliant.',
};

function bilingualTitle(): Bilingual<string> {
  return { sw: 'Sera ya Faragha', en: 'Privacy Policy' };
}

function bilingualSubtitle(): Bilingual<string> {
  return {
    sw: 'Jinsi tunavyokusanya, kuhifadhi na kutumia data yako kwa mujibu wa sheria za Tanzania.',
    en: 'How we collect, store and use your data, aligned with Tanzanian law.',
  };
}

interface SectionBundle {
  readonly id: string;
  readonly heading: Bilingual<string>;
  readonly paragraphs: ReadonlyArray<Bilingual<string>>;
  readonly bullets?: Bilingual<ReadonlyArray<string>>;
}

const sections: ReadonlyArray<SectionBundle> = [
  {
    id: 'who-we-are',
    heading: { sw: 'Sisi ni nani', en: 'Who we are' },
    paragraphs: [
      {
        sw: 'Borjie Ltd ni kampuni iliyosajiliwa Tanzania inayotoa huduma za mfumo wa AI kwa wamiliki wa migodi. Ofisi yetu kuu ipo Dar es Salaam.',
        en: 'Borjie Ltd is a Tanzania-registered company providing an AI operating system for mining owners. Our principal office is in Dar es Salaam.',
      },
      {
        sw: 'Tunafanya kazi kama mkusanyaji wa data (data controller) kwa data ya akaunti ya mtumiaji, na kama msimamizi wa data (data processor) kwa data ya uendeshaji ya wateja wetu.',
        en: 'We act as data controller for user account data and as data processor for operational data belonging to our customers.',
      },
    ],
  },
  {
    id: 'legal-basis',
    heading: { sw: 'Msingi wa kisheria', en: 'Legal basis' },
    paragraphs: [
      {
        sw: 'Tunakusanya na kushughulikia data kwa kuzingatia:',
        en: 'We collect and process data in compliance with:',
      },
    ],
    bullets: {
      sw: [
        'Sheria ya Ulinzi wa Data (Personal Information Protection Act) ya mwaka 2022.',
        'Sheria ya Madini (Mining Act) ya mwaka 2010 — kwa data ya leseni za PML, ML, na nyingine.',
        'Mahitaji ya TRA kwa data ya kodi na malipo.',
        'Sheria za NEMC kwa data ya mazingira inayohusiana na shughuli za migodi.',
      ],
      en: [
        'Tanzania Personal Information Protection Act 2022.',
        'Mining Act 2010 — for licence data (PML, ML, and related).',
        'Tanzania Revenue Authority (TRA) tax and transactional record requirements.',
        'NEMC environmental data rules tied to mining operations.',
      ],
    },
  },
  {
    id: 'data-we-collect',
    heading: { sw: 'Data tunayokusanya', en: 'Data we collect' },
    paragraphs: [
      {
        sw: 'Tunakusanya data ifuatayo, kulingana na jinsi unavyotumia Borjie:',
        en: 'We collect the following categories, depending on how you use Borjie:',
      },
    ],
    bullets: {
      sw: [
        'Akaunti: jina, barua pepe, nambari ya simu, jukumu (mmiliki, msimamizi, mfanyakazi).',
        'Lugha unayopendelea (sw au en) na muda wa eneo.',
        'Data ya mgodi: leseni za PML/ML, eneo la GPS la tovuti, aina ya madini.',
        'Data ya zamu: ripoti za uzalishaji, picha, usalama wa wafanyakazi.',
        'Data ya kifedha: salio, malipo, bei za soko (kwa cockpit yako tu).',
        'Data ya kiufundi: anwani ya IP, aina ya kifaa, logi za mfumo (zinahifadhiwa siku 90).',
      ],
      en: [
        'Account: name, email, phone, role (owner, supervisor, worker).',
        'Preferred language (sw or en) and timezone.',
        'Mining data: PML/ML licences, site GPS location, mineral type.',
        'Shift data: production reports, photos, worker safety records.',
        'Financial data: balances, payments, market prices (visible to your cockpit only).',
        'Technical: IP address, device type, system logs (retained for 90 days).',
      ],
    },
  },
  {
    id: 'cookies',
    heading: { sw: 'Vidakuzi (cookies)', en: 'Cookies' },
    paragraphs: [
      {
        sw: 'Tunatumia vidakuzi viwili tu:',
        en: 'We use only two cookies:',
      },
    ],
    bullets: {
      sw: [
        'Cookie ya kipindi (session) kuthibitisha umeingia.',
        'Cookie ya lugha (`borjie_lang`) kuhifadhi chaguo lako la sw au en.',
        'Hakuna kufuatilia kwa watu wengine (no third-party tracking). Hakuna Google Analytics, Facebook Pixel, au matangazo.',
      ],
      en: [
        'A session cookie to keep you signed in.',
        'A language cookie (`borjie_lang`) to remember your sw/en preference.',
        'No third-party tracking. No Google Analytics, no Facebook Pixel, no ad cookies.',
      ],
    },
  },
  {
    id: 'data-residency',
    heading: { sw: 'Mahali data inahifadhiwa', en: 'Data residency' },
    paragraphs: [
      {
        sw: 'Data inahifadhiwa kwenye Supabase ndani ya eneo la eu-west-2 (London, Uingereza). Tunatumia eu-west-2 kwa sababu ya latency ya chini na uimarishaji wa hifadhi nakala (backup).',
        en: 'Your data is stored on Supabase in the eu-west-2 region (London, United Kingdom). We use eu-west-2 for low latency and reliable backup.',
      },
      {
        sw: 'Ikiwa unahitaji nakala kamili ya data yako (data export), tuma ombi kwa privacy@borjie.tz. Tutakutumia ndani ya siku 30 za kazi, kwa muundo wa JSON na CSV.',
        en: 'If you need a full export of your data, email privacy@borjie.tz. We respond within 30 working days with JSON and CSV exports.',
      },
    ],
  },
  {
    id: 'sharing',
    heading: { sw: 'Tunashirikiana na nani', en: 'Who we share with' },
    paragraphs: [
      {
        sw: 'Borjie haiuzi data ya wateja. Tunashirikiana data tu na:',
        en: 'Borjie does not sell customer data. We only share with:',
      },
    ],
    bullets: {
      sw: [
        'Mamlaka za Tanzania zinapotaka kisheria (Tume ya Madini, TRA, NEMC).',
        'Wabia wa mfumo (Supabase, Resend kwa barua pepe) chini ya mikataba ya DPA.',
        'Kamwe sio watu wengine kwa madhumuni ya matangazo.',
      ],
      en: [
        'Tanzanian authorities when legally required (Mining Commission, TRA, NEMC).',
        'Platform partners (Supabase, Resend for email) under signed DPAs.',
        'Never with third parties for advertising or marketing.',
      ],
    },
  },
  {
    id: 'rights',
    heading: { sw: 'Haki zako', en: 'Your rights' },
    paragraphs: [
      {
        sw: 'Chini ya Sheria ya Ulinzi wa Data ya 2022, una haki ya:',
        en: 'Under the 2022 Data Protection Act, you have the right to:',
      },
    ],
    bullets: {
      sw: [
        'Kupata nakala ya data yako.',
        'Kurekebisha data isiyo sahihi.',
        'Kufuta akaunti yako (data ya kifedha inahifadhiwa miaka 7 kwa mujibu wa sheria ya TRA).',
        'Kupinga matumizi fulani ya data.',
        'Kuwasilisha malalamiko kwa Mamlaka ya Ulinzi wa Data.',
      ],
      en: [
        'Request a copy of your data.',
        'Correct inaccurate data.',
        'Delete your account (financial records retained for 7 years per TRA rules).',
        'Object to specific processing.',
        'Lodge a complaint with the Data Protection Authority.',
      ],
    },
  },
  {
    id: 'security',
    heading: { sw: 'Usalama', en: 'Security' },
    paragraphs: [
      {
        sw: 'Tunatumia uthibitisho wa hatua mbili, ufichaji wa data (encryption at rest na in transit), na ufuatiliaji wa kila wakati. Tunafanya ukaguzi wa usalama kila robo ya mwaka.',
        en: 'We use multi-factor authentication, encryption at rest and in transit, and continuous monitoring. We carry out quarterly security audits.',
      },
    ],
  },
  {
    id: 'changes',
    heading: { sw: 'Mabadiliko', en: 'Changes' },
    paragraphs: [
      {
        sw: 'Tukibadilisha sera hii, tutakutumia barua pepe na kuonyesha ujumbe kwenye Cockpit angalau siku 30 kabla.',
        en: 'If we change this policy, we will email you and show an in-app notice at least 30 days in advance.',
      },
    ],
  },
  {
    id: 'contact',
    heading: { sw: 'Mawasiliano', en: 'Contact' },
    paragraphs: [
      {
        sw: 'Maswali yoyote ya faragha: privacy@borjie.tz. Tutajibu ndani ya siku 7 za kazi.',
        en: 'Any privacy question: privacy@borjie.tz. We reply within 7 working days.',
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

export default async function PrivacyPage() {
  const lang = await getLocale();
  const rendered = sections.map((s) => renderSection(s, lang));
  return (
    <LegalLayout
      title={pick(bilingualTitle(), lang)}
      subtitle={pick(bilingualSubtitle(), lang)}
      lastUpdated={pick(LAST_UPDATED, lang)}
      lang={lang}
      sections={rendered}
      toc={rendered.map((r) => ({ id: r.id, label: r.heading }))}
    />
  );
}
