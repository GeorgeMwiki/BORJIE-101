/**
 * Pilot application approved — onboarding instructions.
 */
import { Button, Heading, Section, Text } from '@react-email/components';
import { z } from 'zod';
import {
  BorjieLayout,
  borjieStyles,
  pickLang,
  type BorjieLang,
} from './_layout';

export const PilotApplicationApprovedSchema = z.object({
  applicantName: z.string().min(1).max(160),
  companyName: z.string().min(1).max(200).optional(),
  cockpitUrl: z.string().url(),
  onboardingCallUrl: z.string().url().optional(),
  pilotDurationDays: z.number().int().min(7).max(180).default(90),
  successManagerName: z.string().min(1).max(120).optional(),
  successManagerEmail: z.string().email().optional(),
  lang: z.enum(['sw', 'en']).optional(),
});

export type PilotApplicationApprovedData = z.infer<
  typeof PilotApplicationApprovedSchema
>;

const copy: Record<
  BorjieLang,
  {
    preview: string;
    heading: (n: string) => string;
    intro: (days: number) => string;
    stepsTitle: string;
    steps: ReadonlyArray<string>;
    callCta: string;
    cockpitCta: string;
    smLabel: string;
    closing: string;
    sign: string;
  }
> = {
  sw: {
    preview: 'Karibu Borjie Pilot. Tunaanza pamoja.',
    heading: (n) => `Hongera ${n}, ombi lako limekubaliwa`,
    intro: (d) =>
      `Karibu kwenye mpango wa Borjie Pilot. Tutafanya kazi pamoja kwa siku ${d} ili kuhakikisha unaona thamani halisi mapema.`,
    stepsTitle: 'Hatua za kuanza',
    steps: [
      'Bonyeza link ya Cockpit hapa chini na weka nenosiri lako.',
      'Jaza maelezo ya mgodi (jina, eneo, aina ya madini).',
      'Pakia leseni za PML/ML — Borjie itaorodhesha tarehe za kuisha.',
      'Alika msimamizi wa tovuti atumie app ya simu ya zamu.',
      'Kushiriki katika simu ya kuanzisha (onboarding) ndani ya siku 3.',
    ],
    callCta: 'Panga simu ya kuanzisha',
    cockpitCta: 'Fungua Cockpit',
    smLabel: 'Msaidizi wako wa mafanikio',
    closing:
      'Wakati wowote unahitaji msaada, jibu barua hii au piga moja kwa moja. Tupo karibu.',
    sign: 'Timu ya Borjie',
  },
  en: {
    preview: 'Welcome to the Borjie Pilot. Let us begin.',
    heading: (n) => `Congratulations ${n}, you are in`,
    intro: (d) =>
      `Welcome to the Borjie Pilot. We work alongside you for ${d} days so you see real value early.`,
    stepsTitle: 'Onboarding steps',
    steps: [
      'Click the Cockpit link below and set your password.',
      'Add your operation details (name, location, mineral type).',
      'Upload your PML/ML licences — Borjie will track expiry dates.',
      'Invite your site supervisor to use the shift mobile app.',
      'Join the onboarding call within 3 days.',
    ],
    callCta: 'Book the onboarding call',
    cockpitCta: 'Open Cockpit',
    smLabel: 'Your success manager',
    closing:
      'Whenever you need help, reply to this email or call us directly. We are close at hand.',
    sign: 'The Borjie team',
  },
};

export function PilotApplicationApprovedEmail(props: PilotApplicationApprovedData) {
  const lang = pickLang(props.lang);
  const c = copy[lang];
  const name = props.companyName
    ? `${props.applicantName} (${props.companyName})`
    : props.applicantName;
  return (
    <BorjieLayout preview={c.preview} lang={lang}>
      <Heading style={borjieStyles.h1}>{c.heading(name)}</Heading>
      <Text style={borjieStyles.p}>{c.intro(props.pilotDurationDays)}</Text>
      <Text style={{ ...borjieStyles.p, fontWeight: 600 }}>{c.stepsTitle}</Text>
      <Section style={borjieStyles.card}>
        {c.steps.map((s, i) => (
          <Text key={s} style={{ ...borjieStyles.p, margin: '0 0 8px 0' }}>
            {i + 1}. {s}
          </Text>
        ))}
      </Section>
      <Section style={{ textAlign: 'center', margin: '24px 0' }}>
        <Button href={props.cockpitUrl} style={borjieStyles.button}>
          {c.cockpitCta}
        </Button>
      </Section>
      {props.onboardingCallUrl && (
        <Section style={{ textAlign: 'center', margin: '0 0 24px 0' }}>
          <a
            href={props.onboardingCallUrl}
            style={{
              ...borjieStyles.button,
              backgroundColor: 'transparent',
              border: `1px solid ${borjieStyles.button.backgroundColor}`,
              color: borjieStyles.button.backgroundColor,
            }}
          >
            {c.callCta}
          </a>
        </Section>
      )}
      {props.successManagerName && (
        <Section style={borjieStyles.card}>
          <Text style={{ ...borjieStyles.muted, margin: '0 0 4px 0' }}>
            {c.smLabel}
          </Text>
          <Text style={{ ...borjieStyles.p, margin: 0 }}>
            {props.successManagerName}
            {props.successManagerEmail ? ` · ${props.successManagerEmail}` : ''}
          </Text>
        </Section>
      )}
      <Text style={borjieStyles.muted}>{c.closing}</Text>
      <Text style={borjieStyles.muted}>{c.sign}</Text>
    </BorjieLayout>
  );
}

export function pilotApplicationApprovedText(
  data: PilotApplicationApprovedData
): string {
  const lang = pickLang(data.lang);
  const c = copy[lang];
  const name = data.companyName
    ? `${data.applicantName} (${data.companyName})`
    : data.applicantName;
  const steps = c.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return [
    c.heading(name),
    '',
    c.intro(data.pilotDurationDays),
    '',
    c.stepsTitle,
    steps,
    '',
    `${c.cockpitCta}: ${data.cockpitUrl}`,
    data.onboardingCallUrl ? `${c.callCta}: ${data.onboardingCallUrl}` : '',
    data.successManagerName
      ? `${c.smLabel}: ${data.successManagerName}${data.successManagerEmail ? ` · ${data.successManagerEmail}` : ''}`
      : '',
    '',
    c.closing,
    '',
    c.sign,
  ]
    .filter(Boolean)
    .join('\n');
}

export const pilotApplicationApprovedSubject = (
  data: PilotApplicationApprovedData
): string => {
  const lang = pickLang(data.lang);
  return lang === 'sw'
    ? 'Karibu Borjie Pilot — ombi lako limekubaliwa'
    : 'Welcome to Borjie Pilot — you are approved';
};

export default PilotApplicationApprovedEmail;
