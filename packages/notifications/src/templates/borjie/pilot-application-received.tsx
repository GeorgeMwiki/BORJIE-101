/**
 * Pilot application received — sent to pilot applicant from marketing site.
 */
import { Heading, Section, Text } from '@react-email/components';
import { z } from 'zod';
import {
  BorjieLayout,
  borjieStyles,
  pickLang,
  type BorjieLang,
} from './_layout';

export const PilotApplicationReceivedSchema = z.object({
  applicantName: z.string().min(1).max(160),
  companyName: z.string().min(1).max(200).optional(),
  applicationId: z.string().min(1).max(60),
  submittedAt: z.string().min(4).max(40),
  estimatedReviewDays: z.number().int().min(1).max(30).default(5),
  lang: z.enum(['sw', 'en']).optional(),
});

export type PilotApplicationReceivedData = z.infer<
  typeof PilotApplicationReceivedSchema
>;

const copy: Record<
  BorjieLang,
  {
    preview: string;
    heading: (n: string) => string;
    body: (days: number) => string;
    nextLabel: string;
    next: ReadonlyArray<string>;
    refLabel: string;
    closing: string;
    sign: string;
  }
> = {
  sw: {
    preview: 'Tumepokea ombi lako la mpango wa majaribio.',
    heading: (n) => `Asante kwa kuomba, ${n}`,
    body: (d) =>
      `Tumepokea ombi lako la kushiriki katika mpango wa Borjie Pilot. Timu yetu itapitia ombi lako ndani ya siku ${d} za kazi.`,
    nextLabel: 'Hatua zinazofuata',
    next: [
      'Tutapitia maelezo ya mgodi wako na nia za matumizi.',
      'Iwapo umechaguliwa, tutakupigia simu kwa mazungumzo mafupi.',
      'Tukikubaliana, tutakutumia maelekezo ya kuanza.',
    ],
    refLabel: 'Namba ya rejea',
    closing:
      'Kama una swali au unataka kuongeza maelezo, jibu barua hii ukitaja namba ya rejea.',
    sign: 'Timu ya Borjie',
  },
  en: {
    preview: 'We received your pilot application.',
    heading: (n) => `Thanks for applying, ${n}`,
    body: (d) =>
      `We have received your Borjie Pilot application. Our team will review it within ${d} working days.`,
    nextLabel: 'What happens next',
    next: [
      'We review your operation details and intended use cases.',
      'If shortlisted, we will call you for a short conversation.',
      'On approval, you will receive onboarding instructions.',
    ],
    refLabel: 'Reference number',
    closing:
      'If you have questions or want to add details, reply to this email and quote the reference number.',
    sign: 'The Borjie team',
  },
};

export function PilotApplicationReceivedEmail(props: PilotApplicationReceivedData) {
  const lang = pickLang(props.lang);
  const c = copy[lang];
  const name = props.companyName
    ? `${props.applicantName} (${props.companyName})`
    : props.applicantName;
  return (
    <BorjieLayout preview={c.preview} lang={lang}>
      <Heading style={borjieStyles.h1}>{c.heading(name)}</Heading>
      <Text style={borjieStyles.p}>{c.body(props.estimatedReviewDays)}</Text>
      <Section style={borjieStyles.card}>
        <Text style={{ ...borjieStyles.muted, margin: '0 0 4px 0' }}>
          {c.refLabel}
        </Text>
        <Text
          style={{
            ...borjieStyles.p,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            margin: 0,
          }}
        >
          {props.applicationId}
        </Text>
        <Text style={{ ...borjieStyles.muted, margin: '8px 0 0 0' }}>
          {props.submittedAt}
        </Text>
      </Section>
      <Text style={{ ...borjieStyles.p, fontWeight: 600 }}>{c.nextLabel}</Text>
      <Section>
        {c.next.map((n, i) => (
          <Text key={n} style={{ ...borjieStyles.p, margin: '0 0 6px 0' }}>
            {i + 1}. {n}
          </Text>
        ))}
      </Section>
      <Text style={borjieStyles.muted}>{c.closing}</Text>
      <Text style={borjieStyles.muted}>{c.sign}</Text>
    </BorjieLayout>
  );
}

export function pilotApplicationReceivedText(
  data: PilotApplicationReceivedData
): string {
  const lang = pickLang(data.lang);
  const c = copy[lang];
  const name = data.companyName
    ? `${data.applicantName} (${data.companyName})`
    : data.applicantName;
  const next = c.next.map((n, i) => `${i + 1}. ${n}`).join('\n');
  return [
    c.heading(name),
    '',
    c.body(data.estimatedReviewDays),
    '',
    `${c.refLabel}: ${data.applicationId}`,
    data.submittedAt,
    '',
    c.nextLabel,
    next,
    '',
    c.closing,
    '',
    c.sign,
  ].join('\n');
}

export const pilotApplicationReceivedSubject = (
  data: PilotApplicationReceivedData
): string => {
  const lang = pickLang(data.lang);
  return lang === 'sw'
    ? `Tumepokea ombi lako · ${data.applicationId}`
    : `We received your application · ${data.applicationId}`;
};

export default PilotApplicationReceivedEmail;
