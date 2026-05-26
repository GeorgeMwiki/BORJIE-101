/**
 * Welcome email — sent on first sign-in.
 * Subject: "Karibu Borjie · Welcome to Borjie"
 * Owner-friendly Swahili-first onboarding.
 */
import { Button, Heading, Section, Text } from '@react-email/components';
import { z } from 'zod';
import {
  BorjieLayout,
  borjieStyles,
  pickLang,
  type BorjieLang,
} from './_layout';

export const WelcomeSchema = z.object({
  ownerName: z.string().min(1).max(120),
  companyName: z.string().min(1).max(160).optional(),
  cockpitUrl: z.string().url(),
  lang: z.enum(['sw', 'en']).optional(),
});

export type WelcomeData = z.infer<typeof WelcomeSchema>;

const copy: Record<
  BorjieLang,
  {
    preview: string;
    heading: (name: string) => string;
    intro: string;
    bullets: ReadonlyArray<string>;
    cta: string;
    closing: string;
    sign: string;
  }
> = {
  sw: {
    preview: 'Karibu Borjie — mfumo wako wa AI wa kusimamia mgodi.',
    heading: (n) => `Karibu Borjie, ${n}.`,
    intro:
      'Tunafurahi kukukaribisha. Borjie ni mfumo wa AI uliotengenezwa mahsusi kwa wamiliki wa migodi nchini Tanzania — kutoka leseni, malipo, hadi ripoti za zamu.',
    bullets: [
      'Tazama hali ya cashflow na hatari za kifedha kila wiki.',
      'Pokea taarifa za kuisha leseni (PML) siku 90, 30 na 7 kabla.',
      'Fuatilia ripoti za zamu kutoka kwenye simu ya msimamizi wa tovuti.',
      'Tuma matangazo ya soko na pokea zabuni za madini yako.',
    ],
    cta: 'Fungua Cockpit',
    closing:
      'Ukihitaji msaada, jibu tu barua hii. Tutakusaidia kwa Kiswahili au Kiingereza — chochote unachopendelea.',
    sign: 'Timu ya Borjie',
  },
  en: {
    preview: 'Welcome to Borjie — your AI operating system for mining.',
    heading: (n) => `Welcome to Borjie, ${n}.`,
    intro:
      'We are glad to have you on board. Borjie is the AI operating system built for Tanzanian mining owners — from licences and payments to shift reports.',
    bullets: [
      'See cashflow and financial risks weekly at a glance.',
      'Get PML licence expiry alerts 90, 30 and 7 days ahead.',
      'Track shift reports from your site supervisor’s phone.',
      'Post marketplace listings and receive bids for your minerals.',
    ],
    cta: 'Open Cockpit',
    closing:
      'If you need help, just reply to this email. We will help in Swahili or English — whichever you prefer.',
    sign: 'The Borjie team',
  },
};

export function WelcomeEmail(props: WelcomeData) {
  const lang = pickLang(props.lang);
  const c = copy[lang];
  const greetingName = props.companyName
    ? `${props.ownerName} (${props.companyName})`
    : props.ownerName;
  return (
    <BorjieLayout preview={c.preview} lang={lang}>
      <Heading style={borjieStyles.h1}>{c.heading(greetingName)}</Heading>
      <Text style={borjieStyles.p}>{c.intro}</Text>
      <Section style={borjieStyles.card}>
        {c.bullets.map((b) => (
          <Text key={b} style={{ ...borjieStyles.p, margin: '0 0 8px 0' }}>
            &middot; {b}
          </Text>
        ))}
      </Section>
      <Section style={{ textAlign: 'center', margin: '24px 0' }}>
        <Button href={props.cockpitUrl} style={borjieStyles.button}>
          {c.cta}
        </Button>
      </Section>
      <Text style={borjieStyles.muted}>{c.closing}</Text>
      <Text style={borjieStyles.muted}>{c.sign}</Text>
    </BorjieLayout>
  );
}

export function welcomeText(data: WelcomeData): string {
  const lang = pickLang(data.lang);
  const c = copy[lang];
  const name = data.companyName
    ? `${data.ownerName} (${data.companyName})`
    : data.ownerName;
  const bullets = c.bullets.map((b) => `- ${b}`).join('\n');
  return [
    c.heading(name),
    '',
    c.intro,
    '',
    bullets,
    '',
    `${c.cta}: ${data.cockpitUrl}`,
    '',
    c.closing,
    '',
    c.sign,
  ].join('\n');
}

export const welcomeSubject = (data: WelcomeData): string => {
  const lang = pickLang(data.lang);
  return lang === 'sw'
    ? `Karibu Borjie, ${data.ownerName}`
    : `Welcome to Borjie, ${data.ownerName}`;
};

export default WelcomeEmail;
